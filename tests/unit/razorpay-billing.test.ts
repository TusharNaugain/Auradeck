/**
 * Razorpay practice billing: signature checks, webhook processing (replays,
 * ordering, ownership, amount) and subscription status / access rules.
 */
import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRazorpayClient, verifySubscriptionPaymentSignature, verifyWebhookSignature } from '@/lib/billing/razorpay'
import {
  DAY_MS,
  GRACE_DAYS,
  applyRazorpaySubscription,
  canStartCheckout,
  entitlementFor,
  mapRazorpayStatus,
  shouldSendTrialReminder,
  type SubscriptionState,
} from '@/lib/billing/state'
import { processRazorpayWebhook, type BillingStore, type EventClaim, type PaymentRecord, type StoredSubscription } from '@/lib/billing/webhook'

const WEBHOOK_SECRET = 'whsec_test_only_value'
const KEY_SECRET = 'key_secret_test_only'
const NOW = new Date('2026-11-23T10:00:00Z')
const unix = (d: Date) => Math.floor(d.getTime() / 1000)
const hmac = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('hex')

/* ---------------- In-memory store ---------------- */

class MemoryStore implements BillingStore {
  events = new Map<string, { status: string; error?: string | null; organisationId?: string | null }>()
  subs = new Map<string, StoredSubscription>()
  payments = new Map<string, PaymentRecord>()
  failNextUpdate = false

  async claimEvent({ eventId }: { eventId: string }): Promise<EventClaim> {
    const existing = this.events.get(eventId)
    if (!existing) {
      this.events.set(eventId, { status: 'received' })
      return 'new'
    }
    if (existing.status === 'failed') {
      existing.status = 'received'
      return 'retry'
    }
    return 'duplicate'
  }
  async finishEvent(eventId: string, status: string, fields: { organisationId?: string | null; error?: string | null }) {
    this.events.set(eventId, { status, ...fields })
  }
  async findSubscriptionByRazorpayId(id: string) {
    return [...this.subs.values()].find(s => s.razorpaySubscriptionId === id) ?? null
  }
  async updateSubscription(id: string, patch: Partial<SubscriptionState>) {
    if (this.failNextUpdate) {
      this.failNextUpdate = false
      throw new Error('db down')
    }
    const sub = this.subs.get(id)!
    this.subs.set(id, { ...sub, ...patch })
  }
  async upsertPayment(p: PaymentRecord) {
    this.payments.set(p.razorpayPaymentId, { ...this.payments.get(p.razorpayPaymentId), ...p })
  }
}

function baseSub(over: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: 'ps_1',
    organisationId: 'org_1',
    razorpaySubscriptionId: 'sub_TEST123456',
    amount: 999,
    status: 'CREATED',
    trialEndsAt: new Date(NOW.getTime() + 5 * DAY_MS),
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    lastEventAt: null,
    razorpayCustomerId: null,
    ...over,
  }
}

const periodStart = new Date('2026-11-23T00:00:00Z')
const periodEnd = new Date('2026-12-23T00:00:00Z')

function event(type: string, opts: { status?: string; createdAt?: Date; payment?: Record<string, unknown> | null; subId?: string; notes?: Record<string, string> } = {}) {
  const body: Record<string, unknown> = {
    entity: 'event',
    event: type,
    created_at: unix(opts.createdAt ?? NOW),
    payload: {
      subscription: {
        entity: {
          id: opts.subId ?? 'sub_TEST123456',
          plan_id: 'plan_TEST',
          customer_id: 'cust_TEST',
          status: opts.status ?? 'active',
          current_start: unix(periodStart),
          current_end: unix(periodEnd),
          notes: opts.notes ?? { organisationId: 'org_1' },
        },
      },
      ...(opts.payment === null
        ? {}
        : opts.payment
          ? { payment: { entity: opts.payment } }
          : {}),
    },
  }
  return JSON.stringify(body)
}

const capturedPayment = (over: Record<string, unknown> = {}) => ({
  id: 'pay_TEST000001', amount: 99900, currency: 'INR', status: 'captured', method: 'upi', invoice_id: 'inv_TEST', created_at: unix(NOW), ...over,
})

async function deliver(store: MemoryStore, rawBody: string, eventId: string = crypto.randomUUID(), signature = hmac(WEBHOOK_SECRET, rawBody)) {
  return processRazorpayWebhook(store, { rawBody, signature, eventId, webhookSecret: WEBHOOK_SECRET, now: NOW })
}

/* ---------------- Signatures ---------------- */

describe('signature verification', () => {
  it('accepts a correct checkout signature over payment_id|subscription_id', () => {
    const signature = hmac(KEY_SECRET, 'pay_ABC123456|sub_XYZ123456')
    expect(verifySubscriptionPaymentSignature({ paymentId: 'pay_ABC123456', subscriptionId: 'sub_XYZ123456', signature }, KEY_SECRET)).toBe(true)
  })

  it('rejects a checkout signature for another subscription, a wrong secret or garbage', () => {
    const signature = hmac(KEY_SECRET, 'pay_ABC123456|sub_XYZ123456')
    expect(verifySubscriptionPaymentSignature({ paymentId: 'pay_ABC123456', subscriptionId: 'sub_OTHER12345', signature }, KEY_SECRET)).toBe(false)
    expect(verifySubscriptionPaymentSignature({ paymentId: 'pay_ABC123456', subscriptionId: 'sub_XYZ123456', signature }, 'other')).toBe(false)
    expect(verifySubscriptionPaymentSignature({ paymentId: 'pay_ABC123456', subscriptionId: 'sub_XYZ123456', signature: 'abc' }, KEY_SECRET)).toBe(false)
    expect(verifySubscriptionPaymentSignature({ paymentId: '', subscriptionId: 'sub_XYZ123456', signature }, KEY_SECRET)).toBe(false)
  })

  it('verifies the webhook HMAC over the exact raw body', () => {
    const raw = '{"event":"subscription.activated"}'
    expect(verifyWebhookSignature(raw, hmac(WEBHOOK_SECRET, raw), WEBHOOK_SECRET)).toBe(true)
    // Re-serialised JSON (different whitespace) must not pass.
    expect(verifyWebhookSignature('{ "event": "subscription.activated" }', hmac(WEBHOOK_SECRET, raw), WEBHOOK_SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw, null, WEBHOOK_SECRET)).toBe(false)
    expect(verifyWebhookSignature(raw, hmac(WEBHOOK_SECRET, raw), '')).toBe(false)
  })
})

/* ---------------- Status rules ---------------- */

describe('status mapping and transitions', () => {
  it('maps every Razorpay subscription status', () => {
    expect(mapRazorpayStatus('created')).toBe('CREATED')
    expect(mapRazorpayStatus('authenticated')).toBe('AUTHENTICATED')
    expect(mapRazorpayStatus('active')).toBe('ACTIVE')
    expect(mapRazorpayStatus('pending')).toBe('PAST_DUE')
    expect(mapRazorpayStatus('halted')).toBe('HALTED')
    expect(mapRazorpayStatus('cancelled')).toBe('CANCELLED')
    expect(mapRazorpayStatus('completed')).toBe('COMPLETED')
    expect(mapRazorpayStatus('expired')).toBe('EXPIRED')
    expect(mapRazorpayStatus('weird')).toBeNull()
  })

  it('activating sets the billing period and clears any grace period', () => {
    const { patch } = applyRazorpaySubscription(baseSub({ status: 'PAST_DUE', graceUntil: NOW }), {
      status: 'active', current_start: unix(periodStart), current_end: unix(periodEnd), customer_id: 'cust_1',
    }, { eventAt: NOW, now: NOW })
    expect(patch).toMatchObject({ status: 'ACTIVE', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd, graceUntil: null, razorpayCustomerId: 'cust_1' })
  })

  it('a failed renewal starts a 7-day grace period once', () => {
    const first = applyRazorpaySubscription(baseSub({ status: 'ACTIVE' }), { status: 'pending' }, { eventAt: NOW, now: NOW })
    expect(first.patch.status).toBe('PAST_DUE')
    expect(first.patch.graceUntil).toEqual(new Date(NOW.getTime() + GRACE_DAYS * DAY_MS))
    const again = applyRazorpaySubscription(baseSub({ status: 'PAST_DUE', graceUntil: first.patch.graceUntil! }), { status: 'pending' }, { eventAt: NOW, now: new Date(NOW.getTime() + DAY_MS) })
    expect(again.patch.graceUntil).toBeUndefined()
  })

  it('ignores status from older events and never revives a cancelled subscription', () => {
    const stale = applyRazorpaySubscription(baseSub({ status: 'ACTIVE', lastEventAt: NOW }), { status: 'pending' }, { eventAt: new Date(NOW.getTime() - 1000), now: NOW })
    expect(stale.skipped).toBe('stale')
    expect(stale.patch.status).toBeUndefined()
    const revived = applyRazorpaySubscription(baseSub({ status: 'CANCELLED' }), { status: 'active' }, { eventAt: NOW, now: NOW })
    expect(revived.skipped).toBe('terminal')
    expect(revived.patch.status).toBeUndefined()
  })

  it('only lets a practice check out when it has no live plan', () => {
    for (const s of ['TRIAL', 'CREATED', 'HALTED', 'CANCELLED', 'EXPIRED', 'COMPLETED'] as const) expect(canStartCheckout(s)).toBe(true)
    for (const s of ['ACTIVE', 'AUTHENTICATED', 'PAST_DUE'] as const) expect(canStartCheckout(s)).toBe(false)
  })
})

describe('feature access', () => {
  const later = (days: number) => new Date(NOW.getTime() + days * DAY_MS)
  const at = (over: Partial<SubscriptionState>) => entitlementFor({ status: 'TRIAL', trialEndsAt: null, currentPeriodEnd: null, graceUntil: null, ...over }, NOW)

  it('trial gives access until it ends, then read-only', () => {
    expect(at({ trialEndsAt: later(3) })).toMatchObject({ hasAccess: true, reason: 'trial' })
    expect(at({ trialEndsAt: later(-1) })).toMatchObject({ hasAccess: false, reason: 'trial_expired' })
    // Starting checkout keeps the remaining trial.
    expect(at({ status: 'CREATED', trialEndsAt: later(2) })).toMatchObject({ hasAccess: true, reason: 'trial' })
  })

  it('active and authenticated plans have access', () => {
    expect(at({ status: 'ACTIVE', currentPeriodEnd: later(30) })).toMatchObject({ hasAccess: true, reason: 'active' })
    expect(at({ status: 'AUTHENTICATED' }).hasAccess).toBe(true)
  })

  it('past due keeps access during grace only; halted has none', () => {
    expect(at({ status: 'PAST_DUE', graceUntil: later(2) })).toMatchObject({ hasAccess: true, reason: 'grace' })
    expect(at({ status: 'PAST_DUE', graceUntil: later(-1) })).toMatchObject({ hasAccess: false, reason: 'payment_failed' })
    expect(at({ status: 'HALTED' })).toMatchObject({ hasAccess: false, reason: 'payment_failed' })
  })

  it('cancelled plans keep access until the paid period ends', () => {
    expect(at({ status: 'CANCELLED', currentPeriodEnd: later(10) })).toMatchObject({ hasAccess: true, reason: 'paid_period' })
    expect(at({ status: 'CANCELLED', currentPeriodEnd: later(-1) })).toMatchObject({ hasAccess: false, reason: 'ended' })
  })

  it('sends the trial reminder once, within 3 days of the trial ending', () => {
    const base = { status: 'TRIAL' as const, trialReminderSentAt: null }
    expect(shouldSendTrialReminder({ ...base, trialEndsAt: later(2) }, NOW)).toBe(true)
    expect(shouldSendTrialReminder({ ...base, trialEndsAt: later(5) }, NOW)).toBe(false)
    expect(shouldSendTrialReminder({ ...base, trialEndsAt: later(-1) }, NOW)).toBe(false)
    expect(shouldSendTrialReminder({ ...base, trialEndsAt: later(2), trialReminderSentAt: NOW }, NOW)).toBe(false)
    expect(shouldSendTrialReminder({ status: 'ACTIVE', trialEndsAt: later(2), trialReminderSentAt: null }, NOW)).toBe(false)
  })
})

/* ---------------- Webhook processing ---------------- */

describe('Razorpay webhook', () => {
  let store: MemoryStore
  beforeEach(() => {
    store = new MemoryStore()
    store.subs.set('ps_1', baseSub())
  })

  it('rejects an unsigned or tampered event without touching state', async () => {
    const raw = event('subscription.activated')
    expect((await deliver(store, raw, 'evt_1', 'bad')).status).toBe(400)
    const tampered = raw.replace('"active"', '"cancelled"')
    expect((await deliver(store, tampered, 'evt_2', hmac(WEBHOOK_SECRET, raw))).outcome).toBe('invalid_signature')
    expect(store.events.size).toBe(0)
    expect(store.subs.get('ps_1')!.status).toBe('CREATED')
  })

  it('activates the subscription and records the payment on subscription.charged', async () => {
    const res = await deliver(store, event('subscription.charged', { payment: capturedPayment() }), 'evt_charged')
    expect(res).toMatchObject({ status: 200, outcome: 'processed' })
    const sub = store.subs.get('ps_1')!
    expect(sub).toMatchObject({ status: 'ACTIVE', currentPeriodEnd: periodEnd, razorpayCustomerId: 'cust_TEST' })
    expect(store.payments.get('pay_TEST000001')).toMatchObject({ amount: 999, status: 'captured', method: 'upi', organisationId: 'org_1', subscriptionId: 'ps_1' })
    expect(entitlementFor(sub, NOW).hasAccess).toBe(true)
  })

  it('treats a replayed event id as a no-op', async () => {
    const raw = event('subscription.charged', { payment: capturedPayment() })
    await deliver(store, raw, 'evt_same')
    store.subs.set('ps_1', { ...store.subs.get('ps_1')!, status: 'CANCELLED' })
    const replay = await deliver(store, raw, 'evt_same')
    expect(replay).toMatchObject({ status: 200, outcome: 'duplicate' })
    expect(store.subs.get('ps_1')!.status).toBe('CANCELLED')
  })

  it('dedupes by body hash when the event id header is missing', async () => {
    const raw = event('subscription.activated')
    const a = await processRazorpayWebhook(store, { rawBody: raw, signature: hmac(WEBHOOK_SECRET, raw), eventId: null, webhookSecret: WEBHOOK_SECRET, now: NOW })
    const b = await processRazorpayWebhook(store, { rawBody: raw, signature: hmac(WEBHOOK_SECRET, raw), eventId: null, webhookSecret: WEBHOOK_SECRET, now: NOW })
    expect(a.outcome).toBe('processed')
    expect(b.outcome).toBe('duplicate')
  })

  it('ignores an older event that arrives after a newer one', async () => {
    await deliver(store, event('subscription.activated', { createdAt: NOW }))
    const late = await deliver(store, event('subscription.authenticated', { status: 'authenticated', createdAt: new Date(NOW.getTime() - 60_000) }))
    expect(late.outcome).toBe('processed')
    expect(store.subs.get('ps_1')!.status).toBe('ACTIVE')
  })

  it('moves through pending → halted → cancelled on failed renewals', async () => {
    const t = (min: number) => new Date(NOW.getTime() + min * 60_000)
    // Trial already used up, so access depends only on the paid plan.
    store.subs.set('ps_1', baseSub({ trialEndsAt: new Date(NOW.getTime() - DAY_MS) }))
    await deliver(store, event('subscription.activated', { createdAt: t(0) }))
    await deliver(store, event('payment.failed', { status: 'active', createdAt: t(1), payment: capturedPayment({ id: 'pay_FAIL000001', status: 'failed', error_description: 'Card declined' }) }))
    expect(store.payments.get('pay_FAIL000001')).toMatchObject({ status: 'failed', failureReason: 'Card declined', paidAt: null })
    await deliver(store, event('subscription.pending', { status: 'pending', createdAt: t(2) }))
    expect(store.subs.get('ps_1')).toMatchObject({ status: 'PAST_DUE' })
    expect(store.subs.get('ps_1')!.graceUntil).not.toBeNull()
    await deliver(store, event('subscription.halted', { status: 'halted', createdAt: t(3) }))
    expect(entitlementFor(store.subs.get('ps_1')!, NOW)).toMatchObject({ hasAccess: false, reason: 'payment_failed' })
    await deliver(store, event('subscription.cancelled', { status: 'cancelled', createdAt: t(4) }))
    expect(store.subs.get('ps_1')!.status).toBe('CANCELLED')
    expect(store.subs.get('ps_1')!.cancelledAt).toEqual(NOW)
  })

  it('ignores events for unknown subscriptions or another practice', async () => {
    expect((await deliver(store, event('subscription.activated', { subId: 'sub_UNKNOWN0001' }))).detail).toBe('unknown_subscription')
    const wrongOwner = await deliver(store, event('subscription.activated', { notes: { organisationId: 'org_evil' } }))
    expect(wrongOwner).toMatchObject({ status: 200, outcome: 'ignored', detail: 'ownership_mismatch' })
    expect(store.subs.get('ps_1')!.status).toBe('CREATED')
  })

  it('acknowledges unrelated events without processing them', async () => {
    const res = await deliver(store, JSON.stringify({ event: 'order.paid', payload: {} }))
    expect(res).toMatchObject({ status: 200, outcome: 'ignored', detail: 'unhandled_event' })
  })

  it('flags a captured amount that differs from the plan price but still records it', async () => {
    const res = await deliver(store, event('subscription.charged', { payment: capturedPayment({ amount: 100 }) }))
    expect(res.detail).toContain('amount_mismatch')
    expect(store.payments.get('pay_TEST000001')!.amount).toBe(1)
  })

  it('returns 500 on a processing error so Razorpay retries, and the retry succeeds', async () => {
    const raw = event('subscription.activated')
    store.failNextUpdate = true
    const first = await deliver(store, raw, 'evt_retry')
    expect(first).toMatchObject({ status: 500, outcome: 'failed' })
    expect(store.events.get('evt_retry')!.status).toBe('failed')
    const second = await deliver(store, raw, 'evt_retry')
    expect(second.outcome).toBe('processed')
    expect(store.subs.get('ps_1')!.status).toBe('ACTIVE')
  })

  it('rejects a signed body that is not valid JSON or has no event', async () => {
    expect((await deliver(store, 'not json')).outcome).toBe('bad_payload')
    expect((await deliver(store, '{}')).outcome).toBe('bad_payload')
  })
})

/* ---------------- REST client ---------------- */

describe('Razorpay REST client', () => {
  it('sends Basic auth from the key pair and maps errors to ProviderError', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      if (url.endsWith('/subscriptions')) return new Response(JSON.stringify({ id: 'sub_NEW1234567', status: 'created', plan_id: 'plan_1' }), { status: 200 })
      return new Response(JSON.stringify({ error: { description: 'Bad plan' } }), { status: 400 })
    }
    const client = createRazorpayClient({ keyId: 'rzp_test_abc', keySecret: 'shh', mode: 'test' }, fetchImpl)
    const sub = await client.createSubscription({ planId: 'plan_1', totalCount: 120, notes: { organisationId: 'org_1' } })
    expect(sub.id).toBe('sub_NEW1234567')
    const headers = calls[0].init!.headers as Record<string, string>
    expect(headers.authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:shh').toString('base64')}`)
    expect(JSON.parse(String(calls[0].init!.body))).toMatchObject({ plan_id: 'plan_1', total_count: 120, quantity: 1 })
    await expect(client.fetchSubscription('sub_x')).rejects.toThrow('Razorpay request failed: Bad plan')
  })
})
