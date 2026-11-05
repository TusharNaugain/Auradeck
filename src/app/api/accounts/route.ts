/**
 * /api/accounts — customer practice CRM profiles. List (GET), create (POST).
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type HealthStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { accountListSchema, accountCreateSchema } from '@/lib/validations/crm'
import { searchTerm } from '@/lib/utils/list'
import { nextNumber } from '@/lib/services/numbering'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { createNotifications } from '@/lib/services/notifications'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ACCOUNTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!
  const canViewContacts = ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW)

  const { searchParams } = new URL(req.url)
  const query = accountListSchema.parse(Object.fromEntries(searchParams))

  // Record-level visibility: OWN = records I own or manage as CSM,
  // TEAM = records owned by any active member of my team, else organisation-wide.
  let scopeFilter: Prisma.AccountWhereInput = {}
  if (ctx.scopeType === 'OWN') {
    scopeFilter = { OR: [{ ownerUserId: user.id }, { csmUserId: user.id }] }
  } else if (ctx.scopeType === 'TEAM' && ctx.teamId) {
    const teammates = await db.membership.findMany({
      where: { organisationId, teamId: ctx.teamId, status: 'ACTIVE' },
      select: { userId: true },
    })
    const userIds = teammates.map((m) => m.userId)
    scopeFilter = { OR: [{ ownerUserId: { in: userIds } }, { csmUserId: { in: userIds } }] }
  }

  const where: Prisma.AccountWhereInput = {
    AND: [
      { organisationId },
      scopeFilter,
      ...(query.healthStatus ? [{ healthStatus: query.healthStatus.toUpperCase() as HealthStatus }] : []),
      ...(query.segment ? [{ segment: query.segment }] : []),
      ...(query.ownerUserId ? [{ ownerUserId: query.ownerUserId }] : []),
      ...(query.csmUserId ? [{ csmUserId: query.csmUserId }] : []),
      ...(query.renewalWithinDays
        ? [{ renewalDate: { lte: new Date(Date.now() + query.renewalWithinDays * 24 * 3600 * 1000) } }]
        : []),
      ...(query.search ? [{ OR: searchTerm(query.search, ['accountName', 'customerAccountCode']) }] : []),
    ],
  }

  const [items, total] = await Promise.all([
    db.account.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, customerAccountCode: true, accountName: true, accountType: true,
        segment: true, healthStatus: true, healthScore: true, mrr: true,
        renewalDate: true, ownerUserId: true, csmUserId: true, tags: true, createdAt: true,
        ...(canViewContacts ? {
          contacts: {
            where: { deletedAt: null },
            orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
            take: 1,
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
      },
    }),
    db.account.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACCOUNTS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, accountCreateSchema)

  const codeValue = await nextNumber(organisationId, 'account')
  const customerAccountCode = body.customerAccountCode ?? codeValue

  const account = await db.account.create({
    data: {
      organisationId,
      customerAccountCode,
      accountName: body.accountName,
      accountType: body.accountType,
      segment: body.segment,
      lifecycleStage: body.lifecycleStage ?? 'onboarding',
      ownerUserId: body.ownerUserId ?? user.id,
      csmUserId: body.csmUserId,
      supportOwnerUserId: body.supportOwnerUserId,
      healthStatus: (body.healthStatus?.toUpperCase() ?? 'UNKNOWN') as HealthStatus,
      healthScore: body.healthScore ?? 50,
      planId: body.planId,
      mrr: body.mrr,
      arr: body.arr,
      contractValue: body.contractValue,
      paymentStatus: body.paymentStatus,
      renewalDate: body.renewalDate ? new Date(body.renewalDate) : undefined,
      nextBusinessReviewAt: body.nextBusinessReviewAt ? new Date(body.nextBusinessReviewAt) : undefined,
      npsScore: body.npsScore,
      activeUsersCount: body.activeUsersCount,
      licensedUsersCount: body.licensedUsersCount,
      expansionPotential: body.expansionPotential?.toUpperCase(),
      riskReason: body.riskReason,
      competitors: body.competitors,
      strategicNotes: body.strategicNotes,
      tags: body.tags ?? [],
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'account.create',
    resourceType: 'account',
    resourceId: account.id,
    ipHash,
    afterJson: { accountName: account.accountName, code: account.customerAccountCode },
  })

  if (body.csmUserId) {
    await createNotifications({
      userIds: [body.csmUserId],
      organisationId,
      type: 'account.created',
      title: `New account: ${account.accountName}`,
      message: 'A new practice was created and assigned to you.',
      severity: 'info',
      actionUrl: `/accounts/${account.id}`,
    })
  }

  return NextResponse.json({ success: true, data: account, requestId: uuidv4() }, { status: 201 })
})
