/**
 * /api/tickets — list (GET), create (POST) with SLA timers + assignment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { ticketListSchema, ticketCreateSchema, computeSlaDueDates } from '@/lib/validations/support'
import { nextNumber } from '@/lib/services/numbering'
import { createAuditLog } from '@/lib/audit'
import { createNotifications } from '@/lib/services/notifications'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.TICKETS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = ticketListSchema.parse(Object.fromEntries(searchParams))

  const where: Record<string, unknown> = {
    organisationId,
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
    ...(query.priority ? { priority: query.priority.toUpperCase() as never } : {}),
    ...(query.assignedToUserId ? { assignedToUserId: query.assignedToUserId } : {}),
    ...(query.teamId ? { teamId: query.teamId } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.slaStatus
      ? { slaStatus: query.slaStatus.toUpperCase() as never }
      : query.overdue === 'true'
        ? {
            OR: [
              { firstResponseDueAt: { lt: new Date() }, firstRespondedAt: null },
              { resolutionDueAt: { lt: new Date() }, resolvedAt: null },
            ],
          }
        : {}),
    ...(query.search
      ? {
          OR: [
            { subject: { contains: query.search, mode: 'insensitive' } },
            { ticketNumber: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(ctx.scopeType === 'OWN' ? { assignedToUserId: user.id } : {}),
  }

  const [items, total] = await Promise.all([
    db.supportTicket.findMany({
      where: where as never,
      orderBy: query.sortBy === 'priority'
        ? [{ priority: 'desc' as const }, { createdAt: 'desc' as const }]
        : { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, ticketNumber: true, subject: true, priority: true, status: true,
        slaStatus: true, firstResponseDueAt: true, resolutionDueAt: true,
        firstRespondedAt: true, resolvedAt: true, createdAt: true,
        account: { select: { id: true, accountName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    }),
    db.supportTicket.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.TICKETS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, ticketCreateSchema)

  // Validate that the account belongs to this organisation (anti-IDOR)
  if (body.accountId) {
    const account = await db.account.findFirst({
      where: { id: body.accountId, organisationId },
      select: { id: true },
    })
    if (!account) {
      return NextResponse.json(
        { success: false, error: 'Account not found in this organisation', code: 'NOT_FOUND', requestId: uuidv4() },
        { status: 404 }
      )
    }
  }

  const ticketNumber = await nextNumber(organisationId, 'ticket')
  const sla = computeSlaDueDates(body.priority, new Date())

  const ticket = await db.supportTicket.create({
    data: {
      organisationId,
      ticketNumber,
      accountId: body.accountId ?? undefined,
      contactId: body.contactId ?? undefined,
      subject: body.subject,
      description: body.description,
      category: body.category,
      subcategory: body.subcategory,
      priority: body.priority.toUpperCase() as never,
      status: 'NEW',
      source: body.source.toUpperCase() as never,
      assignedToUserId: body.assignedToUserId ?? user.id,
      teamId: body.teamId,
      firstResponseDueAt: sla.firstResponseDueAt,
      resolutionDueAt: sla.resolutionDueAt,
      slaStatus: 'ON_TIME',
      tags: body.tags ?? [],
      internalNotes: body.internalNotes,
      createdBy: user.id,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'ticket.create',
    resourceType: 'ticket',
    resourceId: ticket.id,
    ipHash,
    afterJson: { ticketNumber, priority: ticket.priority, sla: 'SLA timers started' },
  })

  // Notify ticket assignee
  if (ticket.assignedToUserId && ticket.assignedToUserId !== user.id) {
    await createNotifications({
      userIds: [ticket.assignedToUserId],
      organisationId,
      type: 'ticket.assigned',
      title: `Ticket ${ticketNumber}: ${ticket.subject}`,
      message: 'A new ticket was assigned to you.',
      severity: 'info',
      actionUrl: `/tickets/${ticket.id}`,
    })
  }

  return NextResponse.json({ success: true, data: ticket, requestId: uuidv4() }, { status: 201 })
})
