/**
 * Onboarding services: template-driven project generation with phase tasks,
 * dependency ordering, progress computation and go-live completion.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/utils/logger'
import type { Prisma } from '@prisma/client'

interface GenerateTasksParams {
  onboardingProjectId: string
  templateId: string
  kickoffDate: Date
  actorUserId: string
  tx?: Prisma.TransactionClient
}

/**
 * Generate onboarding tasks from a template. Due dates are relative to kickoff
 * (daysFromStart). Dependency is enforced in-order within the same phase.
 */
export async function generateOnboardingTasks({
  onboardingProjectId,
  templateId,
  kickoffDate,
  actorUserId,
  tx,
}: GenerateTasksParams): Promise<number> {
  const client = tx ?? db
  const templateTasks = await client.onboardingTemplateTask.findMany({
    where: { templateId },
    orderBy: { order: 'asc' },
  })

  if (templateTasks.length === 0) {
    logger.warn('Onboarding template has no tasks; onboarding will be manual', { templateId })
    return 0
  }

  let previousTaskId: string | null = null
  let previousPhase: string | null = null

  for (const tt of templateTasks) {
    const dueDate = new Date(kickoffDate.getTime() + tt.daysFromStart * 24 * 3600 * 1000)
    // Only chain dependency within the same phase — a new phase starts clean
    const dependencyTaskId: string | null = tt.phase === previousPhase ? previousTaskId : null

    const task: { id: string } = await client.onboardingTask.create({
      data: {
        onboardingId: onboardingProjectId,
        title: tt.title,
        description: tt.description,
        phase: tt.phase,
        dueDate,
        dependencyTaskId,
        order: tt.order,
      },
      select: { id: true },
    })

    previousTaskId = task.id
    previousPhase = tt.phase
  }

  logger.info('Generated onboarding tasks', {
    onboardingProjectId,
    templateId,
    count: templateTasks.length,
    userId: actorUserId,
  })
  return templateTasks.length
}

/** Create a fully initialised onboarding project (project + generated tasks) in one transaction. */
export async function createOnboardingProject(input: {
  organisationId: string
  accountId: string
  onboardingTemplateId?: string
  projectName: string
  kickoffDate?: Date
  implementationOwnerId?: string
  csmOwnerId?: string
  dataMigrationRequired?: boolean
  trainingRequired?: boolean
  integrationRequired?: boolean
  actorUserId: string
}): Promise<{ id: string; tasksCreated: number }> {
  return db.$transaction(async (tx) => {
    const project = await tx.onboardingProject.create({
      data: {
        organisationId: input.organisationId,
        accountId: input.accountId,
        onboardingTemplateId: input.onboardingTemplateId ?? undefined,
        projectName: input.projectName,
        status: 'SCHEDULED',
        kickoffDate: input.kickoffDate ?? new Date(),
        implementationOwnerId: input.implementationOwnerId,
        csmOwnerId: input.csmOwnerId,
        dataMigrationRequired: input.dataMigrationRequired ?? false,
        trainingRequired: input.trainingRequired ?? false,
        integrationRequired: input.integrationRequired ?? false,
      },
    })

    let tasksCreated = 0
    if (input.onboardingTemplateId) {
      tasksCreated = await generateOnboardingTasks({
        onboardingProjectId: project.id,
        templateId: input.onboardingTemplateId,
        kickoffDate: input.kickoffDate ?? new Date(),
        actorUserId: input.actorUserId,
        tx,
      })
    }

    return { id: project.id, tasksCreated }
  })
}

/** Recompute progress from tasks status — called after any task mutation. */
export async function recomputeOnboardingProgress(onboardingId: string): Promise<number> {
  const counts = await db.onboardingTask.groupBy({
    by: ['status'],
    where: { onboardingId },
    _count: { status: true },
  })

  const total = counts.reduce((sum, c) => sum + c._count.status, 0)
  const done = counts
    .filter((c) => c.status === 'DONE' || c.status === 'SKIPPED')
    .reduce((sum, c) => sum + c._count.status, 0)

  const progress = total === 0 ? 0 : Math.round((done / total) * 100)
  const status = progress === 100 ? 'READY_FOR_GO_LIVE' : undefined

  await db.onboardingProject.update({
    where: { id: onboardingId },
    data: {
      progressPercentage: progress,
      ...(status ? { status } : {}),
    },
  })
  return progress
}

/** Mark go-live and copy behaviour to account. */
export async function markGoLive(onboardingId: string, actorUserId: string): Promise<void> {
  const project = await db.onboardingProject.findUnique({ where: { id: onboardingId } })
  if (!project) return
  if (project.progressPercentage < 100) {
    throw new Error('ONBOARDING_NOT_READY_FOR_GO_LIVE')
  }
  await db.$transaction([
    db.onboardingProject.update({
      where: { id: onboardingId },
      data: { status: 'COMPLETED', actualGoLiveDate: new Date() },
    }),
    db.account.update({
      where: { id: project.accountId },
      data: {
        lifecycleStage: 'active',
      },
    }),
  ])
  logger.info('Onboarding marked go-live', { onboardingId, userId: actorUserId })
}
