/**
 * GET /api/organisations — memberships list (org switcher data).
 * PATCH /api/organisations — update current organisation settings (settings.manage).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth/session'
import { validateCsrf } from '@/lib/auth/csrf'
import { organisationUpdateSchema } from '@/lib/validations/admin'
import { getAuthContext, PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { maskTaxNumber } from '@/lib/services/effects'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

export async function GET() {
  const requestId = uuidv4()
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const memberships = await db.membership.findMany({
    where: { userId: user.id, status: 'ACTIVE' },
    include: {
      organisation: {
        select: {
          id: true, displayName: true, slug: true, type: true, status: true,
          logoUrl: true, city: true, state: true, currency: true, timezone: true,
        },
      },
      role: { select: { slug: true, name: true } },
    },
  })

  return NextResponse.json(
    { success: true, data: { memberships }, requestId }
  )
}

export async function PATCH(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const user = await getCurrentUser()
  if (!user || !user.currentOrganisationId) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  const ctx = await getAuthContext(user.id, user.currentOrganisationId)
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: 'Access denied', code: 'PERMISSION_DENIED', requestId },
      { status: 403 }
    )
  }

  // Practice settings managed by settings.manage; internal org settings restricted to super admin
  const allowed =
    ctx.permissions.has(PERMISSIONS.SETTINGS_MANAGE) ||
    ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: "You don't have permission to update organisation settings", code: 'PERMISSION_DENIED', requestId },
      { status: 403 }
    )
  }

  let body
  try {
    body = organisationUpdateSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId },
        { status: 400 }
      )
    }
    throw error
  }

  const updated = await db.organisation.update({
    where: { id: user.currentOrganisationId },
    data: {
      ...(body.legalName ? { legalName: body.legalName } : {}),
      ...(body.displayName ? { displayName: body.displayName } : {}),
      ...(body.practiceName !== undefined ? { practiceName: body.practiceName } : {}),
      ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
      ...(body.website !== undefined ? { website: body.website } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.industry !== undefined ? { industry: body.industry } : {}),
      ...(body.practiceType !== undefined ? { practiceType: body.practiceType } : {}),
      ...(body.registrationNumber !== undefined ? { registrationNumber: body.registrationNumber } : {}),
      ...(body.taxNumber !== undefined ? { taxNumber: body.taxNumber } : {}),
      ...(body.primaryEmail ? { primaryEmail: body.primaryEmail } : {}),
      ...(body.primaryPhone ? { primaryPhone: body.primaryPhone } : {}),
      ...(body.alternatePhone !== undefined ? { alternatePhone: body.alternatePhone } : {}),
      ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 } : {}),
      ...(body.addressLine2 !== undefined ? { addressLine2: body.addressLine2 } : {}),
      ...(body.city !== undefined ? { city: body.city } : {}),
      ...(body.state !== undefined ? { state: body.state } : {}),
      ...(body.postalCode !== undefined ? { postalCode: body.postalCode } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      ...(body.currency ? { currency: body.currency } : {}),
      ...(body.dateFormat ? { dateFormat: body.dateFormat } : {}),
      ...(body.language ? { language: body.language } : {}),
      ...(body.status ? { status: body.status.toUpperCase() as never } : {}),
      ...(body.lifecycleStage !== undefined ? { lifecycleStage: body.lifecycleStage } : {}),
      ...(body.renewalDate !== undefined ? { renewalDate: body.renewalDate ? new Date(body.renewalDate) : null } : {}),
      ...(body.churnReason !== undefined ? { churnReason: body.churnReason } : {}),
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    },
  })

  await createAuditLog({
    organisationId: user.currentOrganisationId,
    actorUserId: user.id,
    action: 'organisation.update',
    resourceType: 'organisation',
    resourceId: user.currentOrganisationId,
    ipHash: undefined,
  })

  void maskTaxNumber

  return NextResponse.json(
    { success: true, data: { id: updated.id, displayName: updated.displayName }, requestId }
  )
}
