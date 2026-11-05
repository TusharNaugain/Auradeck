/**
 * /api/success/[id] — success plan detail (GET) and update (PATCH).
 * Updates the plan's progress + current metric value.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { successPlanUpdateSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.SUCCESS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const plan = await db.successPlan.findFirst({
    where: { id, account: { organisationId } },
    include: {
      account: { select: { id: true, accountName: true, healthStatus: true, healthScore: true } },
      owner: { select: { id: true, fullName: true } },
    },
  })
  if (!plan) throw new NotFoundError('Success plan not found')

  return NextResponse.json(
    { success: true, data: { plan }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.SUCCESS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const plan = await db.successPlan.findFirst({
    where: { id, account: { organisationId } },
    select: { id: true, progressPercentage: true },
  })
  if (!plan) throw new NotFoundError('Success plan not found')

  let body
  try {
    body = successPlanUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const updated = await db.successPlan.update({
    where: { id: plan.id },
    data: {
      ...(body.objective ? { objective: body.objective } : {}),
      ...(body.targetOutcome !== undefined ? { targetOutcome: body.targetOutcome } : {}),
      ...(body.metricName !== undefined ? { metricName: body.metricName } : {}),
      ...(body.baselineValue !== undefined ? { baselineValue: body.baselineValue } : {}),
      ...(body.targetValue !== undefined ? { targetValue: body.targetValue } : {}),
      ...(body.currentValue !== undefined ? { currentValue: body.currentValue } : {}),
      ...(body.targetDate !== undefined ? { targetDate: body.targetDate ? new Date(body.targetDate) : null } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as never } : {}),
      ...(body.progressPercentage !== undefined ? { progressPercentage: body.progressPercentage } : {}),
      ...(body.risks !== undefined ? { risks: body.risks } : {}),
      ...(body.nextReviewDate !== undefined ? { nextReviewDate: body.nextReviewDate ? new Date(body.nextReviewDate) : null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'success_plan.update',
    resourceType: 'success_plan',
    resourceId: plan.id,
    beforeJson: { progress: plan.progressPercentage },
    afterJson: { progress: updated.progressPercentage },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.SUCCESS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const plan = await db.successPlan.findFirst({
    where: { id, account: { organisationId } },
    select: { id: true },
  })
  if (!plan) throw new NotFoundError('Success plan not found')

  await db.successPlan.delete({ where: { id: plan.id } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'success_plan.delete',
    resourceType: 'success_plan',
    resourceId: plan.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
