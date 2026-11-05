/**
 * /api/onboarding/[id]/tasks — create a task in the project or PATCH an existing task.
 * Status changes trigger progress recomputation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { onboardingTaskCreateSchema, onboardingTaskUpdateSchema } from '@/lib/validations/admin'
import { recomputeOnboardingProgress } from '@/lib/services/onboarding'
import { createNotifications } from '@/lib/services/notifications'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ONBOARDING_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const project = await db.onboardingProject.findFirst({
    where: { id, organisationId },
    select: { id: true },
  })
  if (!project) throw new NotFoundError('Onboarding project not found')

  let body
  try {
    body = onboardingTaskCreateSchema.parse({
      ...((await req.json()) as Record<string, unknown>),
      onboardingId: project.id,
    })
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const task = await db.onboardingTask.create({
    data: {
      onboardingId: project.id,
      title: body.title,
      description: body.description,
      phase: body.phase,
      assignedToUserId: body.assignedToUserId,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
      dependencyTaskId: body.dependencyTaskId,
      order: body.order ?? 0,
    },
  })

  await recomputeOnboardingProgress(project.id)
  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'onboarding.task_create',
    resourceType: 'onboarding_task',
    resourceId: task.id,
    ipHash,
  })

  if (task.assignedToUserId) {
    await createNotifications({
      userIds: [task.assignedToUserId],
      organisationId,
      type: 'onboarding.task.assigned',
      title: `New onboarding task: ${task.title}`,
      message: 'An onboarding task was assigned to you.',
      severity: 'info',
      actionUrl: `/onboarding/${project.id}`,
    })
  }

  return NextResponse.json({ success: true, data: task, requestId: uuidv4() }, { status: 201 })
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ONBOARDING_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const task = await db.onboardingTask.findFirst({
    where: { id: id, onboarding: { organisationId } },
    select: { id: true, status: true, onboardingId: true, assignedToUserId: true },
  })
  if (!task) throw new NotFoundError('Onboarding task not found')

  let body
  try {
    body = onboardingTaskUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const updated = await db.onboardingTask.update({
    where: { id: task.id },
    data: {
      ...(body.title ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.phase !== undefined ? { phase: body.phase } : {}),
      ...(body.assignedToUserId !== undefined ? { assignedToUserId: body.assignedToUserId } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate ? new Date(body.dueDate) : null } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as never, completedAt: body.status === 'done' ? new Date() : undefined } : {}),
      ...(body.completionNote !== undefined ? { completionNote: body.completionNote } : {}),
    },
  })

  await recomputeOnboardingProgress(task.onboardingId)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'onboarding.task_update',
    resourceType: 'onboarding_task',
    resourceId: task.id,
    beforeJson: { status: task.status },
    afterJson: { status: updated.status },
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})
