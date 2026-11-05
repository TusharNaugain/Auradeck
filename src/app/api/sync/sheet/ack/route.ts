/**
 * POST /api/sync/sheet/ack — the sheet confirms which pulled records it wrote.
 * The merge base only advances here, and only for records unchanged since delivery.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateSync, isFailure } from '@/lib/sync/http'
import { ackPayloadSchema, ackPull } from '@/lib/sync/lead-sync'
import { createPrismaSyncStore } from '@/lib/sync/prisma-store'
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
  const parsed = ackPayloadSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, code: 'VALIDATION_ERROR', error: 'Payload failed validation', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const result = await ackPull(createPrismaSyncStore(), auth.organisationId, parsed.data.items)
  return NextResponse.json({ success: true, data: result }, { headers: { 'Cache-Control': 'private, no-store' } })
})
