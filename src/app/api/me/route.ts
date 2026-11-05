/**
 * GET /api/me — current user, memberships (for the org switcher), role + permissions.
 * PATCH /api/me — update own profile + notification preferences.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { buildSessionPayload } from '@/lib/auth/session-payload'
import { updateUserSchema } from '@/lib/validations/admin'
import { validateCsrf } from '@/lib/auth/csrf'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { ZodError } from 'zod'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: NextRequest) {
  const requestId = uuidv4()
  const sessionUser = await getCurrentUser()

  if (!sessionUser) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }
  void req

  return NextResponse.json({
    success: true,
    data: await buildSessionPayload(sessionUser),
    requestId,
  })
}

export async function PATCH(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const sessionUser = await getCurrentUser()
  if (!sessionUser) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  let body
  try {
    body = updateUserSchema.parse(await req.json())
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors, requestId },
        { status: 400 }
      )
    }
    throw error
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: {
      ...(body.fullName ? { fullName: body.fullName } : {}),
      ...(body.firstName ? { firstName: body.firstName } : {}),
      ...(body.lastName ? { lastName: body.lastName } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
      ...(body.department !== undefined ? { department: body.department } : {}),
      ...(body.timezone ? { timezone: body.timezone } : {}),
      ...(body.locale ? { locale: body.locale } : {}),
      ...(body.notificationPreferences ? { notificationPreferences: body.notificationPreferences } : {}),
      ...(body.phoneNumber !== undefined ? { phoneNumber: body.phoneNumber } : {}),
      ...(body.phoneCountryCode !== undefined ? { phoneCountryCode: body.phoneCountryCode } : {}),
    },
  })

  await createAuditLog({
    actorUserId: sessionUser.id,
    action: 'profile.update',
    resourceType: 'user',
    resourceId: sessionUser.id,
    requestId,
  })

  return NextResponse.json({ success: true, data: { updated: true }, requestId })
}
