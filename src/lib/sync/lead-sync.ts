/**
 * Lead sync service (sheet <-> CRM). Storage is behind `SyncStore`, so the
 * rules below are unit-tested with an in-memory fake and run in production
 * against Postgres via `prisma-store.ts`.
 *
 * Safety properties:
 *  - Raw batch is stored BEFORE anything is processed (replayable evidence).
 *  - Batches are idempotent by `batchId`; new rows are idempotent by `externalRef`.
 *  - One bad row never blocks or corrupts the others; every rejection is stored.
 *  - Nothing is ever hard-deleted, and archived leads are never edited or resurrected.
 *  - A lost race with a concurrent CRM edit writes nothing (optimistic check).
 *  - The mass-blank circuit breaker halts suspicious batches untouched.
 */

import { z } from 'zod'
import { emailSchema, phoneSchema } from '@/lib/validations/common'
import { leadLifecycleStage, leadSource } from '@/lib/validations/crm'
import {
  SYNC_FIELDS,
  assessBatchRisk,
  canonicalizeFull,
  canonicalizePartial,
  deriveLeadSource,
  hashRecord,
  placeholderNameFromEmail,
  requiredBlanks,
  threeWayMerge,
  type ConflictWinner,
  type FieldConflict,
  type PartialSyncRecord,
  type SyncField,
  type SyncRecord,
} from './engine'

/* --------------------------------- contracts -------------------------------- */

export interface LeadSnapshot {
  id: string
  leadNumber: string
  updatedAt: Date
  deletedAt: Date | null
  record: SyncRecord
}

export interface SyncStore {
  findBatch(org: string, batchId: string): Promise<{ status: string; result: unknown } | null>
  saveBatch(org: string, batchId: string, payload: unknown): Promise<void>
  finishBatch(org: string, batchId: string, status: 'applied' | 'halted' | 'partial', result: unknown): Promise<void>
  findLeadByNumber(org: string, leadNumber: string): Promise<LeadSnapshot | null>
  findLeadByExternalRef(org: string, externalRef: string): Promise<LeadSnapshot | null>
  /** Returns the lead number of an existing live lead with the same email or phone. */
  findDuplicate(org: string, match: { email: string | null; phone: string | null }, excludeLeadId?: string): Promise<string | null>
  getBase(org: string, leadId: string): Promise<PartialSyncRecord | null>
  createLead(org: string, input: { record: SyncRecord; externalRef: string; isPriority?: boolean }): Promise<LeadSnapshot>
  /** Atomic: update only if `updatedAt` still equals `expectedUpdatedAt`. Returns false when the CRM moved first. */
  updateLead(org: string, input: {
    leadId: string
    expectedUpdatedAt: Date
    patch: PartialSyncRecord
    nextBase: PartialSyncRecord
    before: SyncRecord
    after: SyncRecord
  }): Promise<boolean>
  setBase(org: string, leadId: string, base: SyncRecord): Promise<void>
  saveConflicts(org: string, leadId: string, conflicts: FieldConflict[]): Promise<void>
  saveRejected(org: string, batchId: string, rowRef: string, reason: string, raw: unknown): Promise<void>
  listChangedLeads(org: string, query: { since: Date | null; afterId: string | null; limit: number }): Promise<LeadSnapshot[]>
}

export const pushPayloadSchema = z.object({
  batchId: z.string().trim().min(8).max(100),
  confirmMassChange: z.boolean().optional(),
  /** New leads created by this batch start as Priority reachout (set by the early-access sheet only). */
  markPriority: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        rowRef: z.string().trim().min(1).max(100),
        leadNumber: z.string().trim().max(40).nullish(),
        externalRef: z.string().trim().min(8).max(100).nullish(),
        fields: z.record(z.unknown()),
      })
    )
    .min(1)
    .max(500),
})
export type PushPayload = z.infer<typeof pushPayloadSchema>

export type RowStatus = 'created' | 'updated' | 'unchanged' | 'rejected' | 'retry' | 'halted'

export interface RowResult {
  rowRef: string
  status: RowStatus
  leadNumber?: string
  reason?: string
  /** What the sheet row should now contain (merged values). */
  record?: PartialSyncRecord
  conflicts?: Array<Pick<FieldConflict, 'field' | 'crmValue' | 'sheetValue' | 'winner'>>
}

export interface PushResult {
  batchId: string
  status: 'applied' | 'halted' | 'partial'
  replayed: boolean
  summary: Record<RowStatus, number>
  haltReason?: string
  rows: RowResult[]
}

/* -------------------------------- validation -------------------------------- */

const text = (max: number) => z.string().max(max)
const fieldSchemas: Record<SyncField, z.ZodTypeAny> = {
  firstName: text(50),
  lastName: text(50),
  email: emailSchema,
  phone: phoneSchema,
  whatsappNumber: phoneSchema,
  organisationName: text(150),
  jobTitle: text(100),
  city: text(100),
  state: text(100),
  leadSource,
  lifecycleStage: leadLifecycleStage,
  nextFollowUpAt: z.string().datetime(),
  painPoints: text(10_000),
  useCase: text(10_000),
  contacted: z.enum(['yes', 'no']),
  waitlistSource: text(100),
  inviteCode: text(50),
  invitedAt: z.string().datetime(),
  trialStartedAt: z.string().datetime(),
  signedUpAt: z.string().datetime(),
  linkedin: text(300),
  whatsappOptIn: z.enum(['yes', 'no']),
}

/** Validate every non-null value; returns human-readable problems. */
export function validateValues(values: PartialSyncRecord): string[] {
  const problems: string[] = []
  for (const field of SYNC_FIELDS) {
    const value = values[field]
    if (value === undefined || value === null) continue
    const parsed = fieldSchemas[field].safeParse(value)
    if (!parsed.success) problems.push(`${field}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`)
  }
  return problems
}

/* ------------------------------------ push ---------------------------------- */

type Plan =
  | { kind: 'reject'; rowRef: string; reason: string; raw: unknown }
  | { kind: 'create'; rowRef: string; record: SyncRecord; externalRef: string; blankedFields: SyncField[] }
  | { kind: 'existing'; rowRef: string; lead: LeadSnapshot; blankedFields: SyncField[] }
  | {
      kind: 'update'
      rowRef: string
      lead: LeadSnapshot
      patch: PartialSyncRecord
      nextBase: PartialSyncRecord
      merged: PartialSyncRecord
      conflicts: FieldConflict[]
      blankedFields: SyncField[]
    }

const emptySummary = (): Record<RowStatus, number> => ({
  created: 0, updated: 0, unchanged: 0, rejected: 0, retry: 0, halted: 0,
})

async function planRow(
  store: SyncStore,
  org: string,
  row: PushPayload['rows'][number],
  winner: ConflictWinner
): Promise<Plan> {
  const reject = (reason: string): Plan => ({ kind: 'reject', rowRef: row.rowRef, reason, raw: row })
  const incoming = canonicalizePartial(row.fields)

  if (Object.keys(incoming).length === 0) return reject('Row has no recognised columns')

  /* ---- existing lead: merge ---- */
  // A lead number this CRM has never issued (e.g. the sheet was previously synced to another
  // database) is treated as a new lead when the row carries an externalRef, so the sheet can
  // be re-pushed into a fresh CRM. Without an externalRef it is still rejected as a likely typo.
  const knownLead = row.leadNumber ? await store.findLeadByNumber(org, row.leadNumber) : null
  if (row.leadNumber && !knownLead && !row.externalRef) return reject(`Unknown lead number ${row.leadNumber}`)

  if (row.leadNumber && knownLead) {
    const lead = knownLead
    if (lead.deletedAt) return reject(`${row.leadNumber} is archived in the CRM; restore it there before editing`)

    const base = await store.getBase(org, lead.id)
    const merge = threeWayMerge(base, lead.record, incoming, winner)

    // "Contacted" only ever moves a lead forward. YES promotes a New lead to Contacted;
    // NO never demotes one (the sheet is told the lead is contacted).
    if ('contacted' in merge.crmPatch) {
      if (merge.crmPatch.contacted === 'no') {
        delete merge.crmPatch.contacted
        merge.merged.contacted = lead.record.contacted
        if (base && 'contacted' in base) merge.nextBase.contacted = base.contacted
        else delete merge.nextBase.contacted
      } else if (lead.record.lifecycleStage === 'new' && !('lifecycleStage' in merge.crmPatch)) {
        merge.crmPatch.lifecycleStage = 'contacted'
      }
    }

    const blanks = requiredBlanks(merge.crmPatch)
    if (blanks.length) return reject(`Required field cannot be cleared: ${blanks.join(', ')}`)
    if (merge.crmPatch.lifecycleStage === 'converted') {
      return reject('Set a lead to "converted" from the CRM; conversion creates the account and contact')
    }
    const problems = validateValues(merge.crmPatch)
    if (problems.length) return reject(problems.join('; '))

    if (merge.crmPatch.email || merge.crmPatch.phone) {
      const dup = await store.findDuplicate(
        org,
        { email: merge.crmPatch.email ?? null, phone: merge.crmPatch.phone ?? null },
        lead.id
      )
      if (dup) return reject(`Email or phone already belongs to ${dup}`)
    }

    return {
      kind: 'update',
      rowRef: row.rowRef,
      lead,
      patch: merge.crmPatch,
      nextBase: merge.nextBase,
      merged: merge.merged,
      conflicts: merge.conflicts,
      blankedFields: merge.blankedFields,
    }
  }

  /* ---- new lead: idempotent by externalRef ---- */
  if (!row.externalRef) return reject('New rows need a stable externalRef so retries cannot create duplicates')

  const already = await store.findLeadByExternalRef(org, row.externalRef)
  if (already) return { kind: 'existing', rowRef: row.rowRef, lead: already, blankedFields: [] }

  const record = canonicalizeFull(row.fields)
  record.leadSource ??= deriveLeadSource(record.waitlistSource)
  record.lifecycleStage ??= record.contacted === 'yes' ? 'contacted' : 'new'
  // Early-access sheets only carry an email: use its prefix as a clearly temporary name.
  record.firstName ??= placeholderNameFromEmail(record.email)
  if (!record.firstName) return reject('A name or an email address is required')
  if (record.lifecycleStage === 'converted') return reject('A new lead cannot start as "converted"')
  if (!record.email && !record.phone && !record.whatsappNumber) {
    return reject('Provide at least an email, phone or WhatsApp number')
  }
  const problems = validateValues(record)
  if (problems.length) return reject(problems.join('; '))

  const dup = await store.findDuplicate(org, { email: record.email, phone: record.phone })
  if (dup) return reject(`Duplicate of existing lead ${dup}`)

  return { kind: 'create', rowRef: row.rowRef, record, externalRef: row.externalRef, blankedFields: [] }
}

export async function processPush(
  store: SyncStore,
  org: string,
  payload: PushPayload,
  options: { winner?: ConflictWinner } = {}
): Promise<PushResult> {
  const winner = options.winner ?? 'crm'

  // Idempotency: a finished batch is answered from its stored result, never re-applied.
  const prior = await store.findBatch(org, payload.batchId)
  if (prior && prior.status !== 'received') {
    return { ...(prior.result as PushResult), replayed: true }
  }
  // Keep the untouched payload first. If we crash after this line the batch is
  // still on disk and a re-send re-plans from current state (all steps are idempotent).
  if (!prior) await store.saveBatch(org, payload.batchId, payload)

  const plans: Plan[] = []
  for (const row of payload.rows) plans.push(await planRow(store, org, row, winner))

  const risk = assessBatchRisk(
    plans.filter(p => p.kind !== 'reject') as Array<{ blankedFields: SyncField[] }>,
    { confirmed: payload.confirmMassChange }
  )

  const rows: RowResult[] = []
  const summary = emptySummary()
  const add = (result: RowResult) => {
    rows.push(result)
    summary[result.status] += 1
  }

  if (risk.halted) {
    for (const plan of plans) {
      const reason = plan.kind === 'reject' ? plan.reason : `Batch halted: ${risk.reason}`
      await store.saveRejected(org, payload.batchId, plan.rowRef, reason, payload.rows.find(r => r.rowRef === plan.rowRef))
      add({ rowRef: plan.rowRef, status: plan.kind === 'reject' ? 'rejected' : 'halted', reason })
    }
    const result: PushResult = {
      batchId: payload.batchId, status: 'halted', replayed: false, summary, haltReason: risk.reason, rows,
    }
    await store.finishBatch(org, payload.batchId, 'halted', result)
    return result
  }

  for (const plan of plans) {
    if (plan.kind === 'reject') {
      await store.saveRejected(org, payload.batchId, plan.rowRef, plan.reason, plan.raw)
      add({ rowRef: plan.rowRef, status: 'rejected', reason: plan.reason })
      continue
    }

    if (plan.kind === 'existing') {
      add({ rowRef: plan.rowRef, status: 'unchanged', leadNumber: plan.lead.leadNumber, record: plan.lead.record })
      continue
    }

    if (plan.kind === 'create') {
      try {
        const lead = await store.createLead(org, { record: plan.record, externalRef: plan.externalRef, isPriority: payload.markPriority === true })
        add({ rowRef: plan.rowRef, status: 'created', leadNumber: lead.leadNumber, record: lead.record })
      } catch (error) {
        // Nothing was written (create is one transaction); the sender can safely retry.
        add({ rowRef: plan.rowRef, status: 'retry', reason: error instanceof Error ? error.message : 'create failed' })
      }
      continue
    }

    // update
    const conflictView = plan.conflicts.map(({ field, crmValue, sheetValue, winner: w }) => ({
      field, crmValue, sheetValue, winner: w,
    }))
    if (plan.conflicts.length) await store.saveConflicts(org, plan.lead.id, plan.conflicts)

    if (Object.keys(plan.patch).length === 0) {
      add({
        rowRef: plan.rowRef, status: 'unchanged', leadNumber: plan.lead.leadNumber,
        record: plan.merged, conflicts: conflictView,
      })
      continue
    }

    const after: SyncRecord = { ...plan.lead.record, ...plan.patch } as SyncRecord
    const ok = await store.updateLead(org, {
      leadId: plan.lead.id,
      expectedUpdatedAt: plan.lead.updatedAt,
      patch: plan.patch,
      nextBase: plan.nextBase,
      before: plan.lead.record,
      after,
    })
    add(
      ok
        ? { rowRef: plan.rowRef, status: 'updated', leadNumber: plan.lead.leadNumber, record: plan.merged, conflicts: conflictView }
        : {
            rowRef: plan.rowRef, status: 'retry', leadNumber: plan.lead.leadNumber,
            reason: 'The lead changed in the CRM during sync; nothing was written. Send this row again.',
          }
    )
  }

  const status = summary.rejected + summary.retry > 0 ? 'partial' : 'applied'
  const result: PushResult = { batchId: payload.batchId, status, replayed: false, summary, rows }
  await store.finishBatch(org, payload.batchId, status, result)
  return result
}

/* ------------------------------------ pull ---------------------------------- */

/** Re-delivery window so a transaction that commits late is never skipped. Re-delivery is harmless (idempotent). */
const OVERLAP_MS = 2 * 60 * 1000

export interface PullItem {
  leadNumber: string
  archived: boolean
  updatedAt: string
  hash: string
  record: SyncRecord
}

export interface PullResult {
  items: PullItem[]
  hasMore: boolean
  nextCursor: string | null
}

export function encodeCursor(updatedAt: Date, id: string): string {
  return `${updatedAt.toISOString()}|${id}`
}

export function decodeCursor(cursor: string | null | undefined): { since: Date; afterId: string } | null {
  if (!cursor) return null
  const [iso, id] = cursor.split('|')
  const since = new Date(iso)
  if (!id || Number.isNaN(since.getTime())) return null
  return { since, afterId: id }
}

/**
 * `fresh` = first page of a new sync run: step back by the overlap window.
 * Later pages of the same run pass `fresh=false` so paging always advances.
 */
export async function pullChanges(
  store: SyncStore,
  org: string,
  params: { cursor?: string | null; limit?: number; fresh?: boolean }
): Promise<PullResult> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200)
  const decoded = decodeCursor(params.cursor)
  const since = decoded
    ? params.fresh ? new Date(decoded.since.getTime() - OVERLAP_MS) : decoded.since
    : null
  const afterId = decoded && !params.fresh ? decoded.afterId : null

  const leads = await store.listChangedLeads(org, { since, afterId, limit: limit + 1 })
  const page = leads.slice(0, limit)
  const last = page[page.length - 1]

  return {
    items: page.map(lead => ({
      leadNumber: lead.leadNumber,
      archived: lead.deletedAt !== null,
      updatedAt: lead.updatedAt.toISOString(),
      hash: hashRecord(lead.record),
      record: lead.record,
    })),
    hasMore: leads.length > limit,
    nextCursor: last ? encodeCursor(last.updatedAt, last.id) : decoded ? encodeCursor(decoded.since, decoded.afterId) : null,
  }
}

export const ackPayloadSchema = z.object({
  items: z.array(z.object({ leadNumber: z.string().trim().min(1).max(40), hash: z.string().length(64) })).min(1).max(500),
})

export interface AckResult {
  confirmed: string[]
  stale: string[]
  unknown: string[]
}

/**
 * The sheet confirms it wrote these records. Only then does the base advance,
 * and only if the CRM record is still exactly what was delivered.
 */
export async function ackPull(
  store: SyncStore,
  org: string,
  items: z.infer<typeof ackPayloadSchema>['items']
): Promise<AckResult> {
  const result: AckResult = { confirmed: [], stale: [], unknown: [] }
  for (const item of items) {
    const lead = await store.findLeadByNumber(org, item.leadNumber)
    if (!lead) { result.unknown.push(item.leadNumber); continue }
    if (hashRecord(lead.record) !== item.hash) { result.stale.push(item.leadNumber); continue }
    await store.setBase(org, lead.id, lead.record)
    result.confirmed.push(item.leadNumber)
  }
  return result
}
