/**
 * /api/activities/[id] — detail (GET), update (PATCH), delete (DELETE).
 * PRIVATE activities are only readable by owner/assignee/creator.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { activityUpdateSchema } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError, NotAllowedError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ACTIVITIES_VIEW })
  if (guard.response) return guard.response
  const { organisationId, user } = guard.context!

  const activity = await db.activity.findFirst({
    where: { id, organisationId },
  })
  if (!activity) throw new NotFoundError('Activity not found')

  if (activity.visibility === 'PRIVATE' && activity.ownerUserId !== user.id && activity.assignedToUserId !== user.id && activity.createdBy !== user.id) {
    throw new NotAllowedError('This activity is private')
  }

  return NextResponse.json({ success: true, data: { activity }, requestId: uuidv4() })
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACTIVITIES_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const activity = await db.activity.findFirst({
    where: { id, organisationId },
    select: { id: true, status: true },
  })
  if (!activity) throw new NotFoundError('Activity not found')

  let body
  try {
    body = activityUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const updated = await db.activity.update({
    where: { id: activity.id },
    data: {
      ...(body.activityType ? { activityType: body.activityType.toUpperCase() as never } : {}),
      ...(body.subject ? { subject: body.subject } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as never, completedAt: body.status === 'completed' ? new Date() : undefined } : {}),
      ...(body.priority ? { priority: body.priority.toUpperCase() } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
      ...(body.startedAt !== undefined ? { startedAt: body.startedAt ? new Date(body.startedAt) : null } : {}),
      ...(body.completedAt !== undefined ? { completedAt: body.completedAt ? new Date(body.completedAt) : null } : {}),
      ...(body.durationMinutes !== undefined ? { durationMinutes: body.durationMinutes } : {}),
      ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}),
      ...(body.relatedLeadId !== undefined ? { relatedLeadId: body.relatedLeadId } : {}),
      ...(body.relatedAccountId !== undefined ? { relatedAccountId: body.relatedAccountId } : {}),
      ...(body.relatedContactId !== undefined ? { relatedContactId: body.relatedContactId } : {}),
      ...(body.relatedOpportunityId !== undefined ? { relatedOpportunityId: body.relatedOpportunityId } : {}),
      ...(body.relatedTicketId !== undefined ? { relatedTicketId: body.relatedTicketId } : {}),
      ...(body.externalReference !== undefined ? { externalReference: body.externalReference } : {}),
      ...(body.reminderAt !== undefined ? { reminderAt: body.reminderAt ? new Date(body.reminderAt) : undefined } : {}),
      ...(body.visibility ? { visibility: body.visibility.toUpperCase() as never } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'activity.update',
    resourceType: 'activity',
    resourceId: activity.id,
    beforeJson: { status: activity.status },
    afterJson: { status: updated.status },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ACTIVITIES_DELETE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const activity = await db.activity.findFirst({
    where: { id, organisationId },
    select: { id: true },
  })
  if (!activity) throw new NotFoundError('Activity not found')

  await db.activity.delete({ where: { id: activity.id } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'activity.delete',
    resourceType: 'activity',
    resourceId: activity.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
