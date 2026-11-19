/**
 * PATCH /api/users/[id] — change a member's role, team or record visibility, or reactivate them.
 * DELETE /api/users/[id] — remove a member ([id] is the membership id).
 * Deactivates the membership (kept for audit), revokes the member's pending invitations so an
 * old invite link cannot re-grant access, and ends their sessions if this was their last seat.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { canAssignRole, isKnownRole, scopeFromVisibility, SUPER_ADMIN_ROLE } from '@/lib/permissions/access'
import { ensureRole } from '@/lib/rbac/sync'
import { memberUpdateSchema } from '@/lib/validations/admin'
import { revokeAllSessions } from '@/lib/auth/session'
import { v4 as uuidv4 } from 'uuid'

const fail = (error: string, code: string, status: number) =>
  NextResponse.json({ success: false, error, code, requestId: uuidv4() }, { status })

export const PATCH = routeHandler(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.USERS_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ctx, ipHash } = guard.context!

  const body = await parseJsonBody(req, memberUpdateSchema)
  const target = await db.membership.findFirst({
    where: { id, organisationId },
    include: { role: { select: { slug: true } }, user: { select: { email: true, status: true } } },
  })
  if (!target) return fail('Member not found', 'NOT_FOUND', 404)
  if (target.userId === user.id) return fail('You cannot change your own access. Ask another admin.', 'VALIDATION_ERROR', 400)

  const actorIsSuper = ctx.roleSlug === SUPER_ADMIN_ROLE
  if (target.role.slug === SUPER_ADMIN_ROLE && !actorIsSuper) {
    return fail('Only a super admin can change another super admin.', 'PERMISSION_DENIED', 403)
  }

  const data: {
    roleId?: string
    teamId?: string | null
    scopeOverride?: 'OWN' | 'TEAM' | 'ORGANISATION' | 'ASSIGNED' | null
    status?: 'ACTIVE'
    deactivatedAt?: null
  } = {}

  if (body.roleSlug !== undefined && body.roleSlug !== target.role.slug) {
    if (!isKnownRole(body.roleSlug)) return fail('Unknown role', 'VALIDATION_ERROR', 400)
    if (!canAssignRole(ctx.roleSlug, body.roleSlug)) {
      return fail('Only a super admin can make someone a super admin.', 'PERMISSION_DENIED', 403)
    }
    if (target.role.slug === SUPER_ADMIN_ROLE && target.status === 'ACTIVE') {
      const others = await db.membership.count({
        where: { organisationId, status: 'ACTIVE', role: { slug: SUPER_ADMIN_ROLE }, id: { not: id } },
      })
      if (others === 0) return fail('This is the last super admin; make someone else super admin first.', 'VALIDATION_ERROR', 400)
    }
    const role = await ensureRole(body.roleSlug)
    if (!role) return fail('Role not synced; run the seed first', 'SYSTEM_ERROR', 500)
    data.roleId = role.id
  }

  if (body.teamId !== undefined) {
    if (body.teamId) {
      const team = await db.team.findFirst({ where: { id: body.teamId, organisationId }, select: { id: true } })
      if (!team) return fail('Team not found in this organisation', 'VALIDATION_ERROR', 400)
    }
    data.teamId = body.teamId
  }

  if (body.scopeType !== undefined) data.scopeOverride = scopeFromVisibility(body.scopeType)

  if (body.status === 'active' && target.status !== 'ACTIVE') {
    if (target.user.status !== 'ACTIVE') return fail('This user account is suspended.', 'VALIDATION_ERROR', 400)
    data.status = 'ACTIVE'
    data.deactivatedAt = null
  }

  const updated = await db.membership.update({
    where: { id },
    data,
    include: { role: { select: { slug: true, name: true } }, team: { select: { id: true, name: true } } },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'user.access_changed',
    resourceType: 'membership',
    resourceId: id,
    ipHash,
    beforeJson: { role: target.role.slug, teamId: target.teamId, scopeOverride: target.scopeOverride, status: target.status },
    afterJson: { role: updated.role.slug, teamId: updated.teamId, scopeOverride: updated.scopeOverride, status: updated.status },
  })
  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.USERS_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ctx, ipHash } = guard.context!

  const target = await db.membership.findFirst({
    where: { id, organisationId },
    include: { role: { select: { slug: true } }, user: { select: { email: true } } },
  })
  if (!target) return fail('Member not found', 'NOT_FOUND', 404)
  if (target.userId === user.id) return fail('You cannot remove yourself.', 'VALIDATION_ERROR', 400)
  if (target.role.slug === SUPER_ADMIN_ROLE && ctx?.roleSlug !== SUPER_ADMIN_ROLE) {
    return fail('Only a super admin can remove another super admin.', 'PERMISSION_DENIED', 403)
  }

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
