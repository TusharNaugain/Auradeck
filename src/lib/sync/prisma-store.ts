/**
 * Postgres-backed `SyncStore`. Every write that changes a lead also writes its
 * merge base and its audit row in the SAME transaction, so a crash can never
 * leave a lead changed without a matching base/audit entry.
 */

import { Prisma, type Lead } from '@prisma/client'
import { db } from '@/lib/db'
import { nextNumber } from '@/lib/services/numbering'
import { computeLeadScore, findLeadDuplicate } from '@/lib/services/leads'
import {
  CUSTOM_FIELDS,
  canonicalizeFull,
  type FieldConflict,
  type PartialSyncRecord,
  type SyncRecord,
} from './engine'
import type { LeadSnapshot, SyncStore } from './lead-sync'

const ENTITY = 'lead'
const toJson = (value: unknown) => value as Prisma.InputJsonValue

function customOf(row: Pick<Lead, 'customFields'>): Record<string, unknown> {
  const value = row.customFields
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Values for the custom-field-backed sync fields present in `patch` (null = remove the key). */
function customPatch(patch: PartialSyncRecord): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const field of CUSTOM_FIELDS) if (field in patch) out[field] = patch[field] ?? null
  return out
}

/** Apply a custom-field patch on top of the existing JSON without losing unrelated keys. */
function mergeCustom(existing: Record<string, unknown>, patch: Record<string, string | null>): Record<string, unknown> {
  const next = { ...existing }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

function toRecord(row: Lead): SyncRecord {
  const custom = customOf(row)
  return canonicalizeFull({
    // Derived: any lead past "new" counts as contacted.
    contacted: row.lifecycleStage === 'NEW' ? 'no' : 'yes',
    waitlistSource: custom.waitlistSource,
    inviteCode: custom.inviteCode,
    invitedAt: custom.invitedAt,
    trialStartedAt: custom.trialStartedAt,
    signedUpAt: custom.signedUpAt,
    linkedin: custom.linkedin,
    whatsappOptIn: custom.whatsappOptIn,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phoneNumber,
    whatsappNumber: row.whatsappNumber,
    organisationName: row.organisationName,
    jobTitle: row.jobTitle,
    city: row.city,
    state: row.state,
    leadSource: row.leadSource,
    lifecycleStage: row.lifecycleStage,
    nextFollowUpAt: row.nextFollowUpAt?.toISOString() ?? null,
    painPoints: row.painPoints,
    useCase: row.useCase,
  })
}

function toSnapshot(row: Lead): LeadSnapshot {
  return {
    id: row.id,
    leadNumber: row.leadNumber,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    record: toRecord(row),
  }
}

/** Translate canonical sync fields into Prisma column values (only the keys given). */
function toColumns(patch: PartialSyncRecord): Prisma.LeadUncheckedUpdateInput {
  const data: Prisma.LeadUncheckedUpdateInput = {}
  if ('firstName' in patch) data.firstName = patch.firstName ?? ''
  if ('lastName' in patch) data.lastName = patch.lastName ?? ''
  if ('email' in patch) data.email = patch.email ?? null
  if ('phone' in patch) {
    data.phoneNumber = patch.phone ?? null
    if (patch.phone?.startsWith('+')) data.phoneCountryCode = patch.phone.slice(1, 3)
  }
  if ('whatsappNumber' in patch) data.whatsappNumber = patch.whatsappNumber ?? null
  if ('organisationName' in patch) data.organisationName = patch.organisationName ?? null
  if ('jobTitle' in patch) data.jobTitle = patch.jobTitle ?? null
  if ('city' in patch) data.city = patch.city ?? null
  if ('state' in patch) data.state = patch.state ?? null
  if ('leadSource' in patch && patch.leadSource) data.leadSource = patch.leadSource.toUpperCase() as never
  if ('lifecycleStage' in patch && patch.lifecycleStage) data.lifecycleStage = patch.lifecycleStage.toUpperCase() as never
  if ('nextFollowUpAt' in patch) data.nextFollowUpAt = patch.nextFollowUpAt ? new Date(patch.nextFollowUpAt) : null
  if ('painPoints' in patch) data.painPoints = patch.painPoints ?? null
  if ('useCase' in patch) data.useCase = patch.useCase ?? null
  return data
}

export function createPrismaSyncStore(): SyncStore {
  return {
    async findBatch(org, batchId) {
      const row = await db.syncBatch.findUnique({ where: { organisationId_batchId: { organisationId: org, batchId } } })
      return row ? { status: row.status, result: row.resultJson } : null
    },

    async saveBatch(org, batchId, payload) {
      await db.syncBatch.upsert({
        where: { organisationId_batchId: { organisationId: org, batchId } },
        create: { organisationId: org, batchId, rawPayload: toJson(payload) },
        update: {},
      })
    },

    async finishBatch(org, batchId, status, result) {
      await db.syncBatch.update({
        where: { organisationId_batchId: { organisationId: org, batchId } },
        data: { status, resultJson: toJson(result), completedAt: new Date() },
      })
    },

    async findLeadByNumber(org, leadNumber) {
      const row = await db.lead.findUnique({
        where: { organisationId_leadNumber: { organisationId: org, leadNumber } },
      })
      return row ? toSnapshot(row) : null
    },

    async findLeadByExternalRef(org, externalRef) {
      const state = await db.syncRecordState.findFirst({
        where: { organisationId: org, entity: ENTITY, externalRef },
      })
      if (!state) return null
      const row = await db.lead.findFirst({ where: { id: state.recordId, organisationId: org } })
      return row ? toSnapshot(row) : null
    },

    async findDuplicate(org, match, excludeLeadId) {
      const dup = await findLeadDuplicate(
        org,
        { email: match.email, phone: match.phone },
        excludeLeadId
      )
      if (!dup.isDuplicate || !dup.matchedLeadId) return null
      const row = await db.lead.findUnique({ where: { id: dup.matchedLeadId }, select: { leadNumber: true } })
      return row?.leadNumber ?? dup.matchedLeadId
    },

    async getBase(org, leadId) {
      const state = await db.syncRecordState.findUnique({
        where: { organisationId_entity_recordId: { organisationId: org, entity: ENTITY, recordId: leadId } },
      })
      return state ? (state.baseJson as PartialSyncRecord) : null
    },

    async createLead(org, { record, externalRef }) {
      try {
        const created = await db.$transaction(async tx => {
          const leadNumber = await nextNumber(org, 'lead', tx)
          const score = computeLeadScore({
            leadSource: record.leadSource,
            email: record.email,
            phone: record.phone,
            useCase: record.useCase,
          })
          const row = await tx.lead.create({
            data: {
              ...(toColumns(record) as Record<string, unknown>),
              organisationId: org,
              leadNumber,
              leadScore: score,
              customFields: toJson(mergeCustom({}, customPatch(record))),
              ...(record.lifecycleStage !== 'new' ? { firstContactedAt: new Date() } : {}),
              fullName: [record.firstName, record.lastName].filter(Boolean).join(' '),
            } as Prisma.LeadUncheckedCreateInput,
          })
          await tx.syncRecordState.create({
            data: { organisationId: org, entity: ENTITY, recordId: row.id, externalRef, baseJson: toJson(record) },
          })
          await tx.auditLog.create({
            data: {
              organisationId: org, actorType: 'sync', action: 'sync.lead.create',
              resourceType: 'lead', resourceId: row.id, afterJson: toJson(record),
              reason: 'Created from sheet sync',
            },
          })
          return row
        })
        return toSnapshot(created)
      } catch (error) {
        // Two requests raced to create the same externalRef: the unique index
        // rejected the loser and rolled it back. Return the winner's lead.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const existing = await this.findLeadByExternalRef(org, externalRef)
          if (existing) return existing
        }
        throw error
      }
    },

    async updateLead(org, { leadId, expectedUpdatedAt, patch, nextBase, before, after }) {
      return db.$transaction(async tx => {
        const current = await tx.lead.findFirst({ where: { id: leadId, organisationId: org, deletedAt: null } })
        if (!current || current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return false

        const data = toColumns(patch)
        const custom = customPatch(patch)
        if (Object.keys(custom).length) data.customFields = toJson(mergeCustom(customOf(current), custom))
        if (patch.lifecycleStage && patch.lifecycleStage !== 'new' && !current.firstContactedAt) {
          data.firstContactedAt = new Date()
        }
        if ('firstName' in patch || 'lastName' in patch) {
          data.fullName = [after.firstName, after.lastName].filter(Boolean).join(' ')
        }
        data.leadScore = computeLeadScore({
          leadSource: after.leadSource,
          email: after.email,
          phone: after.phone,
          estimatedUsers: current.estimatedUsers,
          budgetRange: current.budgetRange,
          qualificationStatus: current.qualificationStatus,
          currentSoftware: current.currentSoftware,
          useCase: after.useCase,
        })

        // Compare-and-set: only writes if nobody touched the lead since we read it.
        const result = await tx.lead.updateMany({
          where: { id: leadId, organisationId: org, updatedAt: expectedUpdatedAt },
          data: data as Prisma.LeadUncheckedUpdateManyInput,
        })
        if (result.count !== 1) return false

        await tx.syncRecordState.upsert({
          where: { organisationId_entity_recordId: { organisationId: org, entity: ENTITY, recordId: leadId } },
          create: { organisationId: org, entity: ENTITY, recordId: leadId, baseJson: toJson(nextBase) },
          update: { baseJson: toJson(nextBase), lastSyncedAt: new Date() },
        })
        await tx.auditLog.create({
          data: {
            organisationId: org, actorType: 'sync', action: 'sync.lead.update',
            resourceType: 'lead', resourceId: leadId,
            beforeJson: toJson(before), afterJson: toJson(after),
            reason: 'Updated from sheet sync',
          },
        })
        return true
      })
    },

    async setBase(org, leadId, base) {
      await db.syncRecordState.upsert({
        where: { organisationId_entity_recordId: { organisationId: org, entity: ENTITY, recordId: leadId } },
        create: { organisationId: org, entity: ENTITY, recordId: leadId, baseJson: toJson(base) },
        update: { baseJson: toJson(base), lastSyncedAt: new Date() },
      })
    },

    async saveConflicts(org, leadId, conflicts: FieldConflict[]) {
      for (const c of conflicts) {
        // A retried batch must not pile up identical open conflicts.
        const existing = await db.syncConflict.findFirst({
          where: {
            organisationId: org, entity: ENTITY, recordId: leadId, field: c.field, status: 'open',
            crmValue: { equals: c.crmValue === null ? Prisma.JsonNull : c.crmValue },
            sheetValue: { equals: c.sheetValue === null ? Prisma.JsonNull : c.sheetValue },
          },
          select: { id: true },
        })
        if (existing) continue
        await db.syncConflict.create({
          data: {
            organisationId: org, entity: ENTITY, recordId: leadId, field: c.field,
            crmValue: c.crmValue === null ? Prisma.JsonNull : c.crmValue,
            sheetValue: c.sheetValue === null ? Prisma.JsonNull : c.sheetValue,
            winner: c.winner,
          },
        })
      }
    },

    async saveRejected(org, batchId, rowRef, reason, raw) {
      await db.syncRejectedRow.create({
        data: { organisationId: org, batchId, rowRef, reason, rawRow: raw === undefined ? Prisma.JsonNull : toJson(raw) },
      })
    },

    async listChangedLeads(org, { since, afterId, limit }) {
      const window: Prisma.LeadWhereInput = !since
        ? {}
        : afterId
          ? { OR: [{ updatedAt: { gt: since } }, { updatedAt: since, id: { gt: afterId } }] }
          : { updatedAt: { gte: since } }
      const rows = await db.lead.findMany({
        where: { organisationId: org, ...window },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
      })
      return rows.map(toSnapshot)
    },
  }
}
