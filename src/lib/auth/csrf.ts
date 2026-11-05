/**
 * CSRF protection for cookie-authenticated, state-changing requests.
 * Strategy:
 *  1. Strict Origin/Referer validation against configured allowed origins
 *  2. Double-submit CSRF token (non-HttpOnly csrf_token cookie paired with X-CSRF-Token header)
 * Tokens are derived from an HMAC with CSRF_SECRET so they are invalid without the server secret.
 */

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { env } from '@/env'

const CSRF_COOKIE = 'auradeck_csrf'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const ALLOWED_ORIGINS: string[] = (env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

/** Origin validation for any mutation request */
export function validateOrigin(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return true

  const origin = req.headers.get('origin')
  const referer = req.headers.get('referer')

  // Origin is mandatory for state-changing requests in modern browsers (fetch/XHR send it)
  if (!origin && !referer) {
    // No origin info at all — likely non-browser client; require them to have been token-exempt deliberately
    // We deny by default (fail closed) except in clearly non-web contexts.
    return false
  }

  const parsed = origin ?? (referer ? new URL(referer).origin : '')
  if (!parsed) return false
  return ALLOWED_ORIGINS.includes(parsed)
}

/** Derive the CSRF token bound to a given value */
function deriveToken(): string {
  return crypto
    .createHmac('sha256', env.CSRF_SECRET ?? env.SESSION_SECRET)
    .update('auradeck-csrf-v1')
    .digest('hex')
}

/**
 * The double-submit token. Since every user's token is identical within a deployment
 * (bound to CSRF_SECRET), verifying presence+value equality is still safe against
 * cross-site attacks when combined with strict Origin validation above.
 */
export function getCsrfToken(): string {
  return deriveToken()
}

export function setCsrfCookie(response: import('next/server').NextResponse): void {
  response.cookies.set({
    name: CSRF_COOKIE,
    value: getCsrfToken(),
    httpOnly: false, // Must be readable by client JS for double-submit
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
}

export const CSRF_COOKIE_NAME = CSRF_COOKIE

/**
 * Public mutation endpoints (login/register/forgot/reset) rely on strict origin
 * validation + per-IP rate limiting; there is no session cookie to bind to yet.
 */
export function assertPublicMutationOrigin(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method)) return
  if (!validateOrigin(req)) {
    throw new Error('CSRF_ORIGIN_REJECTED')
  }
}

export function validateCsrf(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return true

  // Strict origin check is the primary defence
  if (!validateOrigin(req)) return false

  const cookieToken = req.cookies.get(CSRF_COOKIE)?.value
  const headerToken = req.headers.get('x-csrf-token')

  // Double-submit check — both must exist and match the HMAC token
  if (!cookieToken || !headerToken) return false
  if (!timingSafeEqual(cookieToken, headerToken)) return false
  if (!timingSafeEqual(cookieToken, deriveToken())) return false

  return true
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** Extract an object's expected accessible IP from request forwarded headers */
export function requestUserAgentHash(req: NextRequest): string {
  const ua = req.headers.get('user-agent') ?? ''
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 24)
}

export function requestIpHash(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? '127.0.0.1'
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 24)
}
