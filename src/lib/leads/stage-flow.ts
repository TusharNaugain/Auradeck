/**
 * What happens in the rest of the CRM when a lead moves stage. Runs inside the caller's
 * transaction so the lead and its linked records always change together.
 *
 *   3 Demo scheduled and later → a deal (Opportunity) exists for the lead
 *   5 Signed up / trial and later → customer Account + primary Contact exist, onboarding starts
 *   6 Activated → onboarding completed
 *   7 Paid → deal Won
 *   8 Churned / paused → account marked churned, unfinished onboarding cancelled
 *   Dead → open deal Lost
 *
 * Nothing is ever deleted; moving a lead back only re-opens / re-stages the deal.
 */

import { Prisma, type Lead, type OpportunityStage } from '@prisma/client'
import { computeWeightedAmount, DEFAULT_STAGE_PROBABILITY } from '@/lib/validations'
import { nextCounterValueInTx } from '@/lib/services/numbering'
import { FUNNEL_STAGES, type LeadStage } from '@/lib/leads/stages'

type Tx = Prisma.TransactionClient

const at = (stage: string) => FUNNEL_STAGES.indexOf(stage as LeadStage)
const reached = (stage: string, min: LeadStage) => at(stage) >= at(min)
const isCustomerStage = (stage: string) => stage !== 'LOST' && reached(stage, 'SIGNED_UP')

/** Lead stage → deal stage. null = leave the deal as it is. */
export function opportunityStageFor(stage: string): OpportunityStage | null {
  switch (stage) {
    case 'DEMO_SCHEDULED': return 'DEMO'
    case 'DEMO_ATTENDED': return 'SOLUTION_FIT'
    case 'SIGNED_UP':
    case 'ACTIVATED': return 'VERBAL_COMMIT'
    case 'PAID': return 'WON'
    case 'LOST': return 'LOST'
    default: return null // New → Interested (moved back) and Churned keep the deal as it was
  }
}

/** Lead stage → account lifecycle label. */
export function accountLifecycleFor(stage: string): string | null {
  switch (stage) {
    case 'SIGNED_UP': return 'trial'
    case 'ACTIVATED': return 'active'
    case 'PAID': return 'paid'
    case 'CHURNED': return 'churned'
    default: return null
  }
}

function probabilityFor(stage: OpportunityStage) {
  return DEFAULT_STAGE_PROBABILITY[stage.toLowerCase()] ?? (stage === 'WON' ? 100 : stage === 'LOST' ? 0 : 10)
}

/** Create the deal for a lead. Used by the stage flow and by manual conversion. */
export async function createLeadOpportunity(
  tx: Tx,
  lead: Lead,
  actorUserId: string | null,
  opts: { stage?: OpportunityStage; accountId?: string | null; contactId?: string | null; name?: string; amount?: number; expectedCloseDate?: Date; billingFrequency?: string; ownerUserId?: string } = {}
): Promise<string> {
  const stage = opts.stage ?? 'DEMO'
  const probability = probabilityFor(stage)
  const amount = opts.amount ?? 0
  const number = await nextCounterValueInTx(lead.organisationId, 'opportunity', tx)
  const opp = await tx.opportunity.create({
    data: {
      organisationId: lead.organisationId,
      opportunityNumber: `OPP-${number.toString().padStart(6, '0')}`,
      accountId: opts.accountId ?? lead.convertedAccountId ?? undefined,
      primaryContactId: opts.contactId ?? lead.convertedContactId ?? undefined,
      name: opts.name ?? `${lead.organisationName || lead.fullName} — AuraDeck`,
      type: 'NEW_BUSINESS',
      stage,
      amount: new Prisma.Decimal(amount),
      currency: 'INR',
      probability,
      weightedAmount: new Prisma.Decimal(computeWeightedAmount(amount, probability)),
      expectedCloseDate: opts.expectedCloseDate,
      billingFrequency: opts.billingFrequency ?? 'monthly',
      ownerUserId: opts.ownerUserId ?? lead.assignedToUserId ?? actorUserId ?? undefined,
      forecastCategory: stage === 'WON' || stage === 'LOST' ? 'CLOSED' : 'PIPELINE',
      source: lead.leadSource,
      ...(stage === 'WON' ? { wonAt: new Date() } : {}),
      ...(stage === 'LOST' ? { lostAt: new Date() } : {}),
    },
    select: { id: true },
  })
  await tx.opportunityStageHistory.create({
    data: { opportunityId: opp.id, fromStage: null, toStage: stage, changedByUserId: actorUserId, reason: `Created from lead ${lead.leadNumber}` },
  })
  await tx.lead.update({ where: { id: lead.id }, data: { opportunityId: opp.id } })
  return opp.id
}

/** Create the customer Account and its primary Contact from a lead. */
export async function createCustomerFromLead(
  tx: Tx,
  lead: Lead,
  actorUserId: string | null,
  opts: { accountName?: string; ownerUserId?: string } = {}
): Promise<{ accountId: string; contactId: string; accountName: string }> {
  const accountName = opts.accountName ?? (lead.organisationName || lead.fullName)
  const code = await nextCounterValueInTx(lead.organisationId, 'account', tx)
  const account = await tx.account.create({
    data: {
      organisationId: lead.organisationId,
      accountName,
      customerAccountCode: `ACC-${code.toString().padStart(6, '0')}`,
      ownerUserId: opts.ownerUserId ?? lead.assignedToUserId ?? actorUserId ?? undefined,
      lifecycleStage: accountLifecycleFor(lead.lifecycleStage) ?? 'trial',
      healthStatus: 'UNKNOWN',
      tags: lead.tags ?? [],
    },
  })
  const contact = await tx.contact.create({
    data: {
      organisationId: lead.organisationId,
      accountId: account.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: lead.fullName,
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
  await tx.lead.update({ where: { id: lead.id }, data: { convertedAccountId: account.id, convertedContactId: contact.id } })
  if (lead.opportunityId) {
    await tx.opportunity.update({ where: { id: lead.opportunityId }, data: { accountId: account.id, primaryContactId: contact.id } })
  }
  return { accountId: account.id, contactId: contact.id, accountName }
}

async function moveOpportunity(tx: Tx, opportunityId: string, to: OpportunityStage, actorUserId: string | null, reason: string) {
  const opp = await tx.opportunity.findUnique({ where: { id: opportunityId }, select: { stage: true, amount: true } })
  if (!opp || opp.stage === to) return false
  const probability = probabilityFor(to)
  await tx.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage: to,
      probability,
      weightedAmount: new Prisma.Decimal(computeWeightedAmount(Number(opp.amount), probability)),
      forecastCategory: to === 'WON' || to === 'LOST' ? 'CLOSED' : 'PIPELINE',
      wonAt: to === 'WON' ? new Date() : null,
      lostAt: to === 'LOST' ? new Date() : null,
    },
  })
  await tx.opportunityStageHistory.create({ data: { opportunityId, fromStage: opp.stage, toStage: to, changedByUserId: actorUserId, reason } })
  return true
}

/**
 * Apply the stage flow after a lead moved from `from` to its current stage.
 * Returns plain-language notes of what changed, for the lead's history.
 */
export async function applyStageFlow(
  tx: Tx,
  input: { organisationId: string; leadId: string; from: string; actorUserId: string | null }
): Promise<string[]> {
  let lead = await tx.lead.findFirst({ where: { id: input.leadId, organisationId: input.organisationId } })
  if (!lead || lead.lifecycleStage === input.from) return []
  const to = lead.lifecycleStage
  const notes: string[] = []
  const reason = `Lead ${lead.leadNumber} moved to ${to}`

  // 1. Deal (Opportunity)
  const dealStage = opportunityStageFor(to)
  if (!lead.opportunityId && to !== 'LOST' && reached(to, 'DEMO_SCHEDULED')) {
    await createLeadOpportunity(tx, lead, input.actorUserId, { stage: dealStage ?? 'DEMO' })
    notes.push('Deal created in Opportunities')
  } else if (lead.opportunityId && dealStage) {
    if (await moveOpportunity(tx, lead.opportunityId, dealStage, input.actorUserId, reason)) {
      notes.push(dealStage === 'WON' ? 'Deal marked Won' : dealStage === 'LOST' ? 'Deal marked Lost' : `Deal moved to ${dealStage.toLowerCase().replace(/_/g, ' ')}`)
    }
  }
  lead = (await tx.lead.findUnique({ where: { id: lead.id } }))!

  // 2. Customer Account + Contact, and onboarding
  if (isCustomerStage(to)) {
    let accountId = lead.convertedAccountId
    let accountName: string | null = null
    if (!accountId) {
      const created = await createCustomerFromLead(tx, lead, input.actorUserId)
      accountId = created.accountId
      accountName = created.accountName
      notes.push('Customer added to Accounts and Contacts')
    }
    const lifecycle = accountLifecycleFor(to)
    if (lifecycle) await tx.account.update({ where: { id: accountId }, data: { lifecycleStage: lifecycle } })

    const project = await tx.onboardingProject.findFirst({ where: { accountId }, orderBy: { createdAt: 'desc' } })
    if (!project && to !== 'CHURNED') {
      accountName ??= (await tx.account.findUnique({ where: { id: accountId }, select: { accountName: true } }))?.accountName ?? lead.fullName
      const done = to === 'ACTIVATED' || to === 'PAID'
      await tx.onboardingProject.create({
        data: {
          organisationId: lead.organisationId,
          accountId,
          projectName: `${accountName} onboarding`,
          status: done ? 'COMPLETED' : 'SCHEDULED',
          kickoffDate: new Date(),
          ...(done ? { progressPercentage: 100, actualGoLiveDate: new Date() } : {}),
          csmOwnerId: lead.assignedToUserId ?? undefined,
        },
      })
      notes.push(done ? 'Onboarding recorded as complete' : 'Onboarding started')
    } else if (project && (to === 'ACTIVATED' || to === 'PAID') && project.status !== 'COMPLETED') {
      await tx.onboardingProject.update({ where: { id: project.id }, data: { status: 'COMPLETED', progressPercentage: 100, actualGoLiveDate: new Date() } })
      notes.push('Onboarding marked complete')
    } else if (project && to === 'CHURNED' && !['COMPLETED', 'CANCELLED'].includes(project.status)) {
      await tx.onboardingProject.update({ where: { id: project.id }, data: { status: 'CANCELLED' } })
      notes.push('Unfinished onboarding cancelled')
    }
    if (to === 'CHURNED') notes.push('Account marked churned')
  }

  return notes
}
