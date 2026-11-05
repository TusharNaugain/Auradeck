/**
 * /api/teams — team management: list (GET), create (POST) + member listing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { teamListSchema, teamCreateSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.TEAMS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = teamListSchema.parse(Object.fromEntries(searchParams))

  const where = {
    organisationId,
    ...(query.teamType ? { teamType: query.teamType.toUpperCase() as never } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
  }

  const [teams, total] = await Promise.all([
    db.team.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        memberships: { where: { status: 'ACTIVE' }, include: { user: { select: { id: true, fullName: true, avatarUrl: true } } } },
      },
    }),
    db.team.count({ where }),
  ])

  // Team.managerUserId has no Prisma relation, so resolve manager names in one batched query.
  const managerIds = Array.from(new Set(teams.map((t) => t.managerUserId).filter((id): id is string => Boolean(id))))
  const managers = managerIds.length
    ? await db.user.findMany({ where: { id: { in: managerIds } }, select: { id: true, fullName: true } })
    : []
  const managerById = new Map(managers.map((m) => [m.id, m]))

  const items = teams.map((team) => ({
    ...team,
    manager: team.managerUserId ? managerById.get(team.managerUserId) ?? null : null,
  }))

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.TEAMS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, teamCreateSchema)

  // Manager, if specified, must be an active member of this org
  if (body.managerUserId) {
    const member = await db.membership.findFirst({
      where: { userId: body.managerUserId, organisationId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!member) {
      return NextResponse.json(
        { success: false, error: 'Manager must be an active member of this organisation', code: 'VALIDATION_ERROR', requestId: uuidv4() },
        { status: 400 }
      )
    }
  }

  const team = await db.team.create({
    data: {
      organisationId,
      name: body.name,
      description: body.description,
      teamType: body.teamType.toUpperCase() as never,
      managerUserId: body.managerUserId,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'team.create',
    resourceType: 'team',
    resourceId: team.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: team, requestId: uuidv4() }, { status: 201 })
})
