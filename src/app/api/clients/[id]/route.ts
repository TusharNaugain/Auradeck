/**
 * /api/clients/[id] — protected client detail/update.
 * Field masking: PII is stripped unless caller holds clients.view_pii;
 * revealing PII is access-logged for privacy compliance.
 * Clinical notes never ride along — they live behind a separate module + permission.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type ClientStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { clientUpdateSchema } from '@/lib/validations/practice'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

const PII_FIELDS = ['dateOfBirth', 'email', 'phone', 'emergencyContactName', 'emergencyContactPhone', 'address'] as const

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CLIENTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const client = await db.client.findFirst({
    where: { id, organisationId, deletedAt: null },
  })
  if (!client) throw new NotFoundError('Client not found')

  // Narrow scope: practitioners only see their assigned clients
  if (ctx.scopeType === 'OWN' && client.assignedPractitionerId !== user.id) {
    return NextResponse.json(
      { success: false, error: 'You can only access clients assigned to you', code: 'PERMISSION_DENIED', requestId: uuidv4() },
      { status: 403 }
    )
  }

  const canSeePii = ctx.permissions.has(PERMISSIONS.CLIENTS_VIEW_PII) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)

  const record: Record<string, unknown> = { ...client }
  if (!canSeePii) {
    for (const field of PII_FIELDS) record[field] = null
    record._piiMasked = true
  } else {
    // Privacy audit — every PII reveal is logged
    await createAuditLog({
      organisationId,
      actorUserId: user.id,
      action: 'client.pii_accessed',
      resourceType: 'client',
      resourceId: client.id,
      ipHash,
      reason: 'Client detail viewed with PII visible',
    })
  }

  const canSeeAppointments = ctx.permissions.has(PERMISSIONS.APPOINTMENTS_VIEW) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)
  const appointments = canSeeAppointments
    ? await db.appointment.findMany({
        where: { clientId: client.id },
        orderBy: { startAt: 'desc' },
        take: 10,
        select: {
          id: true, startAt: true, endAt: true, status: true,
          practitionerId: true, appointmentType: true,
        },
      })
    : []

  return NextResponse.json(
    { success: true, data: { client: record, appointments }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CLIENTS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const client = await db.client.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true, clientNumber: true },
  })
  if (!client) throw new NotFoundError('Client not found')

  let body
  try {
    body = clientUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  const touchesPii =
    body.dateOfBirth !== undefined ||
    body.email !== undefined ||
    body.phone !== undefined ||
    body.emergencyContactName !== undefined ||
    body.emergencyContactPhone !== undefined ||
    body.address !== undefined

  if (touchesPii && !(ctx.permissions.has(PERMISSIONS.CLIENTS_VIEW_PII) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN))) {
    return NextResponse.json(
      { success: false, error: 'Updating protected client information requires clients.view_pii', code: 'PERMISSION_DENIED', requestId: uuidv4() },
      { status: 403 }
    )
  }

  const updated = await db.client.update({
    where: { id: client.id },
    data: {
      ...(body.firstName ? { firstName: body.firstName } : {}),
      ...(body.lastName ? { lastName: body.lastName } : {}),
      ...(body.preferredName !== undefined ? { preferredName: body.preferredName } : {}),
      ...(body.dateOfBirth !== undefined ? { dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null } : {}),
      ...(body.gender !== undefined ? { gender: body.gender } : {}),
      ...(body.pronouns !== undefined ? { pronouns: body.pronouns } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
      ...(body.emergencyContactName !== undefined ? { emergencyContactName: body.emergencyContactName } : {}),
      ...(body.emergencyContactPhone !== undefined ? { emergencyContactPhone: body.emergencyContactPhone } : {}),
      ...(body.address !== undefined ? { address: body.address ?? Prisma.DbNull } : {}),
      ...(body.referralSource !== undefined ? { referralSource: body.referralSource } : {}),
      ...(body.assignedPractitionerId !== undefined ? { assignedPractitionerId: body.assignedPractitionerId } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as ClientStatus } : {}),
      ...(body.consentStatus !== undefined ? { consentStatus: body.consentStatus } : {}),
      ...(body.communicationPreferences ? { communicationPreferences: body.communicationPreferences } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'client.update',
    resourceType: 'client',
    resourceId: client.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CLIENTS_DELETE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const client = await db.client.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true },
  })
  if (!client) throw new NotFoundError('Client not found')

  await db.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'client.soft_delete',
    resourceType: 'client',
    resourceId: client.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
