import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuditLog } from '@/lib/audit'
import { createSession, getSession } from '@/lib/auth/session'
import { requestIpHash, validateCsrf } from '@/lib/auth/csrf'
import { verifyAndConsumeRecoveryCode, verifyTotpToken } from '@/lib/auth/mfa'
import { rateLimit, RATE_LIMIT_POLICIES } from '@/lib/rate-limit'
import { db } from '@/lib/db'
import { v4 as uuidv4 } from 'uuid'

const challengeSchema = z.object({
  mfaToken: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().min(8).max(20).optional(),
}).refine(value => Boolean(value.mfaToken) !== Boolean(value.recoveryCode))
const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function POST(req: NextRequest) {
  const requestId = uuidv4()
  if (!validateCsrf(req)) {
    return NextResponse.json({ success: false, error: 'CSRF validation failed', code: 'CSRF_FAILED', requestId }, { status: 403 })
  }

  const session = await getSession()
  const userId = session.googleMfaUserId
  const organisationId = session.googleMfaOrganisationId
  const issuedAt = session.googleMfaIssuedAt
  if (!userId || !organisationId || !issuedAt || Date.now() - issuedAt > MFA_CHALLENGE_TTL_MS) {
    delete session.googleMfaUserId
    delete session.googleMfaOrganisationId
    delete session.googleMfaIssuedAt
    delete session.googleMfaNext
    await session.save()
    return NextResponse.json({ success: false, error: 'Sign-in challenge expired. Start again.', code: 'AUTH_REQUIRED', requestId }, { status: 401 })
  }

  const parsed = challengeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Enter a valid authentication code.', code: 'VALIDATION_ERROR', requestId }, { status: 400 })
  }

  const ipHash = requestIpHash(req)
  const limit = await rateLimit(`google_mfa:${userId}`, RATE_LIMIT_POLICIES.mfaVerify)
  if (!limit.allowed) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Try again later.', code: 'RATE_LIMITED', requestId }, { status: 429 })
  }

  const [user, membership, secret] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true, mfaEnabled: true } }),
    db.membership.findUnique({
      where: { userId_organisationId: { userId, organisationId } },
      include: { organisation: { select: { status: true, type: true } } },
    }),
    db.mfaSecret.findFirst({ where: { userId, isActive: true }, select: { secret: true } }),
  ])

  if (
    !user || user.status !== 'ACTIVE' || !user.mfaEnabled ||
    !membership || membership.status !== 'ACTIVE' ||
    membership.organisation.status !== 'ACTIVE' || membership.organisation.type !== 'AURADESK_INTERNAL' ||
    !secret || !(parsed.data.mfaToken
      ? verifyTotpToken(secret.secret, parsed.data.mfaToken)
      : await verifyAndConsumeRecoveryCode(userId, parsed.data.recoveryCode!))
  ) {
    if (user) {
      const { recordLoginAttempt } = await import('@/lib/auth/login-guard')
      await recordLoginAttempt(user.email, ipHash, user.id, false, 'google_mfa_failed')
    }
    return NextResponse.json({ success: false, error: 'Invalid authentication code.', code: 'MFA_FAILED', requestId }, { status: 401 })
  }

  const next = session.googleMfaNext || '/dashboard'
  delete session.googleMfaUserId
  delete session.googleMfaOrganisationId
  delete session.googleMfaIssuedAt
  delete session.googleMfaNext
  await session.save()
  await createSession(user.id, organisationId, { userAgent: req.headers.get('user-agent') ?? '' })
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  const { recordLoginAttempt } = await import('@/lib/auth/login-guard')
  await recordLoginAttempt(user.email, ipHash, user.id, true)
  await createAuditLog({ actorUserId: user.id, action: 'auth.login_success', resourceType: 'auth', resourceId: user.id })

  return NextResponse.json({ success: true, data: { status: 'ok', next }, requestId })
}