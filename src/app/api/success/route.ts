/**
 * /api/success — customer success plans: list (GET) and create (POST).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { successPlanListSchema, successPlanCreateSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.SUCCESS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = successPlanListSchema.parse(Object.fromEntries(searchParams))

  const where = {
    account: { organisationId },
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
  }
  void where

  const [items, total] = await Promise.all([
    db.successPlan.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        account: { select: { id: true, accountName: true, healthStatus: true } },
        owner: { select: { id: true, fullName: true } },
      },
    }),
    db.successPlan.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.SUCCESS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, successPlanCreateSchema)

  const account = await db.account.findFirst({
    where: { id: body.accountId, organisationId },
    select: { id: true },
  })
  if (!account) throw new NotFoundError('Account not found in this organisation')

  const plan = await db.successPlan.create({
    data: {
      accountId: account.id,
      ownerUserId: body.ownerUserId ?? user.id,
      objective: body.objective,
      targetOutcome: body.targetOutcome,
      metricName: body.metricName,
      baselineValue: body.baselineValue,
      targetValue: body.targetValue,
      currentValue: body.currentValue,
      targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
      status: body.status?.toUpperCase() as never,
      progressPercentage: 0,
      risks: body.risks,
      nextReviewDate: body.nextReviewDate ? new Date(body.nextReviewDate) : undefined,
      notes: body.notes,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'success_plan.create',
    resourceType: 'success_plan',
    resourceId: plan.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: plan, requestId: uuidv4() }, { status: 201 })
})

// Success plan detail routes live in [id]/route.ts
