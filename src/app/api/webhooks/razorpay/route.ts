/**
 * POST /api/webhooks/razorpay — Razorpay subscription + payment events.
 * Public (no cookie): authenticity comes from X-Razorpay-Signature over the raw body.
 * Configure in Razorpay Dashboard → Webhooks with RAZORPAY_WEBHOOK_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processRazorpayWebhook } from '@/lib/billing/webhook'
import { createPrismaBillingStore } from '@/lib/billing/prisma-store'
import { logger } from '@/lib/utils/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 256 * 1024

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  if (!secret) {
    logger.error('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set')
    return NextResponse.json({ success: false, code: 'NOT_CONFIGURED' }, { status: 503 })
  }

  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 })
  }

  const result = await processRazorpayWebhook(createPrismaBillingStore(), {
    rawBody,
    signature: req.headers.get('x-razorpay-signature'),
    eventId: req.headers.get('x-razorpay-event-id'),
    webhookSecret: secret,
  })

  if (result.outcome === 'invalid_signature') logger.warn('Rejected Razorpay webhook with an invalid signature')
  if (result.outcome === 'failed') logger.error('Razorpay webhook processing failed; Razorpay will retry')

  return NextResponse.json({ success: result.status < 400, outcome: result.outcome }, { status: result.status })
}
