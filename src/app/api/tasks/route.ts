/**
 * /api/tasks — cross-module task list (GET) and create (POST).
 * Overdue filter and dashboard-friendly due-date ranges supported.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { taskListSchema, taskCreateSchema } from '@/lib/validations/admin'
import { parseDateParam } from '@/lib/utils/list'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { createNotifications } from '@/lib/services/notifications'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.DASHBOARD_VIEW })
  if (guard.response) return guard.response
  const { organisationId, user } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = taskListSchema.parse(Object.fromEntries(searchParams))

  const where: Record<string, unknown> = {
    organisationId,
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
    ...(query.priority ? { priority: query.priority.toUpperCase() as never } : {}),
    ...(query.assignedToUserId ? { assignedToUserId: query.assignedToUserId } : {}),
    ...(query.relatedEntityType ? { relatedEntityType: query.relatedEntityType } : {}),
    ...(query.relatedEntityId ? { relatedEntityId: query.relatedEntityId } : {}),
    ...(query.overdue === 'true'
      ? { dueAt: { lt: new Date() }, status: { notIn: ['DONE', 'CANCELLED'] } }
      : {
          ...(query.dueBefore ? { dueAt: { lte: parseDateParam(query.dueBefore) ?? undefined } } : {}),
          ...(query.dueAfter ? { dueAt: { gte: parseDateParam(query.dueAfter) ?? undefined } } : {}),
        }),
    ...(query.search
      ? { title: { contains: query.search, mode: 'insensitive' } }
      : {}),
    // Default: my tasks and tasks I own
    ...(query.assignedToUserId === undefined ? { OR: [{ assignedToUserId: user.id }, { ownerUserId: user.id }] } : {}),
  }

  const [items, total] = await Promise.all([
    db.task.findMany({
      where: where as never,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, title: true, status: true, priority: true, dueAt: true,
        completedAt: true, relatedEntityType: true, relatedEntityId: true, createdAt: true,
        assignedTo: { select: { id: true, fullName: true } },
      },
    }),
    db.task.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.DASHBOARD_VIEW,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, taskCreateSchema)

  const task = await db.task.create({
    data: {
      organisationId,
      title: body.title,
      description: body.description,
      taskType: body.taskType,
      status: body.status?.toUpperCase() as never,
      priority: body.priority?.toUpperCase() as never,
      dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
      ownerUserId: body.ownerUserId ?? user.id,
      assignedToUserId: body.assignedToUserId ?? user.id,
      relatedEntityType: body.relatedEntityType?.toUpperCase() as never,
      relatedEntityId: body.relatedEntityId,
      recurrenceRule: body.recurrenceRule,
      createdBy: user.id,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'task.create',
    resourceType: 'task',
    resourceId: task.id,
    ipHash,
  })

  if (task.assignedToUserId && task.assignedToUserId !== user.id) {
    await createNotifications({
      userIds: [task.assignedToUserId],
      organisationId,
      type: 'task.assigned',
      title: `New task: ${task.title}`,
      message: 'A task was assigned to you.',
      severity: 'info',
      actionUrl: '/tasks',
    })
  }

  return NextResponse.json({ success: true, data: task, requestId: uuidv4() }, { status: 201 })
})
