import { createHash, randomBytes } from 'crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { env } from '@/env'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export interface GoogleIdentity {
  email: string
  subject: string
}

export function googleOAuthConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('Google sign-in is not configured')
  }

  const appUrl = new URL(env.NEXT_PUBLIC_APP_URL)
  if (appUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(appUrl.hostname)) {
    throw new Error('Google sign-in requires HTTPS outside localhost')
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL('/api/auth/google/callback', appUrl).toString(),
  }
}

export function createOAuthSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard'
  }
  return value
}

export function googleAuthorizationUrl(input: {
  state: string
  nonce: string
  codeVerifier: string
}): string {
  const { clientId, redirectUri } = googleOAuthConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    nonce: input.nonce,
    code_challenge: createHash('sha256').update(input.codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeGoogleCode(code: string, codeVerifier: string, nonce: string): Promise<GoogleIdentity> {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
    cache: 'no-store',
  })

  if (!response.ok) throw new Error('Google authorization code exchange failed')
  const tokenBody = await response.json() as { id_token?: unknown }
  if (typeof tokenBody.id_token !== 'string') throw new Error('Google ID token missing')

  const { payload } = await jwtVerify(tokenBody.id_token, GOOGLE_JWKS, {
    audience: clientId,
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
  })

  if (
    payload.nonce !== nonce ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.email_verified !== true
  ) {
    throw new Error('Google identity claims are invalid')
  }

  return { email: payload.email.trim().toLowerCase(), subject: payload.sub }
}