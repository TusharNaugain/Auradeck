/**
 * POST /api/billing/plan/checkout — create (or re-use) a Razorpay subscription for the
 * chosen plan and return what Razorpay Checkout needs. Price is decided server-side.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { startCheckout } from '@/lib/billing/service'
import { checkoutStartSchema } from '@/lib/validations/practice-billing'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!
  const body = await parseJsonBody(req, checkoutStartSchema)

  const data = await startCheckout(organisationId, { fullName: user.fullName, email: user.email }, body)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'practice_subscription.checkout_started',
    resourceType: 'practice_subscription',
    resourceId: data.subscriptionId,
    ipHash,
    afterJson: { planId: body.planId, interval: body.interval, amount: data.amount },
  })

  return NextResponse.json(
    { success: true, data, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
