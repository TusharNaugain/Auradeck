/**
 * /api/opportunities — list (GET) and create (POST) with stage history support.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import {
  opportunityListSchema,
  opportunityCreateSchema,
  computeWeightedAmount,
  DEFAULT_STAGE_PROBABILITY,
} from '@/lib/validations/crm'
import { searchTerm } from '@/lib/utils/list'
import { nextNumber } from '@/lib/services/numbering'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.OPPORTUNITIES_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!
  const canViewContacts = ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW)

  const { searchParams } = new URL(req.url)
  const query = opportunityListSchema.parse(Object.fromEntries(searchParams))

  const searchOr = searchTerm(query.search, ['name', 'opportunityNumber'])
  const dateFilter = query.dateRange?.from || query.dateRange?.to
    ? {
        createdAt: {
          ...(query.dateRange.from ? { gte: new Date(query.dateRange.from) } : {}),
          ...(query.dateRange.to ? { lte: new Date(query.dateRange.to) } : {}),
        },
      }
    : {}

  const where = {
    organisationId,
    deletedAt: null,
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.stage ? { stage: query.stage.toUpperCase() as never } : {}),
    ...(query.type ? { type: query.type.toUpperCase() as never } : {}),
    ...(query.forecastCategory ? { forecastCategory: query.forecastCategory.toUpperCase() as never } : {}),
    ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...dateFilter,
    ...(query.search ? { OR: searchOr } : {}),
    ...(ctx.scopeType === 'OWN' ? { ownerUserId: user.id } : {}),
  }

  const [items, total] = await Promise.all([
    db.opportunity.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, opportunityNumber: true, name: true, type: true, stage: true,
        amount: true, weightedAmount: true, probability: true,
        expectedCloseDate: true, wonAt: true, account: { select: { id: true, accountName: true } },
        primaryContact: {
          select: {
            id: true,
            fullName: true,
            email: true,
            ...(canViewContacts ? { phoneNumber: true, whatsappNumber: true, jobTitle: true } : {}),
          },
        },
        owner: { select: { id: true, fullName: true } }, forecastCategory: true, createdAt: true,
      },
    }),
    db.opportunity.count({ where }),
  ])

  void ctx
  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.OPPORTUNITIES_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, opportunityCreateSchema)

  const opportunityNumber = await nextNumber(organisationId, 'opportunity')
  const probability = body.probability ?? DEFAULT_STAGE_PROBABILITY[body.stage] ?? 10
  const weighted = computeWeightedAmount(body.amount, probability)

  const opportunity = await db.opportunity.create({
    data: {
      organisationId,
      opportunityNumber,
      accountId: body.accountId ?? undefined,
      primaryContactId: body.primaryContactId ?? undefined,
      name: body.name,
      type: body.type.toUpperCase() as never,
      stage: body.stage.toUpperCase() as never,
      amount: body.amount,
      currency: body.currency,
      probability,
      weightedAmount: weighted,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : undefined,
      contractStartDate: body.contractStartDate ? new Date(body.contractStartDate) : undefined,
      contractEndDate: body.contractEndDate ? new Date(body.contractEndDate) : undefined,
      planId: body.planId,
      seatsOrUsers: body.seatsOrUsers,
      billingFrequency: body.billingFrequency,
      nextStep: body.nextStep,
      competitor: body.competitor,
      source: body.source,
      ownerUserId: body.ownerUserId ?? user.id,
      teamId: body.teamId,
      forecastCategory: (body.forecastCategory ?? 'pipeline').toUpperCase() as never,
      tags: body.tags ?? [],
      customFields: body.customFields ?? {},
    },
  })

  await db.opportunityStageHistory.create({
    data: {
      opportunityId: opportunity.id,
      fromStage: null,
      toStage: opportunity.stage,
      changedByUserId: user.id,
      reason: 'Created',
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'opportunity.create',
    resourceType: 'opportunity',
    resourceId: opportunity.id,
    ipHash,
    afterJson: { stage: opportunity.stage, amount: opportunity.amount, probability },
  })

  return NextResponse.json({ success: true, data: opportunity, requestId: uuidv4() }, { status: 201 })
})
