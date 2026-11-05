/**
 * POST /api/sync/sheet/push — sheet -> CRM.
 * HMAC-signed. Processes each row independently and returns, per row, what the
 * sheet should now contain (including the CRM-assigned lead number).
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateSync, isFailure } from '@/lib/sync/http'
import { processPush, pushPayloadSchema } from '@/lib/sync/lead-sync'
import { createPrismaSyncStore } from '@/lib/sync/prisma-store'
import { mirrorLeads } from '@/lib/sync/mirror'
import { routeHandler } from '@/lib/utils/api-helpers'

export const dynamic = 'force-dynamic'

export const POST = routeHandler(async (req: NextRequest) => {
  const auth = await authenticateSync(req, 'body')
  if (isFailure(auth)) return auth

  let json: unknown
  try {
    json = JSON.parse(auth.rawBody)
  } catch {
    return NextResponse.json({ success: false, code: 'BAD_JSON', error: 'Body must be valid JSON' }, { status: 400 })
  }
  const parsed = pushPayloadSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: 'VALIDATION_ERROR', error: 'Payload failed validation', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const store = createPrismaSyncStore()
  const result = await processPush(store, auth.organisationId, parsed.data, { winner: auth.winner })

  // Best-effort mirror of rows that actually changed. Never affects the result.
  let mirror: { ok: boolean; error?: string } = { ok: true }
  if (!result.replayed && process.env.FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    const touched = result.rows.filter(r => (r.status === 'created' || r.status === 'updated') && r.leadNumber)
    const snapshots = (
      await Promise.all(touched.map(r => store.findLeadByNumber(auth.organisationId, r.leadNumber!)))
    ).filter((s): s is NonNullable<typeof s> => s !== null)
    mirror = await mirrorLeads(auth.organisationId, snapshots)
  }

  return NextResponse.json(
    { success: true, data: result, mirror },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
