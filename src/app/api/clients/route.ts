/**
 * /api/clients — practice client/patient records with privacy controls.
 * PII fields (DOB, phone, address, emergency contact) are masked for callers
 * without clients.view_pii. List response NEVER includes protected fields masked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { clientListSchema, clientCreateSchema } from '@/lib/validations/practice'
import { nextNumber } from '@/lib/services/numbering'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CLIENTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const canSeePii = ctx.permissions.has(PERMISSIONS.CLIENTS_VIEW_PII) || ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)

  const { searchParams } = new URL(req.url)
  const query = clientListSchema.parse(Object.fromEntries(searchParams))

  const where: Record<string, unknown> = {
    organisationId,
    deletedAt: null,
    ...(query.status ? { status: query.status.toUpperCase() as never } : {}),
    ...(query.assignedPractitionerId
      ? { assignedPractitionerId: query.assignedPractitionerId }
      : // Therapists with narrow scope see only their assigned clients
        ctx.scopeType === 'OWN'
        ? { assignedPractitionerId: user.id }
        : {}),
    ...(query.hasOutstandingBalance
      ? { outstandingBalance: query.hasOutstandingBalance === 'true' ? { gt: 0 } : { lte: 0 } }
      : {}),
    ...(query.search
      ? {
          OR:
            canSeePii
              ? [
                  { clientNumber: { contains: query.search, mode: 'insensitive' } },
                  { firstName: { contains: query.search, mode: 'insensitive' } },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  { preferredName: { contains: query.search, mode: 'insensitive' } },
                  { email: { contains: query.search, mode: 'insensitive' } },
                  { phone: { contains: query.search } },
                ]
              : [
                  { clientNumber: { contains: query.search, mode: 'insensitive' } },
                  { firstName: { contains: query.search, mode: 'insensitive' } },
                  { lastName: { contains: query.search, mode: 'insensitive' } },
                  { preferredName: { contains: query.search, mode: 'insensitive' } },
                ],
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.client.findMany({
      where: where as never,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      // NEVER include protected fields in list responses
      select: {
        id: true, clientNumber: true, firstName: true, lastName: true,
        preferredName: true, status: true, assignedPractitionerId: true,
        lastAppointmentAt: true, nextAppointmentAt: true, outstandingBalance: true,
        tags: true, createdAt: true,
      },
    }),
    db.client.count({ where: where as never }),
  ])

  return NextResponse.json(
    {
      success: true,
      data: {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
        piiVisible: canSeePii,
      },
      requestId: uuidv4(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CLIENTS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, clientCreateSchema)

  const clientNumber = await nextNumber(organisationId, 'client')
  const client = await db.client.create({
    data: {
      organisationId,
      clientNumber,
      firstName: body.firstName,
      lastName: body.lastName,
      preferredName: body.preferredName,
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
      gender: body.gender,
      pronouns: body.pronouns,
      email: body.email,
      phone: body.phone,
      emergencyContactName: body.emergencyContactName,
      emergencyContactPhone: body.emergencyContactPhone,
      address: body.address ?? undefined,
      referralSource: body.referralSource,
      assignedPractitionerId: body.assignedPractitionerId,
      status: body.status.toUpperCase() as never,
      consentStatus: body.consentStatus,
      communicationPreferences: body.communicationPreferences ?? {},
      tags: body.tags ?? [],
      customFields: body.customFields ?? {},
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'client.create',
    resourceType: 'client',
    resourceId: client.id,
    ipHash,
    afterJson: { clientNumber }, // PII deliberately excluded from audit payload
  })

  return NextResponse.json(
    { success: true, data: { ...client, _privacy: 'Full record requires clients.view_pii' }, requestId: uuidv4() },
    { status: 201 }
  )
})
