/**
 * Minimal Resend client for campaigns: segments, contacts and broadcasts.
 * Resend allows 10 requests/second per team (shared by every API key), so calls are paced
 * and a 429 waits for Retry-After before retrying.
 */

import { env } from '@/env'
import { logger } from '@/lib/utils/logger'

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email sending is not configured (RESEND_API_KEY is missing)')
  }
}

export interface CampaignContact {
  email: string
  firstName: string
  lastName: string
}

const PACE_MS = 120
const MAX_RETRIES = 5
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let lastCallAt = 0

type Method = 'GET' | 'POST' | 'DELETE'

/** Calls Resend. Returns the parsed body, or null when the response status equals `tolerate`. */
async function call<T = { id: string }>(method: Method, path: string, body?: unknown, tolerate?: number): Promise<T | null> {
  if (!env.RESEND_API_KEY) throw new EmailNotConfiguredError()
  for (let attempt = 0; ; attempt++) {
    await sleep(Math.max(0, lastCallAt + PACE_MS - Date.now()))
    lastCallAt = Date.now()
    const res = await fetch(`${env.RESEND_API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.ok) return (await res.json()) as T
    if (res.status === tolerate) return null
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep((Number(res.headers.get('retry-after')) || 1) * 1000)
      continue
    }
    const detail = (await res.text().catch(() => '')).slice(0, 300)
    logger.error('Resend request failed', { status: res.status })
    throw new Error(`Resend ${res.status}: ${detail}`)
  }
}

const post = (path: string, body?: unknown, tolerate?: number) => call('POST', path, body, tolerate)
const required = async (path: string, body?: unknown) => (await post(path, body))!

export async function createSegment(name: string): Promise<string> {
  return (await required('/segments', { name })).id
}

/**
 * Adds each contact to the segment. Existing contacts are added by email and never modified, so
 * anyone who unsubscribed in Resend stays unsubscribed; unknown contacts (404) are created.
 */
export async function addContactsToSegment(segmentId: string, contacts: CampaignContact[]): Promise<void> {
  for (const { email, firstName, lastName } of contacts) {
    const added = await post(`/contacts/${encodeURIComponent(email)}/segments/${segmentId}`, undefined, 404)
    if (!added) {
      await required('/contacts', { email, first_name: firstName, last_name: lastName, segments: [{ id: segmentId }] })
    }
  }
}

const from = () => `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM_ADDRESS}>`

/** Creates and sends the broadcast in one call: the only step that emails the segment. */
export async function sendBroadcast(b: { segmentId: string; name: string; subject: string; html: string; text: string }) {
  const { segmentId, ...rest } = b
  return (await required('/broadcasts', { segment_id: segmentId, from: from(), ...rest, send: true })).id
}

export async function sendTestEmail(to: string, subject: string, html: string, text: string): Promise<void> {
  await required('/emails', { from: from(), to: [to], subject, html, text })
}

/**
 * Resend plans cap how many segments a team may keep (3 on the free plan), and every campaign
 * makes one. Deleting a segment keeps its contacts (and their unsubscribe state); a missing one is fine.
 */
export async function deleteSegment(segmentId: string): Promise<void> {
  await call('DELETE', `/segments/${encodeURIComponent(segmentId)}`, undefined, 404)
}

/** The broadcast's Resend status ("draft", "queued", "sending", "sent", ...), or null if it no longer exists. */
export async function broadcastStatus(broadcastId: string): Promise<string | null> {
  const b = await call<{ status?: string }>('GET', `/broadcasts/${encodeURIComponent(broadcastId)}`, undefined, 404)
  return b ? b.status ?? 'unknown' : null
}
