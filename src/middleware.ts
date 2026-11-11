/**
 * Edge middleware: request IDs + lightweight route guards.
 * NOTE: full authentication/permission checks are enforced again at every
 * route handler and server component (defense in depth) — this middleware
 * only gives fast redirect feedback for unauthenticated navigation and
 * attaches a request ID to each request for observability.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { unsealData } from 'iron-session'

const REQUEST_ID_HEADER = 'x-request-id'
const COOKIE_NAME = 'auradeck_session'
const CSRF_COOKIE_NAME = 'auradeck_csrf'
const CSRF_TOKEN_CONTEXT = 'auradeck-csrf-v1'

const PROTECTED_PAGES = [
  '/dashboard', '/leads', '/accounts', '/contacts', '/opportunities',
  '/activities', '/onboarding', '/success', '/tickets', '/clients',
  '/appointments', '/billing', '/reports', '/tasks', '/automations',
  '/knowledge-base', '/settings', '/notifications',
]

// /api/sync/* is called by the sheet script, not a browser: each route verifies an HMAC signature instead of a cookie.
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/health', '/api/webhooks', '/api/sync']
const REDIRECT_IF_AUTHED = ['/login', '/register']
const CSRF_PAGES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
  '/verify-email',
]

interface SessionCookiePayload {
  sessionId?: string
  userId?: string
  organisationId?: string
  mfaPending?: boolean
  mfaUserId?: string
}

let cachedPassword: string | null = null

function sessionPassword(): string {
  if (cachedPassword) return cachedPassword
  cachedPassword =
    process.env.IRON_SESSION_PASSWORD ||
    '0134edcc87feea06429e07f15dae2828377c0e0b80146f17098362c9b046efe6'
  return cachedPassword
}

async function readSession(request: NextRequest): Promise<SessionCookiePayload> {
  const raw = request.cookies.get(COOKIE_NAME)?.value
  if (!raw) return {}
  try {
    return (await unsealData(raw, {
      password: sessionPassword(),
      ttl: 60 * 60 * 24 * 30,
    })) as unknown as SessionCookiePayload
  } catch {
    return {}
  }
}

let cachedCsrfToken: string | null = null

async function csrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken
  const secret =
    process.env.CSRF_SECRET ||
    process.env.SESSION_SECRET ||
    '3ba656f3d7c696839825a8fbae6254d6925573c2471d1899a2b1df3c9476f5b3'

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(CSRF_TOKEN_CONTEXT)
  )
  cachedCsrfToken = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
  return cachedCsrfToken
}

export async function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID()
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(REQUEST_ID_HEADER, requestId)

  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api/')
  const isProtectedApi = isApi && !PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))
  const isProtectedPage = PROTECTED_PAGES.some(p => pathname === p || pathname.startsWith(`${p}/`))
  const isLoginish = REDIRECT_IF_AUTHED.some(p => pathname === p || pathname.startsWith(`${p}/`))
  const needsCsrfCookie = isApi || CSRF_PAGES.includes(pathname)
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

  let response: NextResponse

  if (demoMode && isProtectedPage) {
    response = NextResponse.next({ request: { headers: requestHeaders } })
  } else if (isProtectedApi || isProtectedPage || isLoginish) {
    const session = await readSession(request)

    if (isProtectedPage && !session.userId) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.search = ''
      url.searchParams.set('next', pathname)
      response = NextResponse.redirect(url)
    } else if (isProtectedApi && !session.userId) {
      // Route handlers re-check auth (DB-backed) — this is only a fast reject
      response = NextResponse.json(
        { success: false, error: 'Authentication required', code: 'AUTH_REQUIRED', requestId },
        { status: 401 }
      )
    } else if (isLoginish && session.userId && !session.mfaPending && !request.nextUrl.searchParams.has('expired')) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      url.search = ''
      response = NextResponse.redirect(url)
    } else {
      response = NextResponse.next({ request: { headers: requestHeaders } })
    }
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  response.headers.set(REQUEST_ID_HEADER, requestId)
  if (needsCsrfCookie) {
    const token = await csrfToken()
    if (request.cookies.get(CSRF_COOKIE_NAME)?.value !== token) {
      response.cookies.set({
        name: CSRF_COOKIE_NAME,
        value: token,
        httpOnly: false,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      })
    }
  }
  return response
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/leads/:path*',
    '/accounts/:path*',
    '/contacts/:path*',
    '/opportunities/:path*',
    '/activities/:path*',
    '/onboarding/:path*',
    '/success/:path*',
    '/tickets/:path*',
    '/clients/:path*',
    '/appointments/:path*',
    '/billing/:path*',
    '/reports/:path*',
    '/tasks/:path*',
    '/automations/:path*',
    '/knowledge-base/:path*',
    '/settings/:path*',
    '/notifications/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/accept-invite',
    '/verify-email',
    '/',
    '/api/:path*',
  ],
}
