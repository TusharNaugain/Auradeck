/**
 * Practice subscription use-cases: status, start checkout, verify checkout, cancel.
 * Amounts and plans are decided here on the server — never taken from the browser.
 */

import type { Plan, PracticeSubscription, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logger } from '@/lib/utils/logger'
import { ConflictError, NotFoundError, ValidationFailedError } from '@/lib/services/errors'
import {
  billingEnabled,
  createRazorpayClient,
  razorpayConfig,
  requireRazorpayConfig,
  verifySubscriptionPaymentSignature,
  type RazorpayClient,
  type RazorpayConfig,
} from './razorpay'
import { canStartCheckout, entitlementFor, totalCountFor } from './state'
import { createPrismaBillingStore, getOrCreatePracticeSubscription, selfServePlans, toStored } from './prisma-store'
import { syncSubscription } from './webhook'

export type BillingInterval = 'monthly' | 'annual'

async function practiceOrganisation(organisationId: string) {
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true, type: true, displayName: true, primaryEmail: true, primaryPhone: true },
  })
  if (!org) throw new NotFoundError('Organisation not found')
  return org
}

function priceFor(plan: Plan, interval: BillingInterval): number {
  const price = interval === 'annual' ? plan.annualPrice : plan.monthlyPrice
  if (price == null || Number(price) <= 0) throw new ValidationFailedError(`This plan has no ${interval} price`)
  return Number(price)
}

/** Razorpay plan id for (plan, interval) in the current key mode, created once on demand. */
export async function ensureRazorpayPlan(plan: Plan, interval: BillingInterval, client: RazorpayClient, mode: RazorpayConfig['mode']): Promise<string> {
  const ids = (plan.razorpayPlanIds && typeof plan.razorpayPlanIds === 'object' && !Array.isArray(plan.razorpayPlanIds)
    ? plan.razorpayPlanIds
    : {}) as Record<string, string>
  const key = `${mode}:${interval}`
  if (ids[key]) return ids[key]
  const created = await client.createPlan({
    period: interval === 'annual' ? 'yearly' : 'monthly',
    amountPaise: Math.round(priceFor(plan, interval) * 100),
    currency: plan.currency,
    name: `${plan.name} (${interval})`,
    description: plan.description ?? undefined,
    notes: { auradeckPlanId: plan.id, interval },
  })
  await db.plan.update({ where: { id: plan.id }, data: { razorpayPlanIds: { ...ids, [key]: created.id } as Prisma.InputJsonValue } })
  return created.id
}

function subscriptionView(row: PracticeSubscription & { plan?: Plan | null }, now: Date) {
  return {
    status: row.status,
    planId: row.planId,
    planName: row.plan?.name ?? null,
    billingInterval: row.billingInterval,
    amount: row.amount == null ? null : Number(row.amount),
    currency: row.currency,
    trialEndsAt: row.trialEndsAt,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelledAt: row.cancelledAt,
    entitlement: entitlementFor(row, now),
    canCheckout: canStartCheckout(row.status),
  }
}

export async function getBillingStatus(organisationId: string, now = new Date()) {
  const org = await practiceOrganisation(organisationId)
  const config = razorpayConfig()
  const base = { enabled: billingEnabled(), configured: Boolean(config), mode: config?.mode ?? null }
  if (org.type !== 'CUSTOMER_PRACTICE') return { ...base, eligible: false as const }
  if (!base.enabled) return { ...base, eligible: true as const, subscription: null, plans: [], payments: [] }

  const sub = await getOrCreatePracticeSubscription(organisationId, now)
  const [row, plans, payments] = await Promise.all([
    db.practiceSubscription.findUniqueOrThrow({ where: { id: sub.id }, include: { plan: true } }),
    selfServePlans(),
    db.practicePayment.findMany({
      where: { organisationId },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { id: true, razorpayPaymentId: true, amount: true, currency: true, status: true, method: true, failureReason: true, paidAt: true, createdAt: true },
    }),
  ])

  return {
    ...base,
    eligible: true as const,
    subscription: subscriptionView(row, now),
    plans: plans.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      monthlyPrice: Number(p.monthlyPrice),
      annualPrice: p.annualPrice == null ? null : Number(p.annualPrice),
      currency: p.currency,
      features: Array.isArray(p.features) ? (p.features as unknown[]).filter((f): f is string => typeof f === 'string') : [],
    })),
    payments: payments.map(p => ({ ...p, amount: Number(p.amount) })),
  }
}

function assertBillingOpen(orgType: string) {
  if (orgType !== 'CUSTOMER_PRACTICE') throw new ValidationFailedError('Plans are only for therapist practices')
  if (!billingEnabled()) throw new ValidationFailedError('Online plan purchase is not available yet')
}

export async function startCheckout(
  organisationId: string,
  user: { fullName?: string | null; email: string },
  input: { planId: string; interval: BillingInterval },
  deps: { client?: RazorpayClient; now?: Date } = {}
) {
  const now = deps.now ?? new Date()
  const org = await practiceOrganisation(organisationId)
  assertBillingOpen(org.type)
  const config = requireRazorpayConfig()
  const client = deps.client ?? createRazorpayClient(config)

  const sub = await getOrCreatePracticeSubscription(organisationId, now)
  if (!canStartCheckout(sub.status)) throw new ConflictError('This practice already has an active plan')

  const plan = await db.plan.findFirst({ where: { id: input.planId, isActive: true, isSelfServe: true } })
  if (!plan) throw new NotFoundError('Plan not found')
  const amount = priceFor(plan, input.interval)
  const razorpayPlanId = await ensureRazorpayPlan(plan, input.interval, client, config.mode)

  // Re-use an unpaid checkout for the same plan instead of piling up subscriptions.
  let razorpaySubscriptionId: string | null = null
  let shortUrl: string | null = null
  if (sub.status === 'CREATED' && sub.razorpaySubscriptionId && sub.razorpayPlanId === razorpayPlanId) {
    const existing = await client.fetchSubscription(sub.razorpaySubscriptionId).catch(() => null)
    if (existing?.status === 'created') {
      razorpaySubscriptionId = existing.id
      shortUrl = existing.short_url ?? null
    }
  }
  if (!razorpaySubscriptionId) {
    const created = await client.createSubscription({
      planId: razorpayPlanId,
      totalCount: totalCountFor(input.interval),
      notes: { organisationId, auradeckPlanId: plan.id, interval: input.interval },
    })
    razorpaySubscriptionId = created.id
    shortUrl = created.short_url ?? null
  }

  await db.practiceSubscription.update({
    where: { id: sub.id },
    data: {
      status: 'CREATED',
      planId: plan.id,
      billingInterval: input.interval,
      amount,
      currency: plan.currency,
      razorpaySubscriptionId,
      razorpayPlanId,
      checkoutShortUrl: shortUrl,
      graceUntil: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      lastEventAt: null,
    },
  })

  return {
    keyId: config.keyId,
    mode: config.mode,
    subscriptionId: razorpaySubscriptionId,
    planName: plan.name,
    interval: input.interval,
    amount,
    currency: plan.currency,
    practiceName: org.displayName,
    prefill: { name: user.fullName ?? undefined, email: user.email, contact: org.primaryPhone ?? undefined },
  }
}

/**
 * Checkout handler callback. The signature proves the payment belongs to this
 * subscription; status is then refreshed from Razorpay's API on the server. The
 * webhook remains the source of truth for renewals and anything missed here.
 */
export async function verifyCheckout(
  organisationId: string,
  input: { razorpayPaymentId: string; razorpaySubscriptionId: string; razorpaySignature: string },
  deps: { client?: RazorpayClient; now?: Date } = {}
) {
  const now = deps.now ?? new Date()
  const config = requireRazorpayConfig()
  const row = await db.practiceSubscription.findUnique({ where: { organisationId } })
  if (!row || row.razorpaySubscriptionId !== input.razorpaySubscriptionId) throw new NotFoundError('Subscription not found')

  const valid = verifySubscriptionPaymentSignature(
    { paymentId: input.razorpayPaymentId, subscriptionId: input.razorpaySubscriptionId, signature: input.razorpaySignature },
    config.keySecret
  )
  if (!valid) throw new ValidationFailedError('Payment could not be verified')

  const client = deps.client ?? createRazorpayClient(config)
  let refreshed = false
  try {
    const [subscription, payment] = await Promise.all([
      client.fetchSubscription(input.razorpaySubscriptionId),
      client.fetchPayment(input.razorpayPaymentId),
    ])
    await syncSubscription(createPrismaBillingStore(), toStored(row), { subscription, payment, eventAt: null, now })
    refreshed = true
  } catch (error) {
    logger.warn('Razorpay refresh after checkout failed; waiting for webhook', { error: error instanceof Error ? error.message : String(error) })
  }

  const updated = await db.practiceSubscription.findUniqueOrThrow({ where: { id: row.id }, include: { plan: true } })
  return { verified: true, refreshed, subscription: subscriptionView(updated, now) }
}

export async function cancelSubscription(organisationId: string, deps: { client?: RazorpayClient; now?: Date } = {}) {
  const now = deps.now ?? new Date()
  const config = requireRazorpayConfig()
  const row = await db.practiceSubscription.findUnique({ where: { organisationId } })
  if (!row?.razorpaySubscriptionId || !['ACTIVE', 'AUTHENTICATED', 'PAST_DUE'].includes(row.status)) {
    throw new ConflictError('There is no active plan to cancel')
  }
  if (row.cancelAtPeriodEnd) throw new ConflictError('This plan is already set to cancel')

  const client = deps.client ?? createRazorpayClient(config)
  // Active plans keep access until the paid period ends; failed-payment plans stop now.
  const atCycleEnd = row.status === 'ACTIVE'
  const entity = await client.cancelSubscription(row.razorpaySubscriptionId, atCycleEnd)
  if (atCycleEnd && entity.status !== 'cancelled') {
    await db.practiceSubscription.update({ where: { id: row.id }, data: { cancelAtPeriodEnd: true } })
  } else {
    await syncSubscription(createPrismaBillingStore(), toStored(row), { subscription: entity, eventAt: null, now })
  }
  const updated = await db.practiceSubscription.findUniqueOrThrow({ where: { id: row.id }, include: { plan: true } })
  return subscriptionView(updated, now)
}

/**
 * When billing is on, a practice without access is read-only: mutations are
 * refused except billing itself. Auradeck's internal workspace is never blocked.
 */
export async function billingAccessBlocked(organisationId: string, now = new Date()): Promise<boolean> {
  if (!billingEnabled()) return false
  const org = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { type: true, practiceSubscription: true },
  })
  if (!org || org.type !== 'CUSTOMER_PRACTICE') return false
  // No row yet = first activity since billing was switched on: start the trial now,
  // so existing beta practices get the full trial and nobody skips it.
  const sub = org.practiceSubscription ?? (await getOrCreatePracticeSubscription(organisationId, now))
  return !entitlementFor(sub, now).hasAccess
}
