import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { env } from '@/env'
import { createAuditLog } from '@/lib/audit'
import { createSession, getSession } from '@/lib/auth/session'
import { exchangeGoogleCode, safeNextPath } from '@/lib/auth/google-oauth'
import { requestIpHash } from '@/lib/auth/csrf'
import { recordLoginAttempt } from '@/lib/auth/login-guard'
import { hashIp, rateLimit, RATE_LIMIT_POLICIES } from '@/lib/rate-limit'
import { db } from '@/lib/db'

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

function loginRedirect(params: Record<string, string>): NextResponse {
  const url = new URL('/login', env.NEXT_PUBLIC_APP_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  const stateValid = stateMatches(session.googleOAuthState, req.nextUrl.searchParams.get('state'))
  const issuedAt = session.googleOAuthIssuedAt
  const verifier = session.googleOAuthCodeVerifier
  const nonce = session.googleOAuthNonce
  const next = safeNextPath(session.googleOAuthNext)

  delete session.googleOAuthState
  delete session.googleOAuthIssuedAt
  delete session.googleOAuthCodeVerifier
  delete session.googleOAuthNonce
  delete session.googleOAuthNext
  await session.save()

  if (!stateValid || !issuedAt || Date.now() - issuedAt > OAUTH_STATE_TTL_MS || !verifier || !nonce) {
    console.error('[google-oauth/callback] invalid state/session', {
      stateValid, hasIssuedAt: Boolean(issuedAt), hasVerifier: Boolean(verifier), hasNonce: Boolean(nonce),
      hasSessionCookie: Boolean(req.cookies.get('auradeck_session')),
    })
    return loginRedirect({ google_error: 'failed' })
  }

  if (req.nextUrl.searchParams.has('error')) {
    console.error('[google-oauth/callback] Google returned error:', req.nextUrl.searchParams.get('error'))
    return loginRedirect({ google_error: 'failed' })
  }
  const code = req.nextUrl.searchParams.get('code')
  if (!code) return loginRedirect({ google_error: 'failed' })

  const ipHash = requestIpHash(req)
  const limit = await rateLimit(`google:${hashIp(ipHash)}`, { ...RATE_LIMIT_POLICIES.login, prefix: 'rl:google_login' })
  if (!limit.allowed) return loginRedirect({ google_error: 'retry' })

  try {
    const identity = await exchangeGoogleCode(code, verifier, nonce)
    const user = await db.user.findUnique({
      where: { email: identity.email },
      select: { id: true, status: true, mfaEnabled: true },
    })
    const memberships = user?.status === 'ACTIVE'
      ? await db.membership.findMany({
          where: { userId: user.id, status: 'ACTIVE' },
          include: { organisation: { select: { id: true, status: true, type: true } } },
          orderBy: { isPrimary: 'desc' },
        })
      : []
    const internalMembership = memberships.find(
      membership => membership.organisation.type === 'AURADESK_INTERNAL' && membership.organisation.status === 'ACTIVE'
    )

    if (!user || !internalMembership) {
      await recordLoginAttempt(identity.email, ipHash, user?.id ?? null, false, 'google_account_not_authorized')
      return loginRedirect({ google_error: 'access' })
    }

    if (user.mfaEnabled) {
      session.googleMfaUserId = user.id
      session.googleMfaOrganisationId = internalMembership.organisation.id
      session.googleMfaIssuedAt = Date.now()
      session.googleMfaNext = next
      await session.save()

      const url = new URL('/login', env.NEXT_PUBLIC_APP_URL)
      url.searchParams.set('google_mfa', '1')
      url.searchParams.set('next', next)
      return NextResponse.redirect(url)
    }

    await createSession(user.id, internalMembership.organisation.id, {
      userAgent: req.headers.get('user-agent') ?? '',
    })
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await recordLoginAttempt(identity.email, ipHash, user.id, true)
    await createAuditLog({ actorUserId: user.id, action: 'auth.login_success', resourceType: 'auth', resourceId: user.id })

    return NextResponse.redirect(new URL(next, env.NEXT_PUBLIC_APP_URL))
  } catch (err) {
    console.error('[google-oauth/callback] failed:', err instanceof Error ? err.message : err)
    return loginRedirect({ google_error: 'failed' })
  }
}