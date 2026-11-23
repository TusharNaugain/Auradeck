/**
 * POST /api/billing/plan/cancel — cancel the practice's plan. Active plans stay
 * usable until the end of the paid period.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { cancelSubscription } from '@/lib/billing/service'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const data = await cancelSubscription(organisationId)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'practice_subscription.cancel',
    resourceType: 'practice_subscription',
    resourceId: organisationId,
    ipHash,
    afterJson: { status: data.status, cancelAtPeriodEnd: data.cancelAtPeriodEnd },
  })

  return NextResponse.json({ success: true, data, requestId: uuidv4() })
})
