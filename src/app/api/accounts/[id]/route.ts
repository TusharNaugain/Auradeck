/**
 * /api/accounts/[id] — detail with health events + related record counts (GET),
 * update (PATCH), delete is an AuraDeck-internal management action (DELETE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { accountUpdateSchema } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { z } from 'zod'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ACCOUNTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, user, ctx } = guard.context!

  const account = await db.account.findFirst({
    where: { id, organisationId },
    include: {
      owner: { select: { id: true, fullName: true } },
      csmUser: { select: { id: true, fullName: true } },
      supportOwner: { select: { id: true, fullName: true } },
      plan: { select: { id: true, name: true, monthlyPrice: true } },
      healthScoreEvents: { orderBy: { createdAt: 'desc' }, take: 20 },
      ...(ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW) ? {
        contacts: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            whatsappNumber: true,
            jobTitle: true,
            lastContactedAt: true,
          },
        },
      } : {}),
      opportunities: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, name: true, stage: true, amount: true, type: true },
      },
      subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      _count: {
        select: { contacts: true, tickets: true, onboardingProjects: true },
      },
    },
  })
  if (!account) throw new NotFoundError('Account not found')

  const activities = ctx.permissions.has(PERMISSIONS.ACTIVITIES_VIEW) ? await db.activity.findMany({
    where: {
      relatedAccountId: id,
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
      id: true,
      activityType: true,
      subject: true,
      status: true,
      description: true,
      outcome: true,
      dueAt: true,
      createdAt: true,
    },
  }) : []

  return NextResponse.json(
    { success: true, data: { account, activities }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACCOUNTS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const account = await db.account.findFirst({
    where: { id, organisationId },
    select: { id: true, accountName: true, healthStatus: true, healthScore: true },
  })
  if (!account) throw new NotFoundError('Account not found')

  let body: z.infer<typeof accountUpdateSchema>
  try {
    body = accountUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const before = { healthStatus: account.healthStatus, healthScore: account.healthScore }

  const updated = await db.account.update({
    where: { id: account.id },
    data: {
      ...(body.accountName ? { accountName: body.accountName } : {}),
      ...(body.accountType !== undefined ? { accountType: body.accountType } : {}),
      ...(body.segment !== undefined ? { segment: body.segment } : {}),
      ...(body.lifecycleStage !== undefined ? { lifecycleStage: body.lifecycleStage } : {}),
      ...(body.ownerUserId !== undefined ? { ownerUserId: body.ownerUserId } : {}),
      ...(body.csmUserId !== undefined ? { csmUserId: body.csmUserId } : {}),
      ...(body.supportOwnerUserId !== undefined ? { supportOwnerUserId: body.supportOwnerUserId } : {}),
      ...(body.healthStatus ? { healthStatus: body.healthStatus.toUpperCase() as never } : {}),
      ...(body.healthScore !== undefined ? { healthScore: body.healthScore } : {}),
      ...(body.planId !== undefined ? { planId: body.planId } : {}),
      ...(body.mrr !== undefined ? { mrr: body.mrr } : {}),
      ...(body.arr !== undefined ? { arr: body.arr } : {}),
      ...(body.contractValue !== undefined ? { contractValue: body.contractValue } : {}),
      ...(body.paymentStatus !== undefined ? { paymentStatus: body.paymentStatus } : {}),
      ...(body.renewalDate !== undefined ? { renewalDate: body.renewalDate ? new Date(body.renewalDate) : null } : {}),
      ...(body.nextBusinessReviewAt !== undefined ? { nextBusinessReviewAt: body.nextBusinessReviewAt ? new Date(body.nextBusinessReviewAt) : null } : {}),
      ...(body.npsScore !== undefined ? { npsScore: body.npsScore } : {}),
      ...(body.activeUsersCount !== undefined ? { activeUsersCount: body.activeUsersCount } : {}),
      ...(body.licensedUsersCount !== undefined ? { licensedUsersCount: body.licensedUsersCount } : {}),
      ...(body.expansionPotential !== undefined ? { expansionPotential: body.expansionPotential?.toUpperCase() } : {}),
      ...(body.riskReason !== undefined ? { riskReason: body.riskReason } : {}),
      ...(body.competitors !== undefined ? { competitors: body.competitors } : {}),
      ...(body.strategicNotes !== undefined ? { strategicNotes: body.strategicNotes } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'account.update',
    resourceType: 'account',
    resourceId: account.id,
    beforeJson: before,
    afterJson: { healthStatus: updated.healthStatus, healthScore: updated.healthScore },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACCOUNTS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const account = await db.account.findFirst({
    where: { id, organisationId },
    select: { id: true, accountName: true },
  })
  if (!account) throw new NotFoundError('Account not found')

  // Accounts aren't deleted — they're archived to preserve CRM lifecycle integrity.
  await db.account.update({
    where: { id: account.id },
    data: { lifecycleStage: 'archived' },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'account.archive',
    resourceType: 'account',
    resourceId: account.id,
    beforeJson: { lifecycleStage: 'archived' },
    ipHash,
  })

  return NextResponse.json({ success: true, data: { archived: true }, requestId: uuidv4() })
})
