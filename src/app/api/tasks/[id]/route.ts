/**
 * /api/tasks/[id] — detail (GET), update incl. completion (PATCH), delete (DELETE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { taskUpdateSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.DASHBOARD_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const task = await db.task.findFirst({
    where: { id, organisationId },
    include: { assignedTo: { select: { id: true, fullName: true } }, owner: { select: { id: true, fullName: true } } },
  })
  if (!task) throw new NotFoundError('Task not found')

  return NextResponse.json({ success: true, data: { task }, requestId: uuidv4() })
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.DASHBOARD_VIEW,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const task = await db.task.findFirst({
    where: { id, organisationId },
    select: { id: true, status: true, assignedToUserId: true },
  })
  if (!task) throw new NotFoundError('Task not found')

  // Only owner/assignee/admin may edit others' tasks
  const isOwnerOrAssignee = task.assignedToUserId === user.id || (await isTaskOwner(user.id, task.id))
  if (!isOwnerOrAssignee && !(ctx.permissions.has(PERMISSIONS.USERS_MANAGE) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN))) {
    return NextResponse.json(
      { success: false, error: 'You can only update tasks assigned to you or owned by you', code: 'PERMISSION_DENIED', requestId: uuidv4() },
      { status: 403 }
    )
  }

  let body
  try {
    body = taskUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const updated = await db.task.update({
    where: { id: task.id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.taskType !== undefined ? { taskType: body.taskType } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as never, completedAt: body.status === 'done' ? new Date() : undefined } : {}),
      ...(body.priority ? { priority: body.priority.toUpperCase() as never } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
      ...(body.completedAt !== undefined ? { completedAt: body.completedAt ? new Date(body.completedAt) : null } : {}),
      ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}),
      ...(body.relatedEntityType !== undefined ? { relatedEntityType: body.relatedEntityType?.toUpperCase() } : {}),
      ...(body.relatedEntityId !== undefined ? { relatedEntityId: body.relatedEntityId } : {}),
      ...(body.recurrenceRule !== undefined ? { recurrenceRule: body.recurrenceRule } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'task.update',
    resourceType: 'task',
    resourceId: task.id,
    beforeJson: { status: task.status },
    afterJson: { status: updated.status },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.DASHBOARD_VIEW,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const task = await db.task.findFirst({
    where: { id, organisationId, OR: [{ ownerUserId: user.id }, { createdBy: user.id }] },
    select: { id: true },
  })
  if (!task) throw new NotFoundError('Task not found')

  await db.task.delete({ where: { id: task.id } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'task.delete',
    resourceType: 'task',
    resourceId: task.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})

async function isTaskOwner(userId: string, taskId: string): Promise<boolean> {
  const t = await db.task.findFirst({ where: { id: taskId, ownerUserId: userId }, select: { id: true } })
  return !!t
}
