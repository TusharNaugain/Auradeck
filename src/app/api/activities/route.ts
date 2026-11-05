/**
 * /api/activities — timeline entries: call/email/meeting/demo/task/visit records.
 * Visibility model: private (owner only), team, organisation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { activityListSchema, activityCreateSchema } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ACTIVITIES_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = activityListSchema.parse(Object.fromEntries(searchParams))

  const baseWhere: Record<string, unknown> = {
    organisationId,
    ...(query.activityType ? { activityType: query.activityType.toUpperCase() as never } : {}),
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
    ...(query.relatedLeadId ? { relatedLeadId: query.relatedLeadId } : {}),
    ...(query.relatedAccountId ? { relatedAccountId: query.relatedAccountId } : {}),
    ...(query.relatedContactId ? { relatedContactId: query.relatedContactId } : {}),
    ...(query.relatedOpportunityId ? { relatedOpportunityId: query.relatedOpportunityId } : {}),
    ...(query.relatedTicketId ? { relatedTicketId: query.relatedTicketId } : {}),
    ...(query.dueBefore ? { dueAt: { lte: new Date(query.dueBefore) } } : {}),
    ...(query.dueAfter ? { dueAt: { gte: new Date(query.dueAfter) } } : {}),
  }

  // Visibility scoping merged with assignment filters
  const assignmentFilter = query.assignedToUserId
    ? { assignedToUserId: query.assignedToUserId }
    : ctx.scopeType === 'OWN'
      ? { assignedToUserId: user.id }
      : undefined

  // Privacy: PRIVATE entries are only visible to owner/assignee; TEAM entries to all
  const visibilityFilter: Record<string, unknown> = {
    OR: [
      { visibility: 'ORGANISATION' },
      { visibility: 'TEAM' },
      { ownerUserId: user.id },
      { assignedToUserId: user.id },
      { createdBy: user.id },
    ],
  }

  const where = {
    ...baseWhere,
    ...(assignmentFilter ?? {}),
    AND: [visibilityFilter],
  }

  const [items, total] = await Promise.all([
    db.activity.findMany({
      where: where as never,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, activityType: true, subject: true, status: true, visibility: true,
        dueAt: true, completedAt: true, priority: true, createdAt: true,
        owner: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
        relatedLeadId: true, relatedAccountId: true, relatedContactId: true,
        relatedOpportunityId: true, relatedTicketId: true,
      },
    }),
    db.activity.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACTIVITIES_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, activityCreateSchema)

  const activity = await db.activity.create({
    data: {
      organisationId,
      activityType: body.activityType.toUpperCase() as never,
      subject: body.subject,
      description: body.description,
      outcome: body.outcome,
      status: body.status.toUpperCase() as never,
      priority: body.priority?.toUpperCase() as never,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined,
      completedAt: body.completedAt ? new Date(body.completedAt) : undefined,
      durationMinutes: body.durationMinutes,
      ownerUserId: user.id,
      assignedToUserId: body.assignedToUserId ?? user.id,
      relatedLeadId: body.relatedLeadId,
      relatedAccountId: body.relatedAccountId,
      relatedContactId: body.relatedContactId,
      relatedOpportunityId: body.relatedOpportunityId,
      relatedTicketId: body.relatedTicketId,
      externalReference: body.externalReference,
      reminderAt: body.reminderAt ? new Date(body.reminderAt) : undefined,
      visibility: body.visibility.toUpperCase() as never,
      createdBy: user.id,
    },
  })

  // Denormalise last-contacted on the related record when a completed outreach activity
  const completedOutreach = ['CALL', 'EMAIL', 'WHATSAPP', 'MEETING', 'DEMO'].includes(activity.activityType) && activity.status === 'COMPLETED'

  if (completedOutreach) {
    const touched = activity.relatedLeadId
      ? db.lead.update({ where: { id: activity.relatedLeadId }, data: { lastContactedAt: new Date() } })
      : activity.relatedContactId
        ? db.contact.update({ where: { id: activity.relatedContactId }, data: { lastContactedAt: new Date() } })
        : null
    if (touched) await touched
  }

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'activity.create',
    resourceType: 'activity',
    resourceId: activity.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: activity, requestId: uuidv4() }, { status: 201 })
})
