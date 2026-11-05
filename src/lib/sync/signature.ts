/**
 * HMAC request signing for the sheet -> CRM channel.
 * Signature = HMAC-SHA256(secret, `${timestamp}.${payload}`), hex encoded.
 * The timestamp window stops captured requests from being replayed later.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNATURE_HEADER = 'x-sync-signature'
export const TIMESTAMP_HEADER = 'x-sync-timestamp'
const MAX_SKEW_MS = 5 * 60 * 1000

export function signPayload(secret: string, timestamp: string, payload: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string }

export function verifySignature(params: {
  secret: string | undefined
  timestamp: string | null
  signature: string | null
  payload: string
  now?: number
}): SignatureCheck {
  const { secret, timestamp, signature, payload, now = Date.now() } = params
  // Fail closed: with no secret configured every request is refused.
  if (!secret || secret.length < 32) return { ok: false, reason: 'Sync is not configured' }
  if (!timestamp || !signature) return { ok: false, reason: 'Missing signature headers' }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > MAX_SKEW_MS) {
    return { ok: false, reason: 'Timestamp outside the allowed window' }
  }

  const expected = Buffer.from(signPayload(secret, timestamp, payload), 'hex')
  let given: Buffer
  try {
    given = Buffer.from(signature, 'hex')
  } catch {
    return { ok: false, reason: 'Malformed signature' }
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'Invalid signature' }
  }
  return { ok: true }
}
