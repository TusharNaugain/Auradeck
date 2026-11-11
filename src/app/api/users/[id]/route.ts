/**
 * /api/users/[id] — remove a member from the current organisation (DELETE).
 * [id] is the membership id. The membership is deactivated (kept for audit history),
 * which immediately blocks sign-in, and the user's sessions are revoked when this was
 * their last active membership.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { revokeAllSessions } from '@/lib/auth/session'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

function fail(error: string, code: string, status: number) {
  return NextResponse.json({ success: false, error, code, requestId: uuidv4() }, { status })
}

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.USERS_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const membership = await db.membership.findFirst({
    where: { id, organisationId },
    include: { role: { select: { slug: true } }, user: { select: { id: true, email: true } } },
  })
  if (!membership) return fail('Member not found', 'NOT_FOUND', 404)
  if (membership.status === 'DEACTIVATED') {
    return NextResponse.json({ success: true, data: { removed: true }, requestId: uuidv4() })
  }
  if (membership.userId === user.id) {
    return fail('You cannot remove yourself.', 'VALIDATION_ERROR', 400)
  }
  if (membership.role.slug === 'super_admin') {
    const otherAdmins = await db.membership.count({
      where: {
        organisationId,
        status: 'ACTIVE',
        id: { not: membership.id },
        role: { slug: 'super_admin' },
      },
    })
    if (otherAdmins === 0) {
      return fail('This is the last super admin and cannot be removed.', 'VALIDATION_ERROR', 400)
    }
  }

  await db.membership.update({
    where: { id: membership.id },
    data: { status: 'DEACTIVATED', deactivatedAt: new Date() },
  })

  const remaining = await db.membership.count({
    where: { userId: membership.userId, status: 'ACTIVE' },
  })
  if (remaining === 0) await revokeAllSessions(membership.userId)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'user.removed',
    resourceType: 'membership',
    resourceId: membership.id,
    ipHash,
    beforeJson: { email: membership.user.email, role: membership.role.slug },
  })

  return NextResponse.json({ success: true, data: { removed: true }, requestId: uuidv4() })
})
