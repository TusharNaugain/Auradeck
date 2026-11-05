/**
 * /api/automations — rule list (GET) and create (POST).
 * Rules are stored declaratively; execution is driven by the queue worker.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { automationCreateSchema } from '@/lib/validations/admin'
import { searchTerm } from '@/lib/utils/list'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.AUTOMATIONS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const page = Math.max(1, Number(searchParams.get('page') ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? 20) || 20))
  const searchOr = searchTerm(search ?? undefined, ['name', 'description'])

  const where = {
    organisationId,
    ...(status ? { status: status.toUpperCase() as never } : {}),
    ...(searchOr ? { OR: searchOr } : {}),
  }

  const [rules, total] = await Promise.all([
    db.automationRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, name: true, description: true, trigger: true, status: true,
        conditions: true, actions: true, delaySeconds: true,
        createdAt: true, updatedAt: true,
        _count: { select: { executions: true } },
      },
    }),
    db.automationRule.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items: rules, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.AUTOMATIONS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, automationCreateSchema)

  const rule = await db.automationRule.create({
    data: {
      organisationId,
      name: body.name,
      description: body.description,
      trigger: body.trigger as never,
      conditions: (body.conditions ?? []) as Prisma.InputJsonValue,
      actions: body.actions,
      delaySeconds: body.delaySeconds,
      status: (body.status ?? 'draft').toUpperCase() as never,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'automation.create',
    resourceType: 'automation_rule',
    resourceId: rule.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: rule, requestId: uuidv4() }, { status: 201 })
})
