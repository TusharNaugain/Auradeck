/**
 * Shared plumbing for the /api/sync/sheet/* routes: signature auth, config.
 * These routes are called by a script, not a browser session, so they are
 * excluded from cookie auth in the middleware and authenticated here instead.
 */

import { NextRequest, NextResponse } from 'next/server'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from './signature'
import type { ConflictWinner } from './engine'

export interface SyncRequestContext {
  organisationId: string
  winner: ConflictWinner
  rawBody: string
}

/**
 * SYNC_ORGANISATION_ID wins when set. Otherwise use the internal organisation, so a freshly
 * bootstrapped deployment needs no manual id copy-paste.
 */
async function resolveOrganisationId(): Promise<string | null> {
  const configured = process.env.SYNC_ORGANISATION_ID?.trim()
  if (configured) return configured
  const { db } = await import('@/lib/db')
  const org = await db.organisation.findFirst({
    where: { type: 'AURADESK_INTERNAL', status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  return org?.id ?? null
}

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, code, error: message }, { status })
}

/**
 * `signedPayload` is what the sender signed: the raw JSON body for POST, the
 * query string (no leading '?') for GET.
 */
export async function authenticateSync(
  req: NextRequest,
  mode: 'body' | 'query'
): Promise<SyncRequestContext | NextResponse> {
  const organisationId = await resolveOrganisationId()
  if (!organisationId) return fail(503, 'SYNC_NOT_CONFIGURED', 'Sync is not configured')

  const rawBody = mode === 'body' ? await req.text() : ''
  const signedPayload = mode === 'body' ? rawBody : req.nextUrl.search.replace(/^\?/, '')

  const check = verifySignature({
    secret: process.env.SYNC_SHARED_SECRET,
    timestamp: req.headers.get(TIMESTAMP_HEADER),
    signature: req.headers.get(SIGNATURE_HEADER),
    payload: signedPayload,
  })
  // Same status for every failure so the endpoint reveals nothing about why.
  if (!check.ok) return fail(401, 'SYNC_AUTH_FAILED', 'Request could not be authenticated')

  const winner: ConflictWinner = process.env.SYNC_CONFLICT_WINNER === 'sheet' ? 'sheet' : 'crm'
  return { organisationId, winner, rawBody }
}

export const isFailure = (value: SyncRequestContext | NextResponse): value is NextResponse =>
  value instanceof NextResponse
