/**
 * /api/users — list members of current organisation (GET) and invite (POST).
 * Invitations produce single-use hashed tokens; email links are sent through
 * the provider abstraction, falling back to console logging in development.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { userListSchema, inviteUserSchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { createInvitationToken } from '@/lib/auth/tokens'
import { sendTemplatedEmail, invitationEmail, appUrl } from '@/lib/email'
import { ROLE_PERMISSIONS, PERMISSIONS } from '@/lib/permissions'
import { logInvite } from '@/lib/logging/invite'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.USERS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = userListSchema.parse(Object.fromEntries(searchParams))

  const where = {
    organisationId,
    status: 'ACTIVE' as never,
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { user: { email: { contains: query.search, mode: 'insensitive' } } },
            { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  void where

  const [items, total] = await Promise.all([
    db.membership.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true, status: true, lastLoginAt: true } },
        role: { select: { slug: true, name: true } },
        team: { select: { id: true, name: true } },
      },
    }),
    db.membership.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.USERS_INVITE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, inviteUserSchema)

  if (!ROLE_PERMISSIONS[body.roleSlug]) {
    return NextResponse.json(
      { success: false, error: 'Unknown role', code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }

  // Role must exist in DB (seeded via RBAC sync)
  const role = await db.role.findUnique({ where: { slug: body.roleSlug } })
  if (!role) {
    return NextResponse.json(
      { success: false, error: 'Role not synced; run the seed first', code: 'SYSTEM_ERROR', requestId: uuidv4() },
      { status: 500 }
    )
  }

  if (body.teamId) {
    const team = await db.team.findFirst({ where: { id: body.teamId, organisationId }, select: { id: true } })
    if (!team) {
      return NextResponse.json(
        { success: false, error: 'Team not found in this organisation', code: 'VALIDATION_ERROR', requestId: uuidv4() },
        { status: 400 }
      )
    }
  }

  const organisation = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { displayName: true },
  })

  const { invitationId, raw } = await createInvitationToken(
    body.email,
    organisationId,
    role.id,
    user.id,
    body.teamId ?? undefined
  )

  // Provision access immediately so the invitee can sign in with Google even when no
  // email provider is configured (the invitation email may never arrive). The token stays
  // valid, so the email link still works for setting a password. Existing memberships and
  // non-ACTIVE existing users are left untouched.
  const inviteeEmail = body.email.trim().toLowerCase()
  const provisioned = await db.$transaction(async (tx) => {
    let invitee = await tx.user.findUnique({ where: { email: inviteeEmail }, select: { id: true, status: true } })
    let createdUser = false
    if (!invitee) {
      const namePart = inviteeEmail.split('@')[0]
      invitee = await tx.user.create({
        data: {
          email: inviteeEmail, fullName: namePart, firstName: namePart, lastName: '',
          status: 'ACTIVE', emailVerifiedAt: new Date(),
        },
        select: { id: true, status: true },
      })
      createdUser = true
    }
    const existingMembership = await tx.membership.findUnique({
      where: { userId_organisationId: { userId: invitee.id, organisationId } },
      select: { id: true },
    })
    if (existingMembership || invitee.status !== 'ACTIVE') {
      return { createdUser, membership: existingMembership ? 'existing' : 'skipped' }
    }
    await tx.membership.create({
      data: {
        userId: invitee.id, organisationId, roleId: role.id, teamId: body.teamId ?? undefined,
        status: 'ACTIVE', isPrimary: false, acceptedAt: new Date(), invitedBy: user.id,
        invitedAt: new Date(), scopeType: 'ORGANISATION',
      },
    })
    return { createdUser, membership: 'created' }
  })

  const acceptUrl = `${appUrl}/accept-invite?token=${raw}`
  await sendTemplatedEmail(
    body.email,
    invitationEmail(acceptUrl, organisation?.displayName ?? 'AuraDeck', user.fullName)
  )

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'user.invited',
    resourceType: 'invitation',
    resourceId: invitationId,
    ipHash,
    afterJson: { email: body.email, roleId: role.id, teamId: body.teamId },
  })

  await logInvite({ email: body.email, organisationId })

  return NextResponse.json(
    {
      success: true,
      data: {
        invitationId,
        access: provisioned.membership,
        lifecycle: 'Access granted now (sign in with Google using this email). Invitation email is sent only if an email provider is configured.',
      },
      requestId: uuidv4(),
    },
    { status: 201 }
  )
})
