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
import { v4 as uuidv4 } from 'uuid'

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
      convertedAccount: {
        select: {
          id: true,
          accountName: true,
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
    select: { id: true, leadNumber: true, lifecycleStage: true },
  })
  if (!lead) throw new NotFoundError('Lead not found')

  const body = await parseJsonBody(req, leadUpdateSchema)
  if (body.lifecycleStage === 'converted') {
    throw new ValidationFailedError('Use the lead conversion action to convert a lead')
  }

  const before = { lifecycleStage: lead.lifecycleStage }
  const updated = await db.$transaction(async (tx) => {
    const updatedLead = await tx.lead.update({
      where: { id: lead.id },
      data: {
        ...(body.firstName ? { firstName: body.firstName, fullName: `${body.firstName} ${(body as { lastName?: string }).lastName ?? ''}` } : {}),
        ...(body.lastName ? { lastName: body.lastName } : {}),
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
        ...(body.nextFollowUpAt !== undefined ? { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null } : {}),
        ...(body.consentStatus !== undefined ? { consentStatus: body.consentStatus } : {}),
        ...(body.consentSource !== undefined ? { consentSource: body.consentSource } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        ...(body.customFields ? { customFields: body.customFields } : {}),
        ...(body.lifecycleStage ? { lifecycleStage: body.lifecycleStage.toUpperCase() as never } : {}),
      },
    })
    if (
      lead.lifecycleStage !== updatedLead.lifecycleStage &&
      ['LOST', 'DISQUALIFIED'].includes(updatedLead.lifecycleStage)
    ) {
      await tx.activity.create({
        data: {
          organisationId,
          activityType: 'NOTE',
          subject: updatedLead.lifecycleStage === 'LOST' ? 'Lead marked as dead' : 'Lead disqualified',
          description: `Lead moved from ${lead.lifecycleStage} to ${updatedLead.lifecycleStage}.`,
          outcome: updatedLead.lifecycleStage === 'LOST' ? 'Lead closed as lost' : 'Lead disqualified',
          status: 'COMPLETED',
          ownerUserId: user.id,
          assignedToUserId: user.id,
          relatedLeadId: lead.id,
          visibility: 'TEAM',
          createdBy: user.id,
        },
      })
    }
    return updatedLead
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.update',
    resourceType: 'lead',
    resourceId: lead.id,
    beforeJson: before,
    afterJson: { lifecycleStage: updated.lifecycleStage },
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
