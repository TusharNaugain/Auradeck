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

  const email = body.email.trim().toLowerCase()
  const { invitationId, raw } = await createInvitationToken(email, organisationId, role.id, user.id, body.teamId ?? undefined)

  // Grant access now so the invitee can sign in with Google even if the invitation email never
  // arrives (no email provider). Only a new user, or a previously removed member, is changed.
  const access = await db.$transaction(async (tx) => {
    const first = body.firstName?.trim() || email.split('@')[0]
    const last = body.lastName?.trim() || ''
    const invitee = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email, fullName: `${first} ${last}`.trim(), firstName: first, lastName: last, status: 'ACTIVE', emailVerifiedAt: new Date() },
      select: { id: true, status: true },
    })
    if (invitee.status !== 'ACTIVE') return 'skipped'
    const key = { userId_organisationId: { userId: invitee.id, organisationId } }
    const existing = await tx.membership.findUnique({ where: key, select: { status: true } })
    if (existing && existing.status !== 'DEACTIVATED') return 'existing'
    const now = new Date()
    const data = { roleId: role.id, teamId: body.teamId ?? null, status: 'ACTIVE' as const, deactivatedAt: null, acceptedAt: now, invitedBy: user.id, invitedAt: now }
    await tx.membership.upsert({
      where: key,
      update: data,
      create: { ...data, userId: invitee.id, organisationId, isPrimary: false, scopeType: 'ORGANISATION' },
    })
    return existing ? 'reactivated' : 'created'
  })

  const acceptUrl = `${appUrl}/accept-invite?token=${raw}`
  await sendTemplatedEmail(
    email,
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
        access,
        lifecycle: 'Access granted now (sign in with Google using this email). Invitation email is sent only if an email provider is configured.',
      },
      requestId: uuidv4(),
    },
    { status: 201 }
  )
})
