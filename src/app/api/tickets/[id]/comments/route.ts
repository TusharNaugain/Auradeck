/**
 * POST /api/tickets/[id]/comments — add internal or customer-visible comment.
 * Internal visibility requires tickets.internal_notes permission.
 * A customer-visible comment by an agent stamps firstRespondedAt (SLA).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { ticketCommentCreateSchema } from '@/lib/validations/support'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError, NotAllowedError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.TICKETS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const ticket = await db.supportTicket.findFirst({
    where: { id, organisationId },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      firstRespondedAt: true,
    },
  })
  if (!ticket) throw new NotFoundError('Ticket not found')

  const body = await parseJsonBody(req, ticketCommentCreateSchema)

  if (body.visibility === 'internal' && !ctx.permissions.has(PERMISSIONS.TICKETS_INTERNAL_NOTES) && !ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    throw new NotAllowedError('Adding internal notes requires tickets.internal_notes permission')
  }

  const isCustomerVisible = body.visibility === 'customer'
  const stampsFirstResponse = isCustomerVisible && ticket.firstRespondedAt === null

  const comment = await db.ticketComment.create({
    data: {
      ticketId: ticket.id,
      authorUserId: user.id,
      body: body.body,
      visibility: isCustomerVisible ? 'CUSTOMER' : 'INTERNAL',
      attachments: body.attachments
        ? {
            create: body.attachments.map((a) => ({
              ticketId: ticket.id,
              fileName: a.fileName,
              fileSize: a.fileSize,
              mimeType: a.mimeType,
              storageKey: a.storageKey,
              uploadedBy: user.id,
            })),
          }
        : undefined,
    },
  })

  await db.supportTicket.update({
    where: { id: ticket.id },
    data: {
      ...(stampsFirstResponse ? { firstRespondedAt: new Date() } : {}),
      // Agent reply while waiting on the customer moves it back to open
      ...(ticket.status === 'PENDING_CUSTOMER' ? { status: 'OPEN' as never } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'ticket.comment',
    resourceType: 'ticket_comment',
    resourceId: comment.id,
    afterJson: { visibility: body.visibility, ticketNumber: ticket.ticketNumber },
    ipHash,
  })

  return NextResponse.json({ success: true, data: comment, requestId: uuidv4() }, { status: 201 })
})
