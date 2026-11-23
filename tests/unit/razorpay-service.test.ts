/**
 * Practice billing service: server-side pricing and ownership on checkout,
 * signature checks on verify, and read-only blocking of lapsed practices.
 */
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  organisation: { findUnique: vi.fn() },
  plan: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  practiceSubscription: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  practicePayment: { upsert: vi.fn(), findMany: vi.fn() },
  billingEvent: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { billingAccessBlocked, startCheckout, verifyCheckout } from '@/lib/billing/service'
import type { RazorpayClient } from '@/lib/billing/razorpay'

const NOW = new Date('2026-11-23T10:00:00Z')
const KEY_SECRET = 'test_key_secret_value'
const plan = {
  id: 'plan_auradeck_pro', name: 'Auradeck Pro', description: null, monthlyPrice: 999, annualPrice: 9990,
  currency: 'INR', razorpayPlanIds: { 'test:monthly': 'plan_RZPMONTH' }, isActive: true, isSelfServe: true, trialDays: 14,
}
const trialRow = (over: Record<string, unknown> = {}) => ({
  id: 'ps_1', organisationId: 'org_1', status: 'TRIAL', planId: plan.id, billingInterval: null, amount: null, currency: 'INR',
  trialEndsAt: new Date(NOW.getTime() + 5 * 86400000), currentPeriodStart: null, currentPeriodEnd: null, graceUntil: null,
  cancelAtPeriodEnd: false, cancelledAt: null, razorpaySubscriptionId: null, razorpayCustomerId: null, razorpayPlanId: null,
  checkoutShortUrl: null, lastEventAt: null, trialReminderSentAt: null, createdAt: NOW, updatedAt: NOW, ...over,
})

function fakeClient(over: Partial<RazorpayClient> = {}): RazorpayClient {
  return {
    createPlan: vi.fn(async () => ({ id: 'plan_RZPNEW' })),
    createSubscription: vi.fn(async () => ({ id: 'sub_NEW1234567', status: 'created', plan_id: 'plan_RZPMONTH', short_url: 'https://rzp.io/x' })),
    fetchSubscription: vi.fn(async () => ({ id: 'sub_NEW1234567', status: 'active', plan_id: 'plan_RZPMONTH', current_start: 1, current_end: 2 })),
    fetchPayment: vi.fn(async () => ({ id: 'pay_ABC1234567', amount: 99900, currency: 'INR', status: 'captured', method: 'card' })),
    cancelSubscription: vi.fn(),
    ...over,
  } as RazorpayClient
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('BILLING_RAZORPAY_ENABLED', 'true')
  vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_dummy')
  vi.stubEnv('RAZORPAY_KEY_SECRET', KEY_SECRET)
  db.organisation.findUnique.mockResolvedValue({ id: 'org_1', type: 'CUSTOMER_PRACTICE', displayName: 'Calm Minds', primaryEmail: 'a@b.test', primaryPhone: null })
  db.plan.findFirst.mockResolvedValue(plan)
  db.plan.findMany.mockResolvedValue([plan])
  db.practiceSubscription.findUnique.mockResolvedValue(trialRow())
  db.practiceSubscription.findUniqueOrThrow.mockImplementation(async () => trialRow({ status: 'ACTIVE', razorpaySubscriptionId: 'sub_NEW1234567', plan }))
})
afterEach(() => vi.unstubAllEnvs())

describe('startCheckout', () => {
  it('prices the subscription on the server from the plan and stores the Razorpay id', async () => {
    const client = fakeClient()
    const res = await startCheckout('org_1', { fullName: 'Asha', email: 'asha@x.test' }, { planId: plan.id, interval: 'monthly' }, { client, now: NOW })
    expect(res).toMatchObject({ keyId: 'rzp_test_dummy', subscriptionId: 'sub_NEW1234567', amount: 999, mode: 'test' })
    expect(client.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'plan_RZPMONTH', totalCount: 120, notes: expect.objectContaining({ organisationId: 'org_1' }),
    }))
    expect(db.practiceSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CREATED', amount: 999, razorpaySubscriptionId: 'sub_NEW1234567', billingInterval: 'monthly' }),
    }))
    // The secret is never returned to the browser.
    expect(JSON.stringify(res)).not.toContain(KEY_SECRET)
  })

  it('creates the Razorpay plan once per mode + interval', async () => {
    const client = fakeClient()
    await startCheckout('org_1', { email: 'a@x.test' }, { planId: plan.id, interval: 'annual' }, { client, now: NOW })
    expect(client.createPlan).toHaveBeenCalledWith(expect.objectContaining({ period: 'yearly', amountPaise: 999000 }))
    expect(db.plan.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { razorpayPlanIds: { 'test:monthly': 'plan_RZPMONTH', 'test:annual': 'plan_RZPNEW' } },
    }))
  })

  it('refuses when already subscribed, for the internal workspace, or with billing off', async () => {
    db.practiceSubscription.findUnique.mockResolvedValueOnce(trialRow({ status: 'ACTIVE' }))
    await expect(startCheckout('org_1', { email: 'a@x.test' }, { planId: plan.id, interval: 'monthly' }, { client: fakeClient() })).rejects.toThrow('already has an active plan')

    db.organisation.findUnique.mockResolvedValueOnce({ id: 'org_1', type: 'AURADESK_INTERNAL', displayName: 'x', primaryEmail: 'x', primaryPhone: null })
    await expect(startCheckout('org_1', { email: 'a@x.test' }, { planId: plan.id, interval: 'monthly' }, { client: fakeClient() })).rejects.toThrow('only for therapist practices')

    vi.stubEnv('BILLING_RAZORPAY_ENABLED', 'false')
    await expect(startCheckout('org_1', { email: 'a@x.test' }, { planId: plan.id, interval: 'monthly' }, { client: fakeClient() })).rejects.toThrow('not available yet')
  })
})

describe('verifyCheckout', () => {
  const sign = (p: string, s: string) => crypto.createHmac('sha256', KEY_SECRET).update(`${p}|${s}`).digest('hex')

  beforeEach(() => {
    db.practiceSubscription.findUnique.mockResolvedValue(trialRow({ status: 'CREATED', razorpaySubscriptionId: 'sub_NEW1234567', amount: 999 }))
  })

  it('verifies the signature, then applies status fetched from Razorpay', async () => {
    const client = fakeClient()
    const res = await verifyCheckout('org_1', {
      razorpayPaymentId: 'pay_ABC1234567', razorpaySubscriptionId: 'sub_NEW1234567', razorpaySignature: sign('pay_ABC1234567', 'sub_NEW1234567'),
    }, { client, now: NOW })
    expect(res.verified).toBe(true)
    expect(res.refreshed).toBe(true)
    expect(db.practiceSubscription.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }))
    expect(db.practicePayment.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ razorpayPaymentId: 'pay_ABC1234567', amount: 999, status: 'captured' }) }))
  })

  it('rejects a forged signature without calling Razorpay or changing state', async () => {
    const client = fakeClient()
    await expect(verifyCheckout('org_1', {
      razorpayPaymentId: 'pay_ABC1234567', razorpaySubscriptionId: 'sub_NEW1234567', razorpaySignature: 'f'.repeat(64),
    }, { client })).rejects.toThrow('could not be verified')
    expect(client.fetchSubscription).not.toHaveBeenCalled()
    expect(db.practiceSubscription.update).not.toHaveBeenCalled()
  })

  it("rejects another practice's subscription id", async () => {
    await expect(verifyCheckout('org_1', {
      razorpayPaymentId: 'pay_ABC1234567', razorpaySubscriptionId: 'sub_OTHER12345', razorpaySignature: sign('pay_ABC1234567', 'sub_OTHER12345'),
    }, { client: fakeClient() })).rejects.toThrow('Subscription not found')
  })

  it('still reports verified when the Razorpay refresh fails (webhook will confirm)', async () => {
    const client = fakeClient({ fetchSubscription: vi.fn(async () => { throw new Error('timeout') }) as RazorpayClient['fetchSubscription'] })
    const res = await verifyCheckout('org_1', {
      razorpayPaymentId: 'pay_ABC1234567', razorpaySubscriptionId: 'sub_NEW1234567', razorpaySignature: sign('pay_ABC1234567', 'sub_NEW1234567'),
    }, { client, now: NOW })
    expect(res).toMatchObject({ verified: true, refreshed: false })
    expect(db.practiceSubscription.update).not.toHaveBeenCalled()
  })
})

describe('billingAccessBlocked', () => {
  it('blocks a practice whose trial ended, never the internal workspace, and nothing when billing is off', async () => {
    db.organisation.findUnique.mockResolvedValueOnce({ type: 'CUSTOMER_PRACTICE', practiceSubscription: trialRow({ trialEndsAt: new Date(NOW.getTime() - 1000) }) })
    expect(await billingAccessBlocked('org_1', NOW)).toBe(true)

    db.organisation.findUnique.mockResolvedValueOnce({ type: 'CUSTOMER_PRACTICE', practiceSubscription: trialRow() })
    expect(await billingAccessBlocked('org_1', NOW)).toBe(false)

    // First activity after billing is switched on starts a fresh trial instead of blocking.
    db.organisation.findUnique.mockResolvedValueOnce({ type: 'CUSTOMER_PRACTICE', practiceSubscription: null })
    db.practiceSubscription.findUnique.mockResolvedValueOnce(null)
    db.practiceSubscription.create.mockResolvedValueOnce(trialRow({ trialEndsAt: new Date(NOW.getTime() + 14 * 86400000) }))
    expect(await billingAccessBlocked('org_1', NOW)).toBe(false)
    expect(db.practiceSubscription.create).toHaveBeenCalledWith({ data: expect.objectContaining({ organisationId: 'org_1', status: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + 14 * 86400000) }) })

    db.organisation.findUnique.mockResolvedValueOnce({ type: 'AURADESK_INTERNAL', practiceSubscription: null })
    expect(await billingAccessBlocked('org_1', NOW)).toBe(false)

    vi.stubEnv('BILLING_RAZORPAY_ENABLED', 'false')
    db.organisation.findUnique.mockClear()
    expect(await billingAccessBlocked('org_1', NOW)).toBe(false)
    expect(db.organisation.findUnique).not.toHaveBeenCalled()
  })
})
