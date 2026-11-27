/**
 * /api/leads/[id] — detail (GET), update (PATCH), soft-delete (DELETE).
 * Tenant-scoped lookup prevents IDOR; permissions enforced per action.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody } from '@/lib/utils/api-helpers'
import { routeHandler } from '@/lib/utils/api-helpers'
import { leadUpdateSchema } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError, ValidationFailedError } from '@/lib/services/errors'
import { normalizePhone } from '@/lib/validations/common'
import { resolveLeadScope } from '@/lib/reports/scope'
import { assertActiveMember, assertCanAssign } from '@/lib/services/assignment'
import { v4 as uuidv4 } from 'uuid'
import { DEAD_LEAD_STAGES, stageLabel } from '@/lib/leads/stages'
import { applyStageFlow } from '@/lib/leads/stage-flow'
import { addExtraContact, lockedSourceFields, parseExtraContacts, removeExtraContact } from '@/lib/leads/extra-contacts'
import { PROFILE_DATE_FIELDS, PROFILE_TEXT_FIELDS, profileDefaultsForStage } from '@/lib/leads/profile'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.LEADS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const recordScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const lead = await db.lead.findFirst({
    where: { AND: [{ id, organisationId, deletedAt: null }, recordScope] },
    include: {
      assignedTo: { select: { id: true, fullName: true, avatarUrl: true } },
      campaign: { select: { id: true, name: true } },
      opportunity: { select: { id: true, opportunityNumber: true, name: true, stage: true } },
      convertedAccount: {
        select: {
          id: true,
          accountName: true,
          lifecycleStage: true,
          _count: { select: { tickets: true } },
          paymentStatus: true,
          mrr: true,
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, startDate: true, renewalDate: true, amount: true, currency: true },
          },
          invoices: {
            orderBy: { issueDate: 'desc' },
            take: 3,
            select: {
              invoiceNumber: true,
              status: true,
              issueDate: true,
              dueDate: true,
              total: true,
              amountPaid: true,
              amountDue: true,
              payments: {
                where: { status: 'SUCCESS' },
                orderBy: { paidAt: 'desc' },
                take: 1,
                select: { paidAt: true, amount: true, currency: true },
              },
            },
          },
          onboardingProjects: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, targetGoLiveDate: true, progressPercentage: true },
          },
        },
      },
    },
  })
  if (!lead) throw new NotFoundError('Lead not found')

  return NextResponse.json(
    { success: true, data: { lead, activities: await listRecentActivities(lead.id, user.id, lead.convertedAccount?.id) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

async function listRecentActivities(leadId: string, userId: string, accountId?: string) {
  return db.activity.findMany({
    where: {
      AND: [
        { OR: [{ relatedLeadId: leadId }, ...(accountId ? [{ relatedAccountId: accountId }] : [])] },
        {
          OR: [
            { visibility: 'ORGANISATION' },
            { visibility: 'TEAM' },
            { ownerUserId: userId },
            { assignedToUserId: userId },
            { createdBy: userId },
          ],
        },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, activityType: true, subject: true, status: true, externalReference: true,
      description: true, outcome: true, createdAt: true, dueAt: true,
      ownerUserId: true, assignedToUserId: true,
    },
  })
}

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.LEADS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash, userAgentHash } = guard.context!
  const recordScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)

  const lead = await db.lead.findFirst({
    where: { AND: [{ id, organisationId, deletedAt: null }, recordScope] },
    select: {
      id: true, leadNumber: true, lifecycleStage: true, isPriority: true, assignedToUserId: true, assignedTeamId: true,
      firstName: true, lastName: true, email: true, phoneNumber: true, alternatePhone: true, whatsappNumber: true, extraContacts: true, firstContactedAt: true,
      signedUpAt: true, trialStartAt: true, demoStatus: true, paymentStatus: true, outcome: true,
    },
  })
  if (!lead) throw new NotFoundError('Lead not found')

  const body = await parseJsonBody(req, leadUpdateSchema)
  // Email / phone that came from the source (sheet, form, import) are read-only once set;
  // extra numbers and profiles are added as extra contacts instead.
  const locked = lockedSourceFields(lead, body)
  if (locked.length) {
    throw new ValidationFailedError(`${locked.join(', ')} came from the lead source and cannot be changed. Add it under "Add contact" instead.`)
  }
  let extraContacts: ReturnType<typeof parseExtraContacts> | undefined
  if (body.addExtraContact || body.removeExtraContactId) {
    extraContacts = parseExtraContacts(lead.extraContacts)
    if (body.removeExtraContactId) extraContacts = removeExtraContact(extraContacts, body.removeExtraContactId)
    if (body.addExtraContact) extraContacts = addExtraContact(extraContacts, body.addExtraContact, user.id)
  }
  const firstName = body.firstName ?? lead.firstName
  const lastName = body.lastName ?? lead.lastName
  const nameChanged = firstName !== lead.firstName || lastName !== lead.lastName
  // Re-assigning a lead (person or team) is its own permission, not part of editing.
  if (body.assignedToUserId !== undefined) {
    assertCanAssign(ctx, { currentOwnerId: lead.assignedToUserId, nextOwnerId: body.assignedToUserId ?? null })
    if (body.assignedToUserId && body.assignedToUserId !== lead.assignedToUserId) {
      await assertActiveMember(organisationId, body.assignedToUserId)
    }
  }
  if (body.assignedTeamId !== undefined && (body.assignedTeamId ?? null) !== lead.assignedTeamId) {
    assertCanAssign(ctx, { currentOwnerId: 'team', nextOwnerId: 'changed' })
  }

  // Therapist record fields; a stage move fills in what the team has not set yet.
  const profile: Record<string, unknown> = {}
  for (const key of PROFILE_DATE_FIELDS) if (body[key] !== undefined) profile[key] = body[key] ? new Date(body[key]!) : null
  for (const key of PROFILE_TEXT_FIELDS) if (body[key] !== undefined) profile[key] = body[key] || null
  for (const key of ['demoStatus', 'willingnessToPay', 'paymentStatus', 'outcome'] as const) {
    if (body[key] !== undefined) profile[key] = body[key] ?? null
  }
  const nextStage = body.lifecycleStage?.toUpperCase()
  if (nextStage && nextStage !== lead.lifecycleStage) {
    for (const [key, value] of Object.entries(profileDefaultsForStage(nextStage, lead))) {
      if (profile[key] === undefined) profile[key] = value
    }
  }

  const before = {
    lifecycleStage: lead.lifecycleStage,
    isPriority: lead.isPriority,
    ...(nameChanged ? { fullName: `${lead.firstName} ${lead.lastName}`.trim() } : {}),
  }
  const updated = await db.$transaction(async (tx) => {
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: {
        ...(nameChanged ? { firstName, lastName, fullName: `${firstName} ${lastName}`.trim() } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phoneNumber: body.phone ? normalizePhone(body.phone) : undefined, phoneCountryCode: body.phone?.startsWith('+') ? body.phone.slice(1, 3) : undefined } : {}),
        ...(body.alternatePhone !== undefined ? { alternatePhone: body.alternatePhone } : {}),
        ...(body.whatsappNumber !== undefined ? { whatsappNumber: body.whatsappNumber } : {}),
        ...(body.organisationName !== undefined ? { organisationName: body.organisationName } : {}),
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
        ...(body.website !== undefined ? { website: body.website } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.leadSource ? { leadSource: body.leadSource.toUpperCase() as never } : {}),
        ...(body.sourceDetail !== undefined ? { sourceDetail: body.sourceDetail } : {}),
        ...(body.campaignId !== undefined ? { campaignId: body.campaignId } : {}),
        ...(body.qualificationStatus !== undefined ? { qualificationStatus: body.qualificationStatus } : {}),
        ...(body.estimatedPracticeSize !== undefined ? { estimatedPracticeSize: body.estimatedPracticeSize } : {}),
        ...(body.estimatedUsers !== undefined ? { estimatedUsers: body.estimatedUsers } : {}),
        ...(body.currentSoftware !== undefined ? { currentSoftware: body.currentSoftware } : {}),
        ...(body.painPoints !== undefined ? { painPoints: body.painPoints } : {}),
        ...(body.useCase !== undefined ? { useCase: body.useCase } : {}),
        ...(body.budgetRange !== undefined ? { budgetRange: body.budgetRange } : {}),
        ...(body.expectedTimeline !== undefined ? { expectedTimeline: body.expectedTimeline } : {}),
        ...(body.preferredContactMethod !== undefined ? { preferredContactMethod: body.preferredContactMethod?.toUpperCase() ?? null } : {}),
        ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}),
        ...(body.assignedTeamId !== undefined ? { assignedTeamId: body.assignedTeamId } : {}),
        ...(body.nextAction !== undefined ? { nextAction: body.nextAction || null } : {}),
        ...(extraContacts ? { extraContacts: extraContacts as never } : {}),
        ...(body.nextFollowUpAt !== undefined ? { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null } : {}),
        ...(body.consentStatus !== undefined ? { consentStatus: body.consentStatus } : {}),
        ...(body.consentSource !== undefined ? { consentSource: body.consentSource } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.customFields ? { customFields: body.customFields } : {}),
        ...(body.lifecycleStage ? { lifecycleStage: body.lifecycleStage.toUpperCase() as never } : {}),
        // Leaving the New inbox = first outreach; record its date once.
        ...(body.lifecycleStage && body.lifecycleStage !== 'new' && !lead.firstContactedAt ? { firstContactedAt: new Date() } : {}),
        ...(body.isPriority !== undefined ? { isPriority: body.isPriority } : {}),
        ...profile,
      },
    })
    let flowNotes: string[] = []
    if (lead.lifecycleStage !== updatedLead.lifecycleStage) {
      const dead = (DEAD_LEAD_STAGES as readonly string[]).includes(updatedLead.lifecycleStage)
      // Deal, customer account, onboarding follow the stage (see stage-flow.ts).
      flowNotes = await applyStageFlow(tx, { organisationId, leadId: lead.id, from: lead.lifecycleStage, actorUserId: user.id })
      // Every stage move is written to the lead's history so the pipeline is auditable.
      await tx.activity.create({
        data: {
          organisationId,
          activityType: 'NOTE',
          subject: dead ? 'Lead marked as dead' : `Stage: ${stageLabel(updatedLead.lifecycleStage)}`,
          description: `Lead moved from ${stageLabel(lead.lifecycleStage)} to ${stageLabel(updatedLead.lifecycleStage)}.${flowNotes.length ? ` ${flowNotes.join('. ')}.` : ''}`,
          outcome: dead ? 'Lead closed as dead' : null,
          status: 'COMPLETED',
          ownerUserId: user.id,
          assignedToUserId: user.id,
          relatedLeadId: lead.id,
          visibility: 'TEAM',
          createdBy: user.id,
        },
      })
    }
    return { ...updatedLead, flowNotes }
  }, { timeout: 15_000 })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.update',
    resourceType: 'lead',
    resourceId: lead.id,
    beforeJson: before,
    afterJson: {
      lifecycleStage: updated.lifecycleStage,
      isPriority: updated.isPriority,
      ...(nameChanged ? { fullName: updated.fullName } : {}),
      ...(extraContacts ? { extraContacts: extraContacts.length } : {}),
      ...(Object.keys(profile).length ? { profileFields: Object.keys(profile) } : {}),
      ...(updated.flowNotes.length ? { stageFlow: updated.flowNotes } : {}),
    },
    ipHash,
    userAgentHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.LEADS_DELETE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!
  const recordScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)

  const lead = await db.lead.findFirst({
    where: { AND: [{ id, organisationId, deletedAt: null }, recordScope] },
    select: { id: true, leadNumber: true },
  })
  if (!lead) throw new NotFoundError('Lead not found')

  await db.lead.update({
    where: { id: lead.id },
    data: { deletedAt: new Date() },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.soft_delete',
    resourceType: 'lead',
    resourceId: lead.id,
    beforeJson: { deletedAt: null },
    afterJson: { deletedAt: new Date().toISOString() },
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
