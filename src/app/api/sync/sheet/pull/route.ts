/**
 * GET /api/sync/sheet/pull?cursor=&limit=&fresh= — CRM -> sheet.
 * HMAC-signed over the query string. Read-only: pulling never changes data.
 * The sheet must push its own edits first, then pull, then ack what it wrote.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateSync, isFailure } from '@/lib/sync/http'
import { pullChanges } from '@/lib/sync/lead-sync'
import { createPrismaSyncStore } from '@/lib/sync/prisma-store'
import { routeHandler } from '@/lib/utils/api-helpers'

export const dynamic = 'force-dynamic'

export const GET = routeHandler(async (req: NextRequest) => {
  const auth = await authenticateSync(req, 'query')
  if (isFailure(auth)) return auth

  const params = req.nextUrl.searchParams
  const limit = Number(params.get('limit') ?? 100)
  const result = await pullChanges(createPrismaSyncStore(), auth.organisationId, {
    cursor: params.get('cursor'),
    limit: Number.isFinite(limit) ? limit : 100,
    fresh: params.get('fresh') === '1',
  })

  return NextResponse.json({ success: true, data: result }, { headers: { 'Cache-Control': 'private, no-store' } })
})
