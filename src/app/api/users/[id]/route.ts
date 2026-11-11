/**
 * DELETE /api/users/[id] — remove a member ([id] is the membership id).
 * Deactivates the membership (kept for audit), revokes the member's pending invitations so an
 * old invite link cannot re-grant access, and ends their sessions if this was their last seat.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { revokeAllSessions } from '@/lib/auth/session'
import { v4 as uuidv4 } from 'uuid'

const fail = (error: string, code: string, status: number) =>
  NextResponse.json({ success: false, error, code, requestId: uuidv4() }, { status })

export const DELETE = routeHandler(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.USERS_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const target = await db.membership.findFirst({
    where: { id, organisationId },
    include: { role: { select: { slug: true } }, user: { select: { email: true } } },
  })
  if (!target) return fail('Member not found', 'NOT_FOUND', 404)
  if (target.userId === user.id) return fail('You cannot remove yourself.', 'VALIDATION_ERROR', 400)

  if (target.status === 'ACTIVE' && target.role.slug === 'super_admin') {
    const others = await db.membership.count({
      where: { organisationId, status: 'ACTIVE', role: { slug: 'super_admin' }, id: { not: id } },
    })
    if (others === 0) return fail('This is the last super admin and cannot be removed.', 'VALIDATION_ERROR', 400)
  }

  await db.$transaction([
    db.membership.update({ where: { id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date() } }),
    db.invitation.updateMany({
      where: { organisationId, email: { equals: target.user.email, mode: 'insensitive' }, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])
  if ((await db.membership.count({ where: { userId: target.userId, status: 'ACTIVE' } })) === 0) {
    await revokeAllSessions(target.userId)
  }

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'user.removed',
    resourceType: 'membership',
    resourceId: id,
    ipHash,
    beforeJson: { email: target.user.email, role: target.role.slug },
  })
  return NextResponse.json({ success: true, data: { removed: true }, requestId: uuidv4() })
})
