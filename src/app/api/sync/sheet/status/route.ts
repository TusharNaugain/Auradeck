/**
 * GET /api/sync/sheet/status[?repair=1] — health + reconciliation.
 * Reports open conflicts, recent rejected rows and Postgres-vs-Firestore drift.
 * `repair=1` rewrites the Firestore MIRROR from Postgres; it never writes to Postgres.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { authenticateSync, isFailure } from '@/lib/sync/http'
import { createPrismaSyncStore } from '@/lib/sync/prisma-store'
import { reconcileMirror } from '@/lib/sync/mirror'
import { routeHandler } from '@/lib/utils/api-helpers'

export const dynamic = 'force-dynamic'

export const GET = routeHandler(async (req: NextRequest) => {
  const auth = await authenticateSync(req, 'query')
  if (isFailure(auth)) return auth
  const org = auth.organisationId
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [liveLeads, archivedLeads, openConflicts, rejectedLast24h, lastBatch] = await Promise.all([
    db.lead.count({ where: { organisationId: org, deletedAt: null } }),
    db.lead.count({ where: { organisationId: org, deletedAt: { not: null } } }),
    db.syncConflict.count({ where: { organisationId: org, status: 'open' } }),
    db.syncRejectedRow.count({ where: { organisationId: org, createdAt: { gte: since } } }),
    db.syncBatch.findFirst({
      where: { organisationId: org },
      orderBy: { createdAt: 'desc' },
      select: { batchId: true, status: true, createdAt: true, completedAt: true },
    }),
  ])

  let mirror: unknown = { configured: false }
  if (process.env.FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    try {
      const store = createPrismaSyncStore()
      mirror = {
        configured: true,
        ...(await reconcileMirror(
          org,
          take => store.listChangedLeads(org, { since: null, afterId: null, limit: take }),
          { repair: req.nextUrl.searchParams.get('repair') === '1' }
        )),
      }
    } catch (error) {
      mirror = { configured: true, error: error instanceof Error ? error.message : 'reconcile failed' }
    }
  }

  return NextResponse.json(
    { success: true, data: { liveLeads, archivedLeads, openConflicts, rejectedLast24h, lastBatch, mirror } },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
