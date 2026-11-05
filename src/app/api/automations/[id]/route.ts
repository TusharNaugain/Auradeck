/**
 * /api/automations/[id] — detail (GET), update (PATCH), delete (DELETE).
 * Deletion clears the rule's execution history first: the Prisma relation has no
 * cascade, so removing a live rule would otherwise fail on the foreign key.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { automationUpdateSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { NotFoundError } from '@/lib/services/errors'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

async function loadRule(id: string, organisationId: string) {
  const rule = await db.automationRule.findFirst({ where: { id, organisationId } })
  if (!rule) throw new NotFoundError('Automation rule not found')
  return rule
}

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.AUTOMATIONS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const rule = await loadRule(id, organisationId)
  const executions = await db.automationExecution.findMany({
    where: { ruleId: rule.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, status: true, errorMessage: true, startedAt: true, completedAt: true, createdAt: true },
  })

  return NextResponse.json(
    { success: true, data: { rule, executions }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.AUTOMATIONS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const rule = await loadRule(id, organisationId)
  const body = await parseJsonBody(req, automationUpdateSchema)

  const updated = await db.automationRule.update({
    where: { id: rule.id },
    data: {
      name: body.name ?? undefined,
      description: body.description ?? undefined,
      trigger: body.trigger as never | undefined,
      conditions: (body.conditions ?? undefined) as Prisma.InputJsonValue | undefined,
      actions: body.actions ?? undefined,
      delaySeconds: body.delaySeconds ?? undefined,
      status: body.status?.toUpperCase() as never | undefined,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'automation.update',
    resourceType: 'automation_rule',
    resourceId: updated.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.AUTOMATIONS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const rule = await loadRule(id, organisationId)
  await db.$transaction([
    db.automationExecution.deleteMany({ where: { ruleId: rule.id } }),
    db.automationRule.delete({ where: { id: rule.id } }),
  ])

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'automation.delete',
    resourceType: 'automation_rule',
    resourceId: rule.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
