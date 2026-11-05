/**
 * Pure sync engine: canonicalisation, hashing and three-way merge.
 * No database, no network — everything here is deterministic and unit-tested.
 *
 * Data-safety rules encoded here:
 *  1. A field is only touched when the incoming row actually contains that
 *     column. A missing column is "not provided", never "cleared".
 *  2. Merges are field-by-field against `base` (the last state both sides
 *     agreed on), so edits to different fields on each side never clobber
 *     each other.
 *  3. When both sides changed the same field, one value wins by policy and
 *     the other is returned as a conflict so the caller can persist it.
 *     No value is ever discarded without being recorded.
 */

import { createHash } from 'node:crypto'
import { normalizePhone } from '@/lib/validations/common'

export const SYNC_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'whatsappNumber',
  'organisationName',
  'jobTitle',
  'city',
  'state',
  'leadSource',
  'lifecycleStage',
  'nextFollowUpAt',
  'painPoints',
  'useCase',
  // Early-access / waitlist columns. `contacted` is derived from lifecycleStage;
  // the rest are stored in the lead's customFields JSON (see CUSTOM_FIELDS).
  'contacted',
  'waitlistSource',
  'inviteCode',
  'invitedAt',
  'trialStartedAt',
  'signedUpAt',
  'linkedin',
  'whatsappOptIn',
] as const

/** Synced fields that live inside `Lead.customFields` rather than their own column. */
export const CUSTOM_FIELDS = [
  'waitlistSource',
  'inviteCode',
  'invitedAt',
  'trialStartedAt',
  'signedUpAt',
  'linkedin',
  'whatsappOptIn',
] as const satisfies readonly (typeof SYNC_FIELDS)[number][]

const DATE_FIELDS: readonly string[] = ['nextFollowUpAt', 'invitedAt', 'trialStartedAt', 'signedUpAt']
const FLAG_FIELDS: readonly string[] = ['contacted', 'whatsappOptIn']
const YES = new Set(['yes', 'y', 'true', '1', 'x', '✓', '✔'])
/** Values people type for "nothing here" in a free-text cell. */
const NOT_APPLICABLE = new Set(['na', 'n/a', 'n.a', 'none', 'nil', '-', '--'])

export type SyncField = (typeof SYNC_FIELDS)[number]
export type SyncValue = string | null
export type SyncRecord = Record<SyncField, SyncValue>
export type PartialSyncRecord = Partial<SyncRecord>

/** Fields a lead cannot exist without; a sheet edit may never blank them. */
export const REQUIRED_FIELDS: readonly SyncField[] = ['firstName', 'lastName', 'leadSource', 'lifecycleStage']

export type ConflictWinner = 'crm' | 'sheet'

export interface FieldConflict {
  field: SyncField
  crmValue: SyncValue
  sheetValue: SyncValue
  winner: ConflictWinner
  resolvedValue: SyncValue
}

/* ------------------------------ canonical form ----------------------------- */

function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

/** Normalise one field to the exact form the CRM stores, so equality checks are reliable. */
export function canonicalValue(field: SyncField, value: unknown): SyncValue {
  const text = clean(value)
  // Yes/no flags are never null: a blank cell means "no", so blank and "No"/"FALSE" compare equal.
  if (FLAG_FIELDS.includes(field)) return text !== null && YES.has(text.toLowerCase()) ? 'yes' : 'no'
  if (text === null) return null
  if (DATE_FIELDS.includes(field)) {
    const ms = Date.parse(text)
    // Keep unparseable input verbatim so validation can reject it visibly
    // instead of silently turning it into "no date".
    return Number.isNaN(ms) ? text : new Date(ms).toISOString()
  }
  switch (field) {
    case 'email':
      return text.toLowerCase()
    case 'phone':
    case 'whatsappNumber':
      return normalizePhone(text)
    case 'leadSource':
    case 'lifecycleStage':
      return text.toLowerCase().replace(/[\s-]+/g, '_')
    case 'linkedin':
      return NOT_APPLICABLE.has(text.toLowerCase()) ? null : text
    default:
      return text
  }
}

/**
 * CRM lead source for a free-text signup source ("hero", "survey", "refferal"...).
 * Only used when a lead is first created; the original text is always kept in `waitlistSource`.
 */
export function deriveLeadSource(waitlistSource: string | null | undefined): string {
  const key = (waitlistSource ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (!key) return 'other'
  if (/^(hero|website|web|landing|site|homepage)/.test(key)) return 'website'
  if (/^(survey|form|campaign|ad|ads|email)/.test(key)) return 'campaign'
  if (/^(ref|friend|word)/.test(key)) return 'referral' // matches the common typo "refferal"
  if (/^(whatsapp|wa)$/.test(key)) return 'whatsapp'
  if (/^(social|instagram|linkedin|facebook|twitter)/.test(key)) return 'social'
  if (/^(event|webinar|conference)/.test(key)) return 'event'
  if (/^(partner)/.test(key)) return 'partner'
  return 'other'
}

/** Temporary display name for a lead whose only identifier is an email address. */
export function placeholderNameFromEmail(email: string | null | undefined): string | null {
  const local = (email ?? '').split('@')[0]?.trim()
  return local ? local.slice(0, 50) : null
}

/** Canonicalise only the columns present in `raw` (absent column = untouched). */
export function canonicalizePartial(raw: Record<string, unknown>): PartialSyncRecord {
  const out: PartialSyncRecord = {}
  for (const field of SYNC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      out[field] = canonicalValue(field, raw[field])
    }
  }
  return out
}

export function canonicalizeFull(raw: Record<string, unknown>): SyncRecord {
  const out = {} as SyncRecord
  for (const field of SYNC_FIELDS) out[field] = canonicalValue(field, raw[field])
  return out
}

/** Stable content hash used for change detection and Firestore reconciliation. */
export function hashRecord(record: PartialSyncRecord): string {
  const ordered = SYNC_FIELDS.map(field => [field, record[field] ?? null])
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

/* -------------------------------- merging --------------------------------- */

export interface MergeResult {
  /** Final value per provided field. */
  merged: PartialSyncRecord
  /** Fields whose merged value differs from the CRM value: apply these to the CRM. */
  crmPatch: PartialSyncRecord
  /** Fields where the sheet must be corrected to match `merged`. */
  sheetCorrections: PartialSyncRecord
  conflicts: FieldConflict[]
  /** CRM fields that would go from a value to blank: input to the mass-blank guard. */
  blankedFields: SyncField[]
  /** Next base snapshot for this record (see `nextBase`). */
  nextBase: PartialSyncRecord
}

/**
 * Three-way, field-level merge.
 *  - base:  last state both sides agreed on (null when the record never synced)
 *  - crm:   current CRM state
 *  - sheet: incoming sheet values (only columns the sheet actually sent)
 */
export function threeWayMerge(
  base: PartialSyncRecord | null,
  crm: SyncRecord,
  sheet: PartialSyncRecord,
  winner: ConflictWinner = 'crm'
): MergeResult {
  const merged: PartialSyncRecord = {}
  const crmPatch: PartialSyncRecord = {}
  const sheetCorrections: PartialSyncRecord = {}
  const conflicts: FieldConflict[] = []
  const blankedFields: SyncField[] = []
  const nextBase: PartialSyncRecord = { ...(base ?? {}) }

  for (const field of SYNC_FIELDS) {
    if (!(field in sheet)) continue
    const s = sheet[field] ?? null
    const c = crm[field] ?? null
    const hasBase = base !== null && field in base
    const b = hasBase ? (base![field] ?? null) : undefined

    let value: SyncValue
    if (s === c) {
      value = c
      nextBase[field] = c // both sides agree: safe to advance the base
    } else if (hasBase && s === b) {
      // Sheet is unchanged since last sync; the CRM moved on. Keep the CRM
      // value and tell the sheet to catch up. Base stays until the sheet acks.
      value = c
      sheetCorrections[field] = c
    } else if (hasBase && c === b) {
      // Only the sheet changed this field: take it.
      value = s
      crmPatch[field] = s
      nextBase[field] = s
    } else {
      // Both changed (or never synced and they differ): genuine conflict.
      const resolvedValue = winner === 'sheet' ? s : c
      conflicts.push({ field, crmValue: c, sheetValue: s, winner, resolvedValue })
      value = resolvedValue
      if (winner === 'sheet') {
        crmPatch[field] = s
        nextBase[field] = s
      } else {
        sheetCorrections[field] = c
        // Leave base untouched so the conflict re-evaluates identically on a
        // retry instead of flipping to "sheet-only change" and overriding the CRM.
      }
    }

    merged[field] = value
    if (field in crmPatch && crmPatch[field] === null && c !== null) blankedFields.push(field)
  }

  return { merged, crmPatch, sheetCorrections, conflicts, blankedFields, nextBase }
}

/** Fields in a patch that would blank a required field (always rejected). */
export function requiredBlanks(patch: PartialSyncRecord): SyncField[] {
  return REQUIRED_FIELDS.filter(field => field in patch && patch[field] === null)
}

/* ---------------------------- batch circuit breaker ------------------------- */

export interface BatchRisk {
  halted: boolean
  reason?: string
  rowsConsidered: number
  rowsBlanking: number
}

/**
 * A column shift, an empty export or a bad script run shows up as many rows
 * blanking fields at once. Halt the whole batch for human review rather than
 * applying it. A sender can re-send with `confirmMassChange` after checking.
 */
export function assessBatchRisk(
  plans: Array<{ blankedFields: SyncField[] }>,
  options: { minRows?: number; maxBlankRatio?: number; confirmed?: boolean } = {}
): BatchRisk {
  const { minRows = 5, maxBlankRatio = 0.3, confirmed = false } = options
  const rowsBlanking = plans.filter(plan => plan.blankedFields.length > 0).length
  const rowsConsidered = plans.length
  if (confirmed || rowsConsidered < minRows) return { halted: false, rowsConsidered, rowsBlanking }
  const ratio = rowsBlanking / rowsConsidered
  if (ratio > maxBlankRatio) {
    return {
      halted: true,
      reason: `${rowsBlanking} of ${rowsConsidered} rows would clear existing values (limit ${Math.round(maxBlankRatio * 100)}%). Nothing was applied.`,
      rowsConsidered,
      rowsBlanking,
    }
  }
  return { halted: false, rowsConsidered, rowsBlanking }
}
