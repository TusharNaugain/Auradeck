/**
 * /api/contacts — list (GET) and create (POST). Tenant-scoped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { contactListSchema, contactCreateSchema } from '@/lib/validations/crm'
import { searchTerm } from '@/lib/utils/list'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CONTACTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = contactListSchema.parse(Object.fromEntries(searchParams))

  const searchOr = searchTerm(query.search, ['fullName', 'firstName', 'lastName', 'email', 'jobTitle'])

  const where = {
    organisationId,
    deletedAt: null,
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.contactType ? { contactType: query.contactType.toUpperCase() as never } : {}),
    ...(query.isDecisionMaker ? { isDecisionMaker: query.isDecisionMaker === 'true' } : {}),
    ...(query.search ? { OR: searchOr } : {}),
  }

  const [items, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true, fullName: true, preferredName: true, email: true,
        jobTitle: true, contactType: true, isDecisionMaker: true,
        accountId: true, lastContactedAt: true, tags: true, createdAt: true,
      },
    }),
    db.contact.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CONTACTS_CREATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, contactCreateSchema)

  // Duplicate check on the same account
  if (body.email) {
    const dup = await db.contact.findFirst({
      where: {
        organisationId,
        deletedAt: null,
        email: body.email,
        ...(body.accountId ? { accountId: body.accountId } : {}),
      },
      select: { id: true },
    })
    if (dup) {
      return NextResponse.json(
        { success: false, error: 'A contact with this email already exists', code: 'CONFLICT', requestId: uuidv4() },
        { status: 409 }
      )
    }
  }

  // Only one primary per account
  if (body.isPrimary && body.accountId) {
    await db.contact.updateMany({
      where: { organisationId, accountId: body.accountId, isPrimary: true },
      data: { isPrimary: false },
    })
  }

  const contact = await db.contact.create({
    data: {
      organisationId,
      accountId: body.accountId ?? undefined,
      firstName: body.firstName,
      lastName: body.lastName,
      fullName: `${body.firstName} ${body.lastName}`,
      preferredName: body.preferredName,
      email: body.email,
      secondaryEmail: body.secondaryEmail,
      phoneCountryCode: body.phone?.startsWith('+') ? body.phone.slice(1, 3) : '+91',
      phoneNumber: body.phone,
      whatsappNumber: body.whatsappNumber,
      jobTitle: body.jobTitle,
      department: body.department,
      contactType: body.contactType.toUpperCase() as never,
      isPrimary: body.isPrimary ?? false,
      isDecisionMaker: body.isDecisionMaker ?? false,
      influenceLevel: body.influenceLevel?.toUpperCase() as never,
      preferredLanguage: body.preferredLanguage,
      preferredContactMethod: body.preferredContactMethod?.toUpperCase() as never,
      timezone: body.timezone,
      linkedinUrl: body.linkedinUrl,
      notes: body.notes,
      consentStatus: body.consentStatus,
      doNotContact: body.doNotContact ?? false,
      tags: body.tags ?? [],
      customFields: body.customFields ?? {},
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'contact.create',
    resourceType: 'contact',
    resourceId: contact.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: contact, requestId: uuidv4() }, { status: 201 })
})
