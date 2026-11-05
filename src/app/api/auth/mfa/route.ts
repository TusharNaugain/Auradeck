/**
 * MFA management: GET setup (provisions TOTP secret), POST enable (verify + store),
 * DELETE disable. Requires an authenticated session; state changes are CSRF-protected.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { validateCsrf } from '@/lib/auth/csrf'
import { generateTotpSecret, enableMfa, disableMfa, generateRecoveryCodes } from '@/lib/auth/mfa'
import { z } from 'zod'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

const confirmSetupSchema = z.object({
  secret: z.string().min(10).max(64),
  token: z.string().regex(/^\d{6}$/),
})

export async function GET(req: NextRequest) {
  const requestId = uuidv4()
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }
  void req

  // Re-provision a fresh secret for setup; clear stale un-verified ones
  await db.mfaSecret.deleteMany({
    where: { userId: user.id, isActive: false, verifiedAt: null },
  })

  const { secret, otpauthUri } = generateTotpSecret(user.email)
  return NextResponse.json({ success: true, data: { secret, otpauthUri }, requestId })
}

export async function POST(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  let parsed: z.infer<typeof confirmSetupSchema>
  try {
    parsed = confirmSetupSchema.parse(await req.json())
  } catch {
    return NextResponse.json(
      { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR', requestId },
      { status: 400 }
    )
  }

  const recovery = generateRecoveryCodes()
  const enabled = await enableMfa(user.id, parsed.secret, parsed.token, recovery.hashed)
  if (!enabled) {
    return NextResponse.json(
      { success: false, error: 'Invalid verification code. Please try again.', code: 'MFA_FAILED', requestId },
      { status: 400 }
    )
  }

  await createAuditLog({
    actorUserId: user.id,
    action: 'auth.mfa_enabled',
    resourceType: 'user',
    resourceId: user.id,
    requestId,
  })

  // Recovery codes are returned once and are the user's only backup
  return NextResponse.json({
    success: true,
    data: { enabled: true, recoveryCodes: recovery.plaintext },
    requestId,
  })
}

export async function DELETE(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json(
      { success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId },
      { status: 403 }
    )
  }

  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
      { status: 401 }
    )
  }

  await disableMfa(user.id)
  await createAuditLog({
    actorUserId: user.id,
    action: 'auth.mfa_disabled',
    resourceType: 'user',
    resourceId: user.id,
    requestId,
  })

  return NextResponse.json({ success: true, data: { enabled: false }, requestId })
}
