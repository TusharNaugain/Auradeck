/**
 * /api/tickets/[id] — detail with comments (GET, filtered by caller permission for
 * internal comments), update incl. status/assignment + SLA recalc (PATCH).
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type TicketPriority, type TicketStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { ticketUpdateSchema, computeSlaStatus } from '@/lib/validations/support'
import { createAuditLog } from '@/lib/audit'
import { createNotifications } from '@/lib/services/notifications'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.TICKETS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx } = guard.context!

  const ticket = await db.supportTicket.findFirst({
    where: { id, organisationId },
    include: {
      account: { select: { id: true, accountName: true } },
      contact: { select: { id: true, fullName: true, email: true } },
      assignedTo: { select: { id: true, fullName: true, avatarUrl: true } },
      team: { select: { id: true, name: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, fullName: true, avatarUrl: true } } },
      },
    },
  })
  if (!ticket) throw new NotFoundError('Ticket not found')

  // Internal comments are restricted to authorised roles
  const canSeeInternal = ctx.permissions.has(PERMISSIONS.TICKETS_INTERNAL_NOTES) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)
  const comments = ticket.comments.filter((c) => canSeeInternal || c.visibility === 'CUSTOMER')

  // Recompute live SLA status
  const slaStatus = computeSlaStatus(ticket)
  const live = { ...ticket, slaStatusLive: slaStatus }

  return NextResponse.json(
    { success: true, data: { ticket: live, comments }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.TICKETS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const ticket = await db.supportTicket.findFirst({
    where: { id, organisationId },
    select: {
      id: true, ticketNumber: true, status: true, priority: true,
      assignedToUserId: true, firstResponseDueAt: true, firstRespondedAt: true,
      resolvedAt: true, closedAt: true, accountId: true,
    },
  })
  if (!ticket) throw new NotFoundError('Ticket not found')

  let body
  try {
    body = ticketUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const before = { status: ticket.status, priority: ticket.priority }
  const requestedStatus = body.status?.toUpperCase() as TicketStatus | undefined
  const statusChanged = requestedStatus !== undefined && requestedStatus !== ticket.status

  const now = new Date()
  const statusTimestamps: Prisma.SupportTicketUncheckedUpdateInput = {
    // First status change by an agent marks the first response
    ...(ticket.firstRespondedAt === null && statusChanged ? { firstRespondedAt: now } : {}),
    ...(statusChanged && requestedStatus === 'RESOLVED' ? { resolvedAt: now } : {}),
    ...(statusChanged && requestedStatus === 'CLOSED'
      ? { closedAt: now, resolvedAt: ticket.resolvedAt ?? now }
      : {}),
  }

  const updated = await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      ...(statusChanged ? { status: requestedStatus } : {}),
      ...(body.priority ? { priority: body.priority.toUpperCase() as TicketPriority } : {}),
      ...(body.subject ? { subject: body.subject } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.subcategory !== undefined ? { subcategory: body.subcategory } : {}),
      ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}),
      ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
      ...(body.satisfactionScore !== undefined ? { satisfactionScore: body.satisfactionScore } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes } : {}),
      ...statusTimestamps,
    },
  })

  // Notify new assignee
  if (body.assignedToUserId && body.assignedToUserId !== ticket.assignedToUserId && body.assignedToUserId !== user.id) {
    await createNotifications({
      userIds: [body.assignedToUserId],
      organisationId,
      type: 'ticket.assigned',
      title: `Ticket ${updated.ticketNumber}: ${updated.subject}`,
      message: 'A ticket was re-assigned to you.',
      severity: 'info',
      actionUrl: `/tickets/${updated.id}`,
    })
  }

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'ticket.update',
    resourceType: 'ticket',
    resourceId: ticket.id,
    beforeJson: before,
    afterJson: { status: updated.status, priority: updated.priority },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.TICKETS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const ticket = await db.supportTicket.findFirst({
    where: { id, organisationId },
    select: { id: true },
  })
  if (!ticket) throw new NotFoundError('Ticket not found')

  await db.supportTicket.delete({ where: { id: ticket.id } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'ticket.delete',
    resourceType: 'ticket',
    resourceId: ticket.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
