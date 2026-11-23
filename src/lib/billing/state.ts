/**
 * Pure subscription state rules for Auradeck practice billing:
 * mapping Razorpay subscription statuses, applying verified lifecycle data
 * (out-of-order and replay safe) and deciding feature access.
 */

import type { RazorpaySubscriptionEntity } from './razorpay'

export const PRACTICE_STATUSES = [
  'TRIAL', 'CREATED', 'AUTHENTICATED', 'ACTIVE', 'PAST_DUE', 'HALTED', 'PAUSED', 'CANCELLED', 'COMPLETED', 'EXPIRED',
] as const
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number]

/** Days of continued access after a renewal payment fails. */
export const GRACE_DAYS = 7
/** Days before trial end when the reminder email goes out. */
export const TRIAL_REMINDER_DAYS = 3
export const DAY_MS = 24 * 60 * 60 * 1000

const TERMINAL: ReadonlySet<PracticeStatus> = new Set(['CANCELLED', 'COMPLETED', 'EXPIRED'])

export interface SubscriptionState {
  status: PracticeStatus
  trialEndsAt: Date | null
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  graceUntil: Date | null
  cancelAtPeriodEnd: boolean
  cancelledAt: Date | null
  lastEventAt: Date | null
  razorpayCustomerId: string | null
}

export type SubscriptionPatch = Partial<SubscriptionState>

/** Razorpay subscription.status → our status. Unknown values return null (leave unchanged). */
export function mapRazorpayStatus(status: string | null | undefined): PracticeStatus | null {
  switch ((status ?? '').toLowerCase()) {
    case 'created': return 'CREATED'
    case 'authenticated': return 'AUTHENTICATED'
    case 'active': return 'ACTIVE'
    case 'pending': return 'PAST_DUE'
    case 'halted': return 'HALTED'
    case 'paused': return 'PAUSED'
    case 'cancelled': return 'CANCELLED'
    case 'completed': return 'COMPLETED'
    case 'expired': return 'EXPIRED'
    default: return null
  }
}

const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000) : null

export interface ApplyResult {
  patch: SubscriptionPatch
  /** Set when the status part was skipped (stale or would leave a terminal state). */
  skipped?: 'stale' | 'terminal' | 'unknown_status'
}

/**
 * Work out the DB patch for verified Razorpay subscription data.
 * - Older events than the last one applied never change the status (webhooks can arrive out of order).
 * - A cancelled / completed / expired subscription is never revived by a late event.
 * - Entering PAST_DUE starts a grace period once; becoming ACTIVE clears it.
 */
export function applyRazorpaySubscription(
  state: SubscriptionState,
  entity: Pick<RazorpaySubscriptionEntity, 'status' | 'current_start' | 'current_end' | 'customer_id'>,
  opts: { eventAt: Date | null; now: Date }
): ApplyResult {
  const patch: SubscriptionPatch = {}
  if (entity.customer_id && entity.customer_id !== state.razorpayCustomerId) patch.razorpayCustomerId = entity.customer_id

  if (opts.eventAt && state.lastEventAt && opts.eventAt.getTime() < state.lastEventAt.getTime()) {
    return { patch, skipped: 'stale' }
  }
  if (opts.eventAt) patch.lastEventAt = opts.eventAt

  const next = mapRazorpayStatus(entity.status)
  if (!next) return { patch, skipped: 'unknown_status' }
  if (TERMINAL.has(state.status) && !TERMINAL.has(next)) return { patch, skipped: 'terminal' }

  const start = fromUnix(entity.current_start)
  const end = fromUnix(entity.current_end)
  if (start) patch.currentPeriodStart = start
  if (end) patch.currentPeriodEnd = end

  if (next !== state.status) patch.status = next

  if (next === 'ACTIVE' || next === 'AUTHENTICATED') {
    if (state.graceUntil) patch.graceUntil = null
  } else if (next === 'PAST_DUE') {
    if (!state.graceUntil) patch.graceUntil = new Date(opts.now.getTime() + GRACE_DAYS * DAY_MS)
  } else if (next === 'CANCELLED') {
    if (!state.cancelledAt) patch.cancelledAt = opts.now
  }

  return { patch }
}

export type AccessReason =
  | 'active'
  | 'trial'
  | 'grace'
  | 'paid_period'
  | 'trial_expired'
  | 'payment_failed'
  | 'ended'

export interface Entitlement {
  hasAccess: boolean
  reason: AccessReason
  /** When the current access ends, if known. */
  until: Date | null
}

/** Feature access follows server-side subscription state only. */
export function entitlementFor(state: Pick<SubscriptionState, 'status' | 'trialEndsAt' | 'currentPeriodEnd' | 'graceUntil'>, now: Date): Entitlement {
  const t = now.getTime()
  const future = (d: Date | null) => Boolean(d && d.getTime() > t)

  if (state.status === 'ACTIVE' || state.status === 'AUTHENTICATED') {
    return { hasAccess: true, reason: 'active', until: state.currentPeriodEnd }
  }
  if (state.status === 'PAST_DUE') {
    return future(state.graceUntil)
      ? { hasAccess: true, reason: 'grace', until: state.graceUntil }
      : { hasAccess: false, reason: 'payment_failed', until: null }
  }
  if (future(state.trialEndsAt)) return { hasAccess: true, reason: 'trial', until: state.trialEndsAt }
  if ((state.status === 'CANCELLED' || state.status === 'CREATED') && future(state.currentPeriodEnd)) {
    return { hasAccess: true, reason: 'paid_period', until: state.currentPeriodEnd }
  }
  if (state.status === 'HALTED' || state.status === 'PAUSED') return { hasAccess: false, reason: 'payment_failed', until: null }
  if (state.status === 'TRIAL' || state.status === 'CREATED') return { hasAccess: false, reason: 'trial_expired', until: null }
  return { hasAccess: false, reason: 'ended', until: null }
}

/** Whether the practice may start a new checkout (instead of already being subscribed). */
export function canStartCheckout(status: PracticeStatus): boolean {
  return !['ACTIVE', 'AUTHENTICATED', 'PAST_DUE'].includes(status)
}

/** Razorpay total_count: bill for up to ~10 years. */
export function totalCountFor(interval: 'monthly' | 'annual'): number {
  return interval === 'annual' ? 10 : 120
}

export function shouldSendTrialReminder(
  state: Pick<SubscriptionState, 'status' | 'trialEndsAt'> & { trialReminderSentAt: Date | null },
  now: Date
): boolean {
  if (state.trialReminderSentAt || !state.trialEndsAt) return false
  if (state.status !== 'TRIAL' && state.status !== 'CREATED') return false
  const left = state.trialEndsAt.getTime() - now.getTime()
  return left > 0 && left <= TRIAL_REMINDER_DAYS * DAY_MS
}
