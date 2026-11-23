/**
 * Server-only Razorpay client for Auradeck's own subscription revenue.
 * Keys come only from the environment and never reach the browser — except the
 * public Key ID, which Razorpay Checkout needs.
 *
 * Docs: https://razorpay.com/docs/payments/subscriptions/
 */

import crypto from 'node:crypto'
import { ProviderError, ValidationFailedError } from '@/lib/services/errors'

const API_BASE = 'https://api.razorpay.com/v1'

export interface RazorpayConfig {
  keyId: string
  keySecret: string
  webhookSecret?: string
  mode: 'test' | 'live'
}

/** True when the Razorpay subscription flow is switched on for this deployment. */
export function billingEnabled(): boolean {
  return process.env.BILLING_RAZORPAY_ENABLED === 'true'
}

export function razorpayConfig(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) return null
  return {
    keyId,
    keySecret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET?.trim() || undefined,
    mode: keyId.startsWith('rzp_live_') ? 'live' : 'test',
  }
}

export function requireRazorpayConfig(): RazorpayConfig {
  const config = razorpayConfig()
  if (!config) throw new ValidationFailedError('Online payments are not configured yet. Please contact Auradeck support.')
  return config
}

/* ---------------- Signatures (HMAC-SHA256) ---------------- */

function hmacHex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data, 'utf8').digest('hex')
}

function safeEqualHex(expected: string, received: string): boolean {
  if (!received || expected.length !== received.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Checkout success for a subscription: signature = HMAC_SHA256(payment_id + "|" + subscription_id, key_secret).
 */
export function verifySubscriptionPaymentSignature(
  input: { paymentId: string; subscriptionId: string; signature: string },
  keySecret: string
): boolean {
  if (!input.paymentId || !input.subscriptionId || !keySecret) return false
  const expected = hmacHex(keySecret, `${input.paymentId}|${input.subscriptionId}`)
  return safeEqualHex(expected, input.signature.trim())
}

/** Webhook: X-Razorpay-Signature = HMAC_SHA256(raw request body, webhook_secret). */
export function verifyWebhookSignature(rawBody: string, signature: string | null | undefined, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false
  return safeEqualHex(hmacHex(webhookSecret, rawBody), signature.trim())
}

/* ---------------- REST client ---------------- */

export interface RazorpaySubscriptionEntity {
  id: string
  entity?: 'subscription'
  plan_id: string
  customer_id?: string | null
  status: string
  current_start?: number | null
  current_end?: number | null
  ended_at?: number | null
  charge_at?: number | null
  start_at?: number | null
  paid_count?: number
  short_url?: string | null
  notes?: Record<string, string> | unknown[] | null
}

export interface RazorpayPaymentEntity {
  id: string
  entity?: 'payment'
  amount: number
  currency: string
  status: string
  method?: string | null
  invoice_id?: string | null
  error_description?: string | null
  created_at?: number
}

export interface RazorpayPlanEntity {
  id: string
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function createRazorpayClient(config: RazorpayConfig, fetchImpl: FetchLike = fetch) {
  const auth = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        method,
        headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      })
    } catch {
      throw new ProviderError('Razorpay', 'network error')
    }
    const json = (await res.json().catch(() => null)) as { error?: { description?: string } } | null
    if (!res.ok) throw new ProviderError('Razorpay', json?.error?.description ?? `HTTP ${res.status}`)
    return json as T
  }

  return {
    createPlan: (input: { period: 'monthly' | 'yearly'; amountPaise: number; currency: string; name: string; description?: string; notes?: Record<string, string> }) =>
      call<RazorpayPlanEntity>('POST', '/plans', {
        period: input.period,
        interval: 1,
        item: { name: input.name, amount: input.amountPaise, currency: input.currency, description: input.description },
        notes: input.notes,
      }),
    createSubscription: (input: { planId: string; totalCount: number; notes: Record<string, string> }) =>
      call<RazorpaySubscriptionEntity>('POST', '/subscriptions', {
        plan_id: input.planId,
        total_count: input.totalCount,
        quantity: 1,
        customer_notify: 1,
        notes: input.notes,
      }),
    fetchSubscription: (id: string) => call<RazorpaySubscriptionEntity>('GET', `/subscriptions/${encodeURIComponent(id)}`),
    fetchPayment: (id: string) => call<RazorpayPaymentEntity>('GET', `/payments/${encodeURIComponent(id)}`),
    cancelSubscription: (id: string, atCycleEnd: boolean) =>
      call<RazorpaySubscriptionEntity>('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
        cancel_at_cycle_end: atCycleEnd ? 1 : 0,
      }),
  }
}

export type RazorpayClient = ReturnType<typeof createRazorpayClient>
