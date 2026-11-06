import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/env'
import { getCurrentUser, getSession } from '@/lib/auth/session'
import { createOAuthSecret, googleAuthorizationUrl, safeNextPath } from '@/lib/auth/google-oauth'

export async function GET(req: NextRequest) {
  try {
    const next = safeNextPath(req.nextUrl.searchParams.get('next'))
    if (await getCurrentUser()) {
      return NextResponse.redirect(new URL(next, env.NEXT_PUBLIC_APP_URL))
    }

    const state = createOAuthSecret()
    const nonce = createOAuthSecret()
    const codeVerifier = createOAuthSecret()
    const authorizationUrl = googleAuthorizationUrl({ state, nonce, codeVerifier })
    const session = await getSession()

    session.googleOAuthState = state
    session.googleOAuthNonce = nonce
    session.googleOAuthCodeVerifier = codeVerifier
    session.googleOAuthIssuedAt = Date.now()
    session.googleOAuthNext = next
    await session.save()

    return NextResponse.redirect(authorizationUrl)
  } catch (err) {
    console.error('[google-oauth/start] failed:', err instanceof Error ? err.message : err, {
      hasClientId: Boolean(env.GOOGLE_CLIENT_ID),
      hasClientSecret: Boolean(env.GOOGLE_CLIENT_SECRET),
      appUrl: env.NEXT_PUBLIC_APP_URL,
    })
    return NextResponse.redirect(new URL('/login?google_error=unavailable', env.NEXT_PUBLIC_APP_URL))
  }
}