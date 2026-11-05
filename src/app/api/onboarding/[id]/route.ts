/**
 * /api/onboarding/[id] — project detail with tasks (GET), update (PATCH).
 * Progress is recomputed from task states after any change.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { onboardingUpdateSchema } from '@/lib/validations/admin'
import { recomputeOnboardingProgress, markGoLive } from '@/lib/services/onboarding'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ONBOARDING_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const project = await db.onboardingProject.findFirst({
    where: { id, organisationId },
    include: {
      account: { select: { id: true, accountName: true, healthStatus: true, healthScore: true } },
      implementationOwner: { select: { id: true, fullName: true } },
      csmOwner: { select: { id: true, fullName: true } },
      template: { select: { id: true, name: true } },
      tasks: {
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: { dependency: { select: { id: true, title: true } } },
      },
    },
  })
  if (!project) throw new NotFoundError('Onboarding project not found')

  return NextResponse.json(
    { success: true, data: { project }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
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

  const project = await db.onboardingProject.findFirst({
    where: { id, organisationId },
    select: { id: true, status: true, progressPercentage: true, accountId: true },
  })
  if (!project) throw new NotFoundError('Onboarding project not found')

  let body
  try {
    body = onboardingUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  // Explicit go-live path enforces completeness
  if (body.status === 'completed') {
    await markGoLive(id, user.id)
  }

  const updated = await db.onboardingProject.update({
    where: { id: project.id },
    data: {
      ...(body.projectName ? { projectName: body.projectName } : {}),
      ...(!body.status || body.status !== 'completed' ? { ...(body.status ? { status: body.status.toUpperCase() as never } : {}) } : {}),
      ...(body.kickoffDate !== undefined ? { kickoffDate: body.kickoffDate ? new Date(body.kickoffDate) : null } : {}),
      ...(body.targetGoLiveDate !== undefined ? { targetGoLiveDate: body.targetGoLiveDate ? new Date(body.targetGoLiveDate) : null } : {}),
      ...(body.actualGoLiveDate !== undefined ? { actualGoLiveDate: body.actualGoLiveDate ? new Date(body.actualGoLiveDate) : null } : {}),
      ...(body.implementationOwnerId !== undefined ? { implementationOwnerId: body.implementationOwnerId } : {}),
      ...(body.csmOwnerId !== undefined ? { csmOwnerId: body.csmOwnerId } : {}),
      ...(body.currentPhase !== undefined ? { currentPhase: body.currentPhase } : {}),
      ...(body.blockers !== undefined ? { blockers: body.blockers } : {}),
      ...(body.successCriteria !== undefined ? { successCriteria: body.successCriteria } : {}),
      ...(body.dataMigrationRequired !== undefined ? { dataMigrationRequired: body.dataMigrationRequired } : {}),
      ...(body.trainingRequired !== undefined ? { trainingRequired: body.trainingRequired } : {}),
      ...(body.integrationRequired !== undefined ? { integrationRequired: body.integrationRequired } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  })

  await recomputeOnboardingProgress(id)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'onboarding.update',
    resourceType: 'onboarding_project',
    resourceId: project.id,
    beforeJson: { status: project.status, progress: project.progressPercentage },
    afterJson: { status: updated.status, progress: updated.progressPercentage },
    ipHash,
  })

  const fresh = await db.onboardingProject.findUnique({ where: { id } })
  return NextResponse.json({ success: true, data: fresh, requestId: uuidv4() })
})
