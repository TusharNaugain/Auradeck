/**
 * /api/contacts/[id] — detail with related opportunities (GET), update (PATCH), soft delete (DELETE).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { contactUpdateSchema } from '@/lib/validations/crm'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError, ConflictError } from '@/lib/services/errors'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CONTACTS_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const contact = await db.contact.findFirst({
    where: { id, organisationId, deletedAt: null },
    include: {
      account: { select: { id: true, accountName: true, customerAccountCode: true } },
      opportunities: {
        where: { deletedAt: null },
        select: { id: true, name: true, stage: true, amount: true, type: true },
      },
    },
  })
  if (!contact) throw new NotFoundError('Contact not found')

  return NextResponse.json(
    { success: true, data: { contact }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CONTACTS_UPDATE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const contact = await db.contact.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true, fullName: true, accountId: true, email: true, isPrimary: true },
  })
  if (!contact) throw new NotFoundError('Contact not found')

  let body
  try {
    body = contactUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId: uuidv4() },
        { status: 400 }
      )
    }
    throw error
  }

  // Email uniqueness within org+account
  if (body.email && body.email !== contact.email) {
    const dup = await db.contact.findFirst({
      where: {
        organisationId,
        deletedAt: null,
        email: body.email,
        id: { not: contact.id },
        ...(contact.accountId ? { accountId: contact.accountId } : {}),
      },
      select: { id: true },
    })
    if (dup) throw new ConflictError('A contact with this email already exists')
  }

  if (body.isPrimary && contact.accountId) {
    await db.contact.updateMany({
      where: { organisationId, accountId: contact.accountId, isPrimary: true, id: { not: contact.id } },
      data: { isPrimary: false },
    })
  }

  const updated = await db.contact.update({
    where: { id: contact.id },
    data: {
      ...(body.firstName ? { firstName: body.firstName, fullName: `${body.firstName} ${contact.fullName.split(' ')[1] ?? body.lastName ?? ''}` } : {}),
      ...(body.lastName ? { lastName: body.lastName } : {}),
      ...(body.preferredName !== undefined ? { preferredName: body.preferredName } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
      ...(body.secondaryEmail !== undefined ? { secondaryEmail: body.secondaryEmail } : {}),
      ...(body.phone !== undefined ? { phoneNumber: body.phone, phoneCountryCode: body.phone?.startsWith('+') ? body.phone.slice(1, 3) : undefined } : {}),
      ...(body.whatsappNumber !== undefined ? { whatsappNumber: body.whatsappNumber } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
      ...(body.department !== undefined ? { department: body.department } : {}),
      ...(body.contactType ? { contactType: body.contactType.toUpperCase() as never } : {}),
      ...(body.isPrimary !== undefined ? { isPrimary: body.isPrimary } : {}),
      ...(body.isDecisionMaker !== undefined ? { isDecisionMaker: body.isDecisionMaker } : {}),
      ...(body.influenceLevel !== undefined ? { influenceLevel: body.influenceLevel?.toUpperCase() as never } : {}),
      ...(body.preferredLanguage !== undefined ? { preferredLanguage: body.preferredLanguage } : {}),
      ...(body.preferredContactMethod !== undefined ? { preferredContactMethod: body.preferredContactMethod?.toUpperCase() as never } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.linkedinUrl !== undefined ? { linkedinUrl: body.linkedinUrl } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.consentStatus !== undefined ? { consentStatus: body.consentStatus } : {}),
      ...(body.doNotContact !== undefined ? { doNotContact: body.doNotContact } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'contact.update',
    resourceType: 'contact',
    resourceId: contact.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: updated, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.CONTACTS_DELETE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const contact = await db.contact.findFirst({
    where: { id, organisationId, deletedAt: null },
    select: { id: true, fullName: true },
  })
  if (!contact) throw new NotFoundError('Contact not found')

  await db.contact.update({ where: { id: contact.id }, data: { deletedAt: new Date() } })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'contact.soft_delete',
    resourceType: 'contact',
    resourceId: contact.id,
    ipHash,
  })

  return NextResponse.json({ success: true, data: { deleted: true }, requestId: uuidv4() })
})
