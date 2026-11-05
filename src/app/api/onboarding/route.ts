/**
 * /api/onboarding — list (GET) and create (POST) onboarding projects.
 * Creating with a template auto-generates phase tasks in the same transaction.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { onboardingListSchema, onboardingCreateSchema } from '@/lib/validations/admin'
import { createOnboardingProject } from '@/lib/services/onboarding'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ONBOARDING_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx } = guard.context!
  const canViewContacts = ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW)

  const { searchParams } = new URL(req.url)
  const query = onboardingListSchema.parse(Object.fromEntries(searchParams))

  const where = {
    organisationId,
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.implementationOwnerId ? { implementationOwnerId: query.implementationOwnerId } : {}),
    ...(query.csmOwnerId ? { csmOwnerId: query.csmOwnerId } : {}),
    ...(query.search ? { projectName: { contains: query.search, mode: 'insensitive' as const } } : {}),
  }

  const [items, total] = await Promise.all([
    db.onboardingProject.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        account: {
          select: {
            id: true,
            accountName: true,
            ...(canViewContacts ? {
              contacts: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
                take: 1,
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                  whatsappNumber: true,
                  jobTitle: true,
                  lastContactedAt: true,
                },
              },
            } : {}),
          },
        },
        _count: { select: { tasks: true } },
      },
    }),
    db.onboardingProject.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.ONBOARDING_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, onboardingCreateSchema)

  const account = await db.account.findFirst({
    where: { id: body.accountId, organisationId },
    select: { id: true, accountName: true },
  })
  if (!account) throw new NotFoundError('Account not found in this organisation')

  const project = await createOnboardingProject({
    organisationId,
    accountId: account.id,
    onboardingTemplateId: body.onboardingTemplateId ?? undefined,
    projectName: body.projectName,
    kickoffDate: body.kickoffDate ? new Date(body.kickoffDate) : undefined,
    implementationOwnerId: body.implementationOwnerId ?? undefined,
    csmOwnerId: body.csmOwnerId ?? undefined,
    dataMigrationRequired: body.dataMigrationRequired,
    trainingRequired: body.trainingRequired,
    integrationRequired: body.integrationRequired,
    actorUserId: user.id,
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'onboarding.create',
    resourceType: 'onboarding_project',
    resourceId: project.id,
    ipHash,
    afterJson: { accountName: account.accountName, tasksGenerated: project.tasksCreated },
  })

  return NextResponse.json(
    { success: true, data: { id: project.id, tasksCreated: project.tasksCreated }, requestId: uuidv4() },
    { status: 201 }
  )
})
