/**
 * /api/opportunities/[id] — detail with full stage history (GET), update incl. stage
 * transition + history entry + event notifications (PATCH), soft delete (DELETE).
 */

import { NextRequest, NextResponse } from 'next/server'
import type { ForecastCategory, OpportunityStage, OpportunityType } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { opportunityUpdateSchema, computeWeightedAmount, DEFAULT_STAGE_PROBABILITY } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { createNotifications } from '@/lib/services/notifications'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.OPPORTUNITIES_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const opportunity = await db.opportunity.findFirst({
    where: { id, organisationId, deletedAt: null },
    include: {
      account: { select: { id: true, accountName: true, customerAccountCode: true } },
      primaryContact: {
        select: {
          id: true,
          fullName: true,
          email: true,
          ...(ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW)
            ? { phoneNumber: true, whatsappNumber: true }
            : {}),
          jobTitle: true,
        },
      },
      owner: { select: { id: true, fullName: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
      plan: { select: { id: true, name: true } },
      stageHistory: { orderBy: { createdAt: 'desc' } },
      _count: { select: { activities: true } },
    },
  })
  if (!opportunity) throw new NotFoundError('Opportunity not found')

  const activities = await db.activity.findMany({
    where: {
      relatedOpportunityId: id,
      OR: [
        { visibility: 'ORGANISATION' },
        { visibility: 'TEAM' },
        { ownerUserId: user.id },
        { assignedToUserId: user.id },
        { createdBy: user.id },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, activityType: true, subject: true, status: true,
      description: true, outcome: true, dueAt: true, createdAt: true,
    },
  })

  return NextResponse.json(
    { success: true, data: { opportunity, activities }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.OPPORTUNITIES_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const opportunity = await db.opportunity.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true, stage: true, amount: true, probability: true, accountId: true, primaryContactId: true },
  })
  if (!opportunity) throw new NotFoundError('Opportunity not found')

  let body
  try {
    body = opportunityUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const before = { stage: opportunity.stage, amount: String(opportunity.amount) }
  const requestedStage = body.stage?.toUpperCase() as OpportunityStage | undefined
  const stageChanged = requestedStage !== undefined && requestedStage !== opportunity.stage

  // Closed opportunities cannot move further
  if (['WON', 'LOST'].includes(opportunity.stage) && stageChanged) {
    return NextResponse.json(
      {
        success: false,
        error: 'Closed opportunities cannot be reopened. Create a new opportunity instead.',
        code: 'CONFLICT',
        requestId: uuidv4(),
      },
      { status: 409 }
    )
  }

  const finalStage: OpportunityStage = stageChanged ? requestedStage! : opportunity.stage
  const finalAmount = body.amount ?? Number(opportunity.amount)
  const finalProbability =
    body.probability ??
    (stageChanged
      ? DEFAULT_STAGE_PROBABILITY[finalStage.toLowerCase()] ?? opportunity.probability
      : opportunity.probability)
  const finalWeighted = computeWeightedAmount(finalAmount, finalProbability)
  const isClosed = finalStage === 'WON' || finalStage === 'LOST'

  const updated = await db.opportunity.update({
    where: { id: opportunity.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.type ? { type: body.type.toUpperCase() as OpportunityType } : {}),
      ...(stageChanged ? { stage: finalStage } : {}),
      ...(body.amount !== undefined ? { amount: finalAmount } : {}),
      ...(body.probability !== undefined || stageChanged ? { probability: finalProbability } : {}),
      ...(body.amount !== undefined || stageChanged ? { weightedAmount: finalWeighted } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.expectedCloseDate !== undefined ? { expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null } : {}),
      ...(body.contractStartDate !== undefined ? { contractStartDate: body.contractStartDate ? new Date(body.contractStartDate) : null } : {}),
      ...(body.contractEndDate !== undefined ? { contractEndDate: body.contractEndDate ? new Date(body.contractEndDate) : null } : {}),
      ...(body.planId !== undefined ? { planId: body.planId } : {}),
      ...(body.seatsOrUsers !== undefined ? { seatsOrUsers: body.seatsOrUsers } : {}),
      ...(body.billingFrequency !== undefined ? { billingFrequency: body.billingFrequency } : {}),
      ...(body.nextStep !== undefined ? { nextStep: body.nextStep } : {}),
      ...(body.competitor !== undefined ? { competitor: body.competitor } : {}),
      ...(body.lossReason !== undefined ? { lossReason: body.lossReason } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
      ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
      ...(body.forecastCategory
        ? { forecastCategory: body.forecastCategory.toUpperCase() as ForecastCategory }
        : stageChanged && isClosed
          ? { forecastCategory: 'CLOSED' as const }
          : {}),
      ...(stageChanged && finalStage === 'WON' ? { wonAt: new Date() } : {}),
      ...(stageChanged && finalStage === 'LOST' ? { lostAt: new Date() } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    },
  })

  if (stageChanged) {
    await db.opportunityStageHistory.create({
      data: {
        opportunityId: opportunity.id,
        fromStage: opportunity.stage,
        toStage: finalStage,
        changedByUserId: user.id,
        reason: body.lossReason,
      },
    })

    // Notify CSM/manager when WON for immediate onboarding
    if (finalStage === 'WON') {
      const csmRoles = await db.membership.findMany({
        where: { organisationId, status: 'ACTIVE', role: { slug: { in: ['csm_head', 'csm'] } } },
        select: { userId: true },
      })
      await createNotifications({
        userIds: csmRoles.map((m) => m.userId),
        organisationId,
        type: 'onboarding.required',
        title: `Opportunity WON: ${updated.name}`,
        message: 'A deal closed — create an onboarding project and assign owners.',
        severity: 'success',
        actionUrl: `/opportunities/${updated.id}`,
      })
    }
  }

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'opportunity.update',
    resourceType: 'opportunity',
    resourceId: opportunity.id,
    beforeJson: before,
    afterJson: { stage: updated.stage, amount: String(updated.amount), probability: updated.probability },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.OPPORTUNITIES_DELETE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const opportunity = await db.opportunity.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true },
  })
  if (!opportunity) throw new NotFoundError('Opportunity not found')

  await db.opportunity.update({ where: { id: opportunity.id }, data: { deletedAt: new Date() } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'opportunity.soft_delete',
    resourceType: 'opportunity',
    resourceId: opportunity.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
