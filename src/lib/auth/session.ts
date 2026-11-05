/**
 * Server-side session management using iron-session.
 * Sessions are stored in secure, HttpOnly, SameSite cookies.
 * No tokens or session data is stored in localStorage or sessionStorage.
 */

import { cache } from 'react'
import { getIronSession, IronSession } from 'iron-session'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { db } from '@/lib/db'
import crypto from 'crypto'

export interface SessionData {
  sessionId?: string
  userId?: string
  organisationId?: string
  // MFA state tracking
  mfaPending?: boolean
  mfaUserId?: string
  googleOAuthState?: string
  googleOAuthNonce?: string
  googleOAuthCodeVerifier?: string
  googleOAuthIssuedAt?: number
  googleOAuthNext?: string
  googleMfaUserId?: string
  googleMfaOrganisationId?: string
  googleMfaIssuedAt?: number
  googleMfaNext?: string
}

const SESSION_OPTIONS = {
  password: env.IRON_SESSION_PASSWORD || 'fallback-dev-password-must-be-changed-in-prod',
  cookieName: 'auradeck_session',
  cookieOptions: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  },
}

/**
 * Get the current iron-session from the incoming request cookies.
 * This is safe for use in Server Components and Route Handlers.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies()
  return getIronSession<SessionData>(cookieStore, SESSION_OPTIONS)
}

/**
 * Get the current session from a NextRequest (useful in middleware).
 */
export async function getSessionFromRequest(
  req: NextRequest,
  res: NextResponse
): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(req, res, SESSION_OPTIONS)
}

/**
 * Get the currently authenticated user from the session.
 * Returns null if not authenticated or session is invalid.
 * Memoized per-request using React cache to prevent redundant DB hits across
 * root layout, dashboard shell, and page components.
 */
export const getCurrentUser = cache(async () => {
  const session = await getSession()

  if (!session.sessionId || !session.userId) {
    return null
  }

  // Verify session still exists and is not revoked
  const dbSession = await db.session.findFirst({
    where: {
      id: session.sessionId,
      userId: session.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          avatarUrl: true,
          status: true,
          timezone: true,
          locale: true,
          mfaEnabled: true,
          emailVerifiedAt: true,
          memberships: {
            where: { status: 'ACTIVE' },
            include: {
              organisation: {
                select: {
                  id: true,
                  displayName: true,
                  slug: true,
                  logoUrl: true,
                  type: true,
                  status: true,
                },
              },
              role: {
                include: {
                  permissions: true,
                },
              },
            },
          },
        },
      },
    },
  })

  if (!dbSession?.user) {
    // Session invalid; clear cookie
    await clearSession()
    return null
  }

  // Update last active time (throttled to at most once per 5 minutes, non-blocking)
  const FIVE_MINUTES_MS = 5 * 60 * 1000
  const lastActive = dbSession.lastActiveAt ? new Date(dbSession.lastActiveAt).getTime() : 0
  if (Date.now() - lastActive > FIVE_MINUTES_MS) {
    void db.session
      .update({
        where: { id: session.sessionId },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => {})
  }

  return {
    ...dbSession.user,
    sessionId: session.sessionId,
    currentOrganisationId: session.organisationId,
  }
})

/**
 * Create a new session for a user after successful authentication.
 * Returns the session token (already stored in cookie).
 */
export async function createSession(
  userId: string,
  organisationId: string | undefined,
  deviceInfo: {
    userAgent?: string
    ipAddress?: string
  }
) {
  const session = await getSession()
  
  const tokenRaw = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex')
  
  const ipHash = deviceInfo.ipAddress
    ? crypto.createHash('sha256').update(deviceInfo.ipAddress).digest('hex')
    : null

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  const dbSession = await db.session.create({
    data: {
      userId,
      tokenHash,
      deviceInfo: {
        userAgent: deviceInfo.userAgent,
      },
      ipAddressHash: ipHash,
      userAgent: deviceInfo.userAgent?.substring(0, 512),
      expiresAt,
    },
  })

  session.sessionId = dbSession.id
  session.userId = userId
  session.organisationId = organisationId
  await session.save()

  return dbSession.id
}

/**
 * Clear the current session cookie and mark the DB session as revoked.
 */
export async function clearSession() {
  const session = await getSession()
  
  if (session.sessionId) {
    await db.session.update({
      where: { id: session.sessionId },
      data: { revokedAt: new Date() },
    }).catch(() => {})
  }
  
  session.destroy()
}

/**
 * Revoke all sessions for a user (logout everywhere).
 */
export async function revokeAllSessions(userId: string) {
  await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  })
}

/**
 * Switch the active organisation context in the session.
 */
export async function switchOrganisation(organisationId: string) {
  const session = await getSession()
  session.organisationId = organisationId
  await session.save()
}
