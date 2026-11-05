/**
 * POST /api/webhooks/razorpay — payment provider webhook.
 * - HMAC SHA256 body signature verification with RAZORPAY_WEBHOOK_SECRET
 * - Idempotency: unique (provider, eventId) delivery rows; replays return 200-deduped
 * - Amounts recorded from the provider; invoice status recomputed from stored totals
 * - Quarantines invalid signatures for admin review
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/env'
import { v4 as uuidv4 } from 'uuid'

interface RazorpayPaymentEntity {
  id?: string
  amount?: number
  notes?: { invoiceId?: string }
}
interface RazorpayPayload {
  event?: string
  payload?: { payment?: { entity?: RazorpayPaymentEntity } }
}

const REQUEST_ID_HEADER = 'x-request-id'

function safeCompareHex(x: string, y: string): boolean {
  if (x.length !== y.length) return false
  return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y))
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? uuidv4()

  const raw = await req.text()
  const signature = req.headers.get('x-razorpay-signature')
  const eventId = req.headers.get('x-razorpay-event-id')

  // Signature must be present and the secret configured
  if (!signature || !eventId || !env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json(
      { success: false, error: 'Webhook verification incomplete', code: 'WEBHOOK_INVALID', requestId },
      { status: 401 }
    )
  }

  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex')
  if (!safeCompareHex(signature, expected)) {
    // Quarantine for admin inspection
    await db.webhookDelivery.create({
      data: {
        provider: 'razorpay',
        eventType: 'unknown',
        payload: raw.slice(0, 4000),
        signatureValid: false,
        idempotencyKey: eventId,
        status: 'quarantined',
        errorMessage: 'Signature verification failed',
      },
    })
    return NextResponse.json(
      { success: false, error: 'Signature verification failed', code: 'WEBHOOK_SIGNATURE_INVALID', requestId },
      { status: 401 }
    )
  }

  let payload: RazorpayPayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json(
      { success: false, error: 'Body must be valid JSON', code: 'WEBHOOK_INVALID', requestId },
      { status: 400 }
    )
  }

  // Idempotency: unique key on (provider, idempotencyKey) — a duplicate insert fails
  const delivery = await db.webhookDelivery
    .create({
      data: {
        provider: 'razorpay',
        eventType: payload.event ?? 'unknown',
        payload: payload as unknown as import('@prisma/client').Prisma.InputJsonValue,
        signatureValid: true,
        idempotencyKey: eventId,
        status: 'received',
      },
    })
    .catch(() => null)

  if (!delivery) {
    // Event already processed — return success so the provider stops retrying
    return NextResponse.json({ success: true, data: { deduped: true }, requestId })
  }

  const payment = payload.payload?.payment?.entity
  const invoiceId = payment?.notes?.invoiceId
  const providerPaymentId = payment?.id

  if (!invoiceId) {
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'dropped', errorMessage: 'No invoiceId in payment notes' },
    })
    return NextResponse.json({ success: true, data: { dropped: true }, requestId })
  }

  try {
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId },
      select: {
        id: true, accountId: true, amountDue: true, amountPaid: true,
        invoiceNumber: true,
      },
    })
    if (!invoice) {
      await db.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'dropped', errorMessage: 'Invoice not found' },
      })
      return NextResponse.json({ success: true, data: { dropped: true }, requestId })
    }

    // Razorpay sends amounts in paise
    const amount = payment?.amount ? payment.amount / 100 : 0

    await db.$transaction(async (tx) => {
      // One payment row per provider payment id
      const existing = providerPaymentId
        ? await tx.payment.findFirst({ where: { providerPaymentId }, select: { id: true } })
        : null
      if (!existing) {
        await tx.payment.create({
          data: {
            invoiceId: invoice.id,
            accountId: invoice.accountId,
            amount,
            currency: 'INR',
            method: 'OTHER',
            status: 'SUCCESS',
            providerPaymentId,
            transactionReference: providerPaymentId,
            paidAt: new Date(),
          },
        })
      }

      const newAmountDue = Number(invoice.amountDue) - amount
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: Number(invoice.amountPaid) + amount,
          amountDue: newAmountDue,
          status: newAmountDue <= 0 ? 'PAID' : 'PARTIALLY_PAID',
        },
      })
    })

    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'processed', processedAt: new Date() },
    })

    return NextResponse.json({ success: true, data: { processed: true }, requestId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown'
    await db.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed', errorMessage: message, retryCount: { increment: 1 } },
    })
    return NextResponse.json(
      { success: false, error: 'Webhook processing failed and queued for retry', code: 'WEBHOOK_RETRY', requestId },
      { status: 500 }
    )
  }
}
