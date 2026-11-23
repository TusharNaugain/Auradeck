/**
 * Razorpay webhook processing for practice subscriptions.
 * The signed webhook is the source of truth: only events whose raw-body HMAC
 * matches RAZORPAY_WEBHOOK_SECRET change subscription state, and each event id
 * is processed once (replays are acknowledged and ignored).
 */

import crypto from 'node:crypto'
import { verifyWebhookSignature, type RazorpayPaymentEntity, type RazorpaySubscriptionEntity } from './razorpay'
import { applyRazorpaySubscription, type SubscriptionPatch, type SubscriptionState } from './state'

export interface StoredSubscription extends SubscriptionState {
  id: string
  organisationId: string
  razorpaySubscriptionId: string | null
  /** Expected charge in rupees, for the amount check. */
  amount: number | null
}

export interface PaymentRecord {
  organisationId: string
  subscriptionId: string
  razorpayPaymentId: string
  razorpayInvoiceId: string | null
  amount: number
  currency: string
  status: string
  method: string | null
  failureReason: string | null
  paidAt: Date | null
}

export type EventClaim = 'new' | 'duplicate' | 'retry'

export interface BillingStore {
  claimEvent(e: { eventId: string; eventType: string; razorpaySubscriptionId: string | null; payload: unknown }): Promise<EventClaim>
  finishEvent(eventId: string, status: 'processed' | 'ignored' | 'failed', fields: { organisationId?: string | null; error?: string | null }): Promise<void>
  findSubscriptionByRazorpayId(razorpaySubscriptionId: string): Promise<StoredSubscription | null>
  updateSubscription(id: string, patch: SubscriptionPatch): Promise<void>
  upsertPayment(payment: PaymentRecord): Promise<void>
}

const HANDLED_EVENTS = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.paused',
  'subscription.resumed',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.updated',
  'payment.failed',
])

interface WebhookBody {
  event?: string
  created_at?: number
  payload?: {
    subscription?: { entity?: RazorpaySubscriptionEntity }
    payment?: { entity?: RazorpayPaymentEntity & { subscription_id?: string | null } }
  }
}

function notesOrganisationId(notes: RazorpaySubscriptionEntity['notes']): string | null {
  if (!notes || Array.isArray(notes)) return null
  const value = (notes as Record<string, unknown>).organisationId
  return typeof value === 'string' && value ? value : null
}

export function paymentRecordFrom(
  sub: Pick<StoredSubscription, 'id' | 'organisationId'>,
  payment: RazorpayPaymentEntity
): PaymentRecord {
  const captured = payment.status === 'captured' || payment.status === 'authorized'
  return {
    organisationId: sub.organisationId,
    subscriptionId: sub.id,
    razorpayPaymentId: payment.id,
    razorpayInvoiceId: payment.invoice_id ?? null,
    amount: Math.round(Number(payment.amount ?? 0)) / 100,
    currency: payment.currency || 'INR',
    status: payment.status,
    method: payment.method ?? null,
    failureReason: payment.status === 'failed' ? (payment.error_description ?? 'Payment failed') : null,
    paidAt: captured && payment.created_at ? new Date(payment.created_at * 1000) : null,
  }
}

/**
 * Apply verified Razorpay data (from a webhook or a server-side API fetch) to a
 * stored subscription. Returns a note when something looked off.
 */
export async function syncSubscription(
  store: Pick<BillingStore, 'updateSubscription' | 'upsertPayment'>,
  record: StoredSubscription,
  data: { subscription?: RazorpaySubscriptionEntity | null; payment?: RazorpayPaymentEntity | null; eventAt: Date | null; now: Date }
): Promise<{ note: string | null }> {
  const notes: string[] = []
  if (data.subscription) {
    const owner = notesOrganisationId(data.subscription.notes)
    if (owner && owner !== record.organisationId) return { note: 'ownership_mismatch' }
    const { patch, skipped } = applyRazorpaySubscription(record, data.subscription, { eventAt: data.eventAt, now: data.now })
    if (skipped) notes.push(`status_${skipped}`)
    if (Object.keys(patch).length > 0) await store.updateSubscription(record.id, patch)
  }
  if (data.payment?.id) {
    const payment = paymentRecordFrom(record, data.payment)
    if (payment.status === 'captured' && record.amount != null && Math.abs(payment.amount - record.amount) > 0.01) {
      notes.push(`amount_mismatch: expected ${record.amount}, got ${payment.amount}`)
    }
    await store.upsertPayment(payment)
  }
  return { note: notes.length ? notes.join('; ') : null }
}

export type WebhookOutcome = 'invalid_signature' | 'bad_payload' | 'duplicate' | 'processed' | 'ignored' | 'failed'

export interface WebhookResult {
  status: number
  outcome: WebhookOutcome
  detail?: string
}

export async function processRazorpayWebhook(
  store: BillingStore,
  input: { rawBody: string; signature: string | null; eventId: string | null; webhookSecret: string; now?: Date }
): Promise<WebhookResult> {
  if (!verifyWebhookSignature(input.rawBody, input.signature, input.webhookSecret)) {
    return { status: 400, outcome: 'invalid_signature' }
  }

  let body: WebhookBody
  try {
    body = JSON.parse(input.rawBody) as WebhookBody
  } catch {
    return { status: 400, outcome: 'bad_payload' }
  }
  const eventType = typeof body.event === 'string' ? body.event : ''
  if (!eventType) return { status: 400, outcome: 'bad_payload' }

  const now = input.now ?? new Date()
  const subscription = body.payload?.subscription?.entity ?? null
  const payment = body.payload?.payment?.entity ?? null
  const razorpaySubscriptionId = subscription?.id ?? payment?.subscription_id ?? null
  // Razorpay sends a unique x-razorpay-event-id; fall back to a body hash so replays still dedupe.
  const eventId = input.eventId?.trim() || `body_${crypto.createHash('sha256').update(input.rawBody).digest('hex')}`

  const claim = await store.claimEvent({ eventId, eventType, razorpaySubscriptionId, payload: body })
  if (claim === 'duplicate') return { status: 200, outcome: 'duplicate' }

  try {
    if (!HANDLED_EVENTS.has(eventType)) {
      await store.finishEvent(eventId, 'ignored', { error: 'unhandled_event' })
      return { status: 200, outcome: 'ignored', detail: 'unhandled_event' }
    }
    if (!razorpaySubscriptionId) {
      await store.finishEvent(eventId, 'ignored', { error: 'no_subscription' })
      return { status: 200, outcome: 'ignored', detail: 'no_subscription' }
    }
    const record = await store.findSubscriptionByRazorpayId(razorpaySubscriptionId)
    if (!record) {
      await store.finishEvent(eventId, 'ignored', { error: 'unknown_subscription' })
      return { status: 200, outcome: 'ignored', detail: 'unknown_subscription' }
    }

    const eventAt = typeof body.created_at === 'number' ? new Date(body.created_at * 1000) : null
    const { note } = await syncSubscription(store, record, { subscription, payment, eventAt, now })
    if (note === 'ownership_mismatch') {
      await store.finishEvent(eventId, 'ignored', { organisationId: record.organisationId, error: note })
      return { status: 200, outcome: 'ignored', detail: note }
    }
    await store.finishEvent(eventId, 'processed', { organisationId: record.organisationId, error: note })
    return { status: 200, outcome: 'processed', detail: note ?? undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await store.finishEvent(eventId, 'failed', { error: message.slice(0, 500) }).catch(() => undefined)
    // Non-2xx makes Razorpay retry; a 'failed' event is re-claimable on retry.
    return { status: 500, outcome: 'failed' }
  }
}
