/**
 * /api/appointments — list (GET) with date-range + status filters, create (POST).
 * Overlap guard prevents double-booking the same practitioner.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { appointmentListSchema, appointmentCreateSchema } from '@/lib/validations/practice'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { ConflictError } from '@/lib/services/errors'
import { parseDateParam } from '@/lib/utils/list'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.APPOINTMENTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = appointmentListSchema.parse(Object.fromEntries(searchParams))

  // 'upcoming' and 'today' are pseudo-statuses: they filter on dates, not on the stored enum.
  const PSEUDO_STATUSES = ['upcoming', 'today'] as const
  const isPseudoStatus = (s?: string): s is (typeof PSEUDO_STATUSES)[number] =>
    (PSEUDO_STATUSES as readonly string[]).includes(s ?? '')

  if (query.status === 'today') {
    const now = new Date()
    query.from = now.toISOString()
    query.to = new Date(now.getTime() + 24 * 3600 * 1000).toISOString()
  }

  const where: Record<string, unknown> = {
    organisationId,
    ...(query.status === 'upcoming'
      ? { status: { in: ['SCHEDULED', 'CONFIRMED'] as never[] }, startAt: { gte: new Date() } }
      : query.status && !isPseudoStatus(query.status)
        ? { status: query.status.toUpperCase() as never }
        : {}),
    ...(query.clientId ? { clientId: query.clientId } : {}),
    // Practitioners see only their own bookings when scope is narrow
    ...(query.practitionerId
      ? { practitionerId: query.practitionerId }
      : ctx.scopeType === 'OWN'
        ? { practitionerId: user.id }
        : {}),
    ...(query.from || query.to
      ? {
          startAt: {
            ...(query.from ? { gte: parseDateParam(query.from) ?? undefined } : {}),
            ...(query.to ? { lte: parseDateParam(query.to) ?? undefined } : {}),
          },
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.appointment.findMany({
      where: where as never,
      orderBy: { startAt: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, startAt: true, endAt: true, status: true, appointmentType: true,
        clientId: true, practitionerId: true, paymentStatus: true, timezone: true,
        client: {
          select: { id: true, clientNumber: true, firstName: true, lastName: true, preferredName: true },
        },
      },
    }),
    db.appointment.count({ where: where as never }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.APPOINTMENTS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, appointmentCreateSchema)

  const startAt = new Date(body.startAt)
  const endAt = new Date(body.endAt)

  // The client must belong to the same practice
  const client = await db.client.findFirst({
    where: { id: body.clientId, organisationId, deletedAt: null },
    select: { id: true, status: true },
  })
  if (!client) {
    return NextResponse.json(
      { success: false, error: 'Client not found in this practice', code: 'NOT_FOUND', requestId: uuidv4() },
      { status: 404 }
    )
  }

  // Overlap guard (practitioner optional)
  if (body.practitionerId) {
    const overlap = await db.appointment.findFirst({
      where: {
        organisationId,
        practitionerId: body.practitionerId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      select: { id: true },
    })
    if (overlap) throw new ConflictError('Practitioner is already booked in that time slot')
  }

  const appointment = await db.appointment.create({
    data: {
      organisationId,
      clientId: body.clientId,
      practitionerId: body.practitionerId,
      locationId: body.locationId,
      appointmentType: body.appointmentType,
      status: body.status!.toUpperCase() as never,
      startAt,
      endAt,
      timezone: body.timezone || 'Asia/Kolkata',
      notesVisibility: body.notesVisibility,
      paymentStatus: body.paymentStatus?.toUpperCase() as never,
      notes: body.notes,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'appointment.create',
    resourceType: 'appointment',
    resourceId: appointment.id,
    ipHash,
    afterJson: { startAt: appointment.startAt, type: appointment.appointmentType },
  })

  return NextResponse.json({ success: true, data: appointment, requestId: uuidv4() }, { status: 201 })
})
