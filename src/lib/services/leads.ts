/**
 * Lead services: duplicate detection, scoring and conversion.
 * Conversion is transactional: lead -> account + primary contact (+ optional opportunity).
 */

import { PIPELINE_STAGES } from '@/lib/leads/stages'
import { createCustomerFromLead, createLeadOpportunity } from '@/lib/leads/stage-flow'
import { db } from '@/lib/db'

export interface DedupeResult {
  isDuplicate: boolean
  matchReason?: 'email' | 'phone' | 'organisation'
  matchedLeadId?: string
}

/**
 * Configurable dedupe: exact email match first, then normalised phone,
 * then case-insensitive organisation name. Organisation scope is always enforced.
 */
export async function findLeadDuplicate(
  organisationId: string,
  lead: { email?: string | null; phone?: string | null; organisationName?: string | null },
  excludeLeadId?: string
): Promise<DedupeResult> {
  const notClause = excludeLeadId ? { id: { not: excludeLeadId } } : undefined

  if (lead.email) {
    const match = await db.lead.findFirst({
      where: {
        organisationId,
        deletedAt: null,
        ...(notClause ?? {}),
        email: lead.email.toLowerCase(),
      },
      select: { id: true },
    })
    if (match) return { isDuplicate: true, matchReason: 'email', matchedLeadId: match.id }
  }

  if (lead.phone) {
    const match = await db.lead.findFirst({
      where: {
        organisationId,
        deletedAt: null,
        ...(notClause ?? {}),
        phoneNumber: lead.phone,
      },
      select: { id: true },
    })
    if (match) return { isDuplicate: true, matchReason: 'phone', matchedLeadId: match.id }
  }

  if (lead.organisationName && lead.organisationName.trim().length >= 3) {
    const match = await db.lead.findFirst({
      where: {
        organisationId,
        deletedAt: null,
        ...(notClause ?? {}),
        organisationName: { equals: lead.organisationName.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (match) return { isDuplicate: true, matchReason: 'organisation', matchedLeadId: match.id }
  }

  return { isDuplicate: false }
}

/** Simple heuristic lead score (0-100), signal-based and explainable. */
export function computeLeadScore(input: {
  leadSource?: string | null
  email?: string | null
  phone?: string | null
  estimatedUsers?: number | null
  budgetRange?: string | null
  qualificationStatus?: string | null
  currentSoftware?: string | null
  useCase?: string | null
}): number {
  let score = 0
  if (input.email && input.phone) score += 20
  else if (input.email || input.phone) score += 10
  if (input.estimatedUsers && input.estimatedUsers >= 10) score += 20
  else if (input.estimatedUsers && input.estimatedUsers >= 3) score += 10
  if (input.budgetRange) score += 15
  if (input.leadSource === 'referral' || input.leadSource === 'partner') score += 15
  else if (input.leadSource === 'website' || input.leadSource === 'campaign') score += 10
  if (input.qualificationStatus === 'qualified') score += 15
  else if (input.qualificationStatus === 'contacted') score += 5
  if (input.currentSoftware) score += 10
  if (input.useCase && input.useCase.length > 30) score += 5
  return Math.min(100, score)
}

/* ---------- Lead -> Account/Contact/Opportunity conversion ---------- */

export interface ConversionInput {
  organisationId: string
  leadId: string
  actorUserId: string
  createOpportunity?: boolean
  opportunity?: {
    name?: string
    amount?: number
    expectedCloseDate?: Date | null
    billingFrequency?: string
    ownerUserId?: string
  }
  accountOverrides?: {
    accountName?: string
    ownerUserId?: string
  }
}

export interface ConversionResult {
  accountId: string
  contactId: string
  opportunityId?: string
}

/**
 * Atomically convert a lead once (guarded against double conversion).
 * Preserves full conversion history on the lead record itself.
 */
export async function convertLead(input: ConversionInput): Promise<ConversionResult> {
  return db.$transaction(
    async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: input.leadId, organisationId: input.organisationId, deletedAt: null },
      })
      if (!lead) throw new Error('LEAD_NOT_FOUND')
      if (lead.convertedAccountId) {
        throw new Error('LEAD_ALREADY_CONVERTED')
      }

      // Same records the stage flow creates; reuses the lead's existing deal if it has one.
      const { accountId, contactId, accountName } = await createCustomerFromLead(tx, lead, input.actorUserId, {
        accountName: input.accountOverrides?.accountName,
        ownerUserId: input.accountOverrides?.ownerUserId,
      })
      let opportunityId: string | undefined = lead.opportunityId ?? undefined
      if (!opportunityId && input.createOpportunity !== false) {
        opportunityId = await createLeadOpportunity(tx, { ...lead, convertedAccountId: accountId, convertedContactId: contactId }, input.actorUserId, {
          stage: 'DISCOVERY',
          accountId,
          contactId,
          name: input.opportunity?.name ?? `${accountName} — AuraDeck CRM`,
          amount: input.opportunity?.amount,
          expectedCloseDate: input.opportunity?.expectedCloseDate ?? undefined,
          billingFrequency: input.opportunity?.billingFrequency,
          ownerUserId: input.opportunity?.ownerUserId,
        })
      }

      // Conversion = account created → "Signed up / trial", unless the lead is already further along.
      if ((PIPELINE_STAGES as readonly string[]).includes(lead.lifecycleStage)) {
        await tx.lead.update({ where: { id: lead.id }, data: { lifecycleStage: 'SIGNED_UP' } })
      }

      return { accountId, contactId, opportunityId }
    },
    { isolationLevel: 'Serializable', timeout: 15_000 }
  )
}

/** Leads in these stages are "dead": hidden from the board and the dashboard, shown only in the Dead view. */
export { DEAD_LEAD_STAGES } from '@/lib/leads/stages'
