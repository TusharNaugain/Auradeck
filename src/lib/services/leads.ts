/**
 * Lead services: duplicate detection, scoring and conversion.
 * Conversion is transactional: lead -> account + primary contact (+ optional opportunity).
 */

import { db } from '@/lib/db'
import { computeWeightedAmount, DEFAULT_STAGE_PROBABILITY } from '@/lib/validations'
import { Prisma, type OpportunityStage } from '@prisma/client'
import { nextCounterValueInTx } from '@/lib/services/numbering'

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
      if (lead.lifecycleStage === 'CONVERTED') {
        throw new Error('LEAD_ALREADY_CONVERTED')
      }

      const fullName = `${lead.firstName} ${lead.lastName}`
      const accountName = input.accountOverrides?.accountName ?? lead.organisationName ?? fullName

      // 1. Account for the practice
      const accountCodeValue = await nextCounterValueInTx(input.organisationId, 'account', tx)
      const account = await tx.account.create({
        data: {
          organisationId: input.organisationId,
          accountName,
          customerAccountCode: `ACC-${accountCodeValue.toString().padStart(6, '0')}`,
          ownerUserId: input.accountOverrides?.ownerUserId ?? lead.assignedToUserId ?? input.actorUserId,
          healthStatus: 'UNKNOWN',
          tags: lead.tags ?? [],
        },
      })

      // 2. Primary contact from lead details
      const contact = await tx.contact.create({
        data: {
          organisationId: input.organisationId,
          accountId: account.id,
          firstName: lead.firstName,
          lastName: lead.lastName,
          fullName,
          email: lead.email,
          phoneCountryCode: lead.phoneCountryCode,
          phoneNumber: lead.phoneNumber,
          whatsappNumber: lead.whatsappNumber,
          jobTitle: lead.jobTitle,
          contactType: 'OWNER',
          isPrimary: true,
          isDecisionMaker: true,
          consentStatus: lead.consentStatus,
          tags: lead.tags ?? [],
        },
      })

      // 3. Optional new-business opportunity
      let opportunityId: string | undefined
      if (input.createOpportunity !== false) {
        const oppValue = await nextCounterValueInTx(input.organisationId, 'opportunity', tx)
        const stage: OpportunityStage = 'DISCOVERY'
        const probability = DEFAULT_STAGE_PROBABILITY[stage.toLowerCase()] ?? 10
        const amount = input.opportunity?.amount ?? 0
        opportunityId = (
          await tx.opportunity.create({
            data: {
              organisationId: input.organisationId,
              opportunityNumber: `OPP-${oppValue.toString().padStart(6, '0')}`,
              accountId: account.id,
              primaryContactId: contact.id,
              name: input.opportunity?.name ?? `${accountName} — AuraDeck CRM`,
              type: 'NEW_BUSINESS',
              stage,
              amount: new Prisma.Decimal(amount),
              currency: 'INR',
              probability,
              weightedAmount: new Prisma.Decimal(computeWeightedAmount(amount, probability)),
              expectedCloseDate: input.opportunity?.expectedCloseDate ?? undefined,
              billingFrequency: input.opportunity?.billingFrequency ?? 'monthly',
              ownerUserId: input.opportunity?.ownerUserId ?? lead.assignedToUserId ?? input.actorUserId,
              forecastCategory: 'PIPELINE',
              source: lead.leadSource,
            },
          })
        ).id

        await tx.opportunityStageHistory.create({
          data: {
            opportunityId,
            fromStage: null,
            toStage: 'DISCOVERY',
            changedByUserId: input.actorUserId,
            reason: `Converted from lead ${lead.leadNumber}`,
          },
        })
      }

      // 4. Mark lead converted (preserving complete history)
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          lifecycleStage: 'CONVERTED',
          convertedAccountId: account.id,
          convertedContactId: contact.id,
        },
      })

      return { accountId: account.id, contactId: contact.id, opportunityId }
    },
    { isolationLevel: 'Serializable', timeout: 15_000 }
  )
}

/** Leads in these stages are "dead": hidden from the board and the dashboard, shown only in the Dead view. */
export const DEAD_LEAD_STAGES = ['LOST', 'DISQUALIFIED'] as const
