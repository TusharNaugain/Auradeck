/**
 * GET /api/activities/actors — team members who have logged activities, for the
 * "Done by" filter on the Activities page. Names only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ACTIVITIES_VIEW, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const owners = await db.activity.groupBy({
    by: ['ownerUserId'],
    where: { organisationId, ownerUserId: { not: null } },
    _count: true,
  })
  const ids = owners.map((row) => row.ownerUserId).filter((id): id is string => !!id)
  const users = ids.length
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' } })
    : []
  const counts = new Map(owners.map((row) => [row.ownerUserId, row._count]))

  return NextResponse.json(
    { success: true, data: users.map((u) => ({ id: u.id, name: u.fullName, count: counts.get(u.id) ?? 0 })), requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
