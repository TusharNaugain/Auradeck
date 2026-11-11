/**
 * /api/leads — list (GET) and create (POST).
 * Tenant-scoped; dedupe on create; audit-logged.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody } from '@/lib/utils/api-helpers'
import { routeHandler } from '@/lib/utils/api-helpers'
import { leadListSchema, leadCreateSchema } from '@/lib/validations/crm'
import { searchTerm } from '@/lib/utils/list'
import { nextNumber } from '@/lib/services/numbering'
import { findLeadDuplicate, computeLeadScore, DEAD_LEAD_STAGES } from '@/lib/services/leads'
import { createAuditLog } from '@/lib/audit'
import { ConflictError } from '@/lib/services/errors'
import { PERMISSIONS } from '@/lib/permissions'
import { normalizePhone } from '@/lib/validations/common'
import { resolveLeadScope } from '@/lib/reports/scope'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.LEADS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = leadListSchema.parse(Object.fromEntries(searchParams))

  const searchOr = searchTerm(query.search, [
    'firstName', 'lastName', 'fullName', 'email',
    'organisationName', 'leadNumber', 'phoneNumber',
  ])

  const recordScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const filtersWhere: Prisma.LeadWhereInput = {
    AND: [
      { organisationId, deletedAt: null },
      recordScope,
      ...(query.source ? [{ leadSource: query.source.toUpperCase() as never }] : []),
      ...(query.stage ? [{ lifecycleStage: query.stage.toUpperCase() as never }] : []),
      ...(query.assignedToUserId ? [{ assignedToUserId: query.assignedToUserId }] : []),
      ...(query.assignedTeamId ? [{ assignedTeamId: query.assignedTeamId }] : []),
      ...(query.tags ? [{ tags: { hasSome: query.tags.split(',') } }] : []),
      ...(query.dateRange?.from || query.dateRange?.to
        ? [{
            createdAt: {
              ...(query.dateRange.from ? { gte: new Date(query.dateRange.from) } : {}),
              ...(query.dateRange.to ? { lte: new Date(query.dateRange.to) } : {}),
            },
          }]
        : []),
      ...(searchOr ? [{ OR: searchOr }] : []),
    ],
  }
  // Dead leads (lost / disqualified) are hidden unless the Dead view or an explicit stage is requested.
  const dead = [...DEAD_LEAD_STAGES]
  const scope: Prisma.LeadWhereInput = query.stage ? {} : { lifecycleStage: query.view === 'dead' ? { in: dead } : { notIn: dead } }
  const filtered: Prisma.LeadWhereInput = query.priority
    ? { AND: [filtersWhere, { isPriority: query.priority === 'priority' }] }
    : filtersWhere
  const where: Prisma.LeadWhereInput = { AND: [filtered, scope] }

  const orderBy = { [query.sortBy]: query.sort as 'asc' | 'desc' }
  const [items, total, stages, priorityGroups] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, leadNumber: true, fullName: true, email: true,
        organisationName: true, leadSource: true, lifecycleStage: true,
        leadScore: true, isPriority: true, assignedToUserId: true, nextFollowUpAt: true,
        createdAt: true, city: true, state: true, tags: true, phoneNumber: true,
        whatsappNumber: true, lastContactedAt: true, firstContactedAt: true,
        assignedTo: { select: { id: true, fullName: true } },
      },
    }),
    db.lead.count({ where }),
    // Stage counts cover every stage (dead included) so each tab can show its own count.
    db.lead.groupBy({ by: ['lifecycleStage'], where: filtered, _count: true }),
    // Priority counts ignore the priority filter itself so both tabs always show their totals.
    db.lead.groupBy({ by: ['isPriority'], where: { AND: [filtersWhere, scope] }, _count: true }),
  ])
  const priorityCount = priorityGroups.find(g => g.isPriority)?._count ?? 0

  return NextResponse.json(
    {
      success: true,
      data: {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
        stageCounts: stages.map(({ lifecycleStage, _count }) => ({ stage: lifecycleStage, count: _count })),
        priorityCount,
        othersCount: priorityGroups.reduce((n, g) => n + g._count, 0) - priorityCount,
      },
      requestId: uuidv4(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.LEADS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash, userAgentHash } = guard.context!

  const body = await parseJsonBody(req, leadCreateSchema)

  // Normalisation
  const phone = body.phone ? normalizePhone(body.phone) : undefined
  const email = body.email?.toLowerCase()

  // Dedupe check (configurable rule: email/phone/org-name)
  const dup = await findLeadDuplicate(organisationId, { email, phone, organisationName: body.organisationName })
  if (dup.isDuplicate) {
    throw new ConflictError(`A lead with the same ${dup.matchReason} already exists`)
  }

  const leadScore = computeLeadScore({
    leadSource: body.leadSource,
    email,
    phone,
    estimatedUsers: body.estimatedUsers,
    budgetRange: body.budgetRange,
    qualificationStatus: body.qualificationStatus,
    currentSoftware: body.currentSoftware ?? null,
    useCase: body.useCase,
  })

  const leadNumber = await nextNumber(organisationId, 'lead')
  const lead = await db.lead.create({
    data: {
      organisationId,
      leadNumber,
      firstName: body.firstName,
      lastName: body.lastName,
      fullName: `${body.firstName} ${body.lastName}`,
      email,
      phoneCountryCode: phone?.startsWith('+') ? phone.slice(1, 3) : '+91',
      phoneNumber: phone,
      alternatePhone: body.alternatePhone ?? undefined,
      whatsappNumber: body.whatsappNumber ?? undefined,
      organisationName: body.organisationName,
      jobTitle: body.jobTitle,
      website: body.website,
      city: body.city,
      state: body.state,
      country: body.country,
      leadSource: body.leadSource.toUpperCase() as never,
      sourceDetail: body.sourceDetail,
      campaignId: body.campaignId ?? undefined,
      lifecycleStage: 'NEW',
      leadScore,
      qualificationStatus: body.qualificationStatus,
      estimatedPracticeSize: body.estimatedPracticeSize,
      estimatedUsers: body.estimatedUsers,
      currentSoftware: body.currentSoftware,
      painPoints: body.painPoints,
      useCase: body.useCase,
      budgetRange: body.budgetRange,
      expectedTimeline: body.expectedTimeline,
      preferredContactMethod: body.preferredContactMethod?.toUpperCase() as never,
      assignedToUserId: body.assignedToUserId ?? user.id,
      assignedTeamId: body.assignedTeamId ?? undefined,
      nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : undefined,
      consentStatus: body.consentStatus,
      consentSource: body.consentSource,
      tags: body.tags ?? [],
      customFields: body.customFields ?? {},
      createdBy: user.id,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.create',
    resourceType: 'lead',
    resourceId: lead.id,
    ipHash,
    userAgentHash,
    afterJson: { leadNumber: lead.leadNumber, lifecycleStage: lead.lifecycleStage },
  })

  return NextResponse.json(
    { success: true, data: lead, requestId: uuidv4() },
    { status: 201 }
  )
})
