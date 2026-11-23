/**
 * POST /api/billing/plan/checkout/verify — Razorpay Checkout success callback.
 * Verifies HMAC-SHA256(payment_id|subscription_id) with the key secret, then refreshes
 * status from Razorpay's API on the server. The browser never sets the status.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { verifyCheckout } from '@/lib/billing/service'
import { checkoutVerifySchema } from '@/lib/validations/practice-billing'
import { v4 as uuidv4 } from 'uuid'

export const dynamic = 'force-dynamic'

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!
  const body = await parseJsonBody(req, checkoutVerifySchema)

  const data = await verifyCheckout(organisationId, body)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'practice_subscription.checkout_verified',
    resourceType: 'practice_subscription',
    resourceId: body.razorpaySubscriptionId,
    ipHash,
    afterJson: { paymentId: body.razorpayPaymentId, status: data.subscription.status },
  })

  return NextResponse.json(
    { success: true, data, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
