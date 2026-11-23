/**
 * GET /api/billing/plan — the current practice's Auradeck plan, trial, access,
 * available plans and payment history.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { getBillingStatus } from '@/lib/billing/service'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const data = await getBillingStatus(organisationId)
  return NextResponse.json(
    { success: true, data, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
