/**
 * Prisma-backed BillingStore plus helpers to load / lazily create a practice's subscription.
 */

import { Prisma, type PracticeSubscription } from '@prisma/client'
import { db } from '@/lib/db'
import type { BillingStore, StoredSubscription } from './webhook'
import { DAY_MS } from './state'

export function toStored(row: PracticeSubscription): StoredSubscription {
  return {
    id: row.id,
    organisationId: row.organisationId,
    razorpaySubscriptionId: row.razorpaySubscriptionId,
    amount: row.amount == null ? null : Number(row.amount),
    status: row.status,
    trialEndsAt: row.trialEndsAt,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    graceUntil: row.graceUntil,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    cancelledAt: row.cancelledAt,
    lastEventAt: row.lastEventAt,
    razorpayCustomerId: row.razorpayCustomerId,
  }
}

export function createPrismaBillingStore(): BillingStore {
  return {
    async claimEvent({ eventId, eventType, razorpaySubscriptionId, payload }) {
      try {
        await db.billingEvent.create({
          data: { eventId, eventType, razorpaySubscriptionId, payload: payload as Prisma.InputJsonValue, status: 'received' },
        })
        return 'new'
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          // Re-claim only events whose earlier processing failed.
          const reclaimed = await db.billingEvent.updateMany({
            where: { eventId, status: 'failed' },
            data: { status: 'received', error: null },
          })
          return reclaimed.count === 1 ? 'retry' : 'duplicate'
        }
        throw error
      }
    },
    async finishEvent(eventId, status, fields) {
      await db.billingEvent.update({
        where: { eventId },
        data: { status, organisationId: fields.organisationId ?? undefined, error: fields.error ?? null, processedAt: new Date() },
      })
    },
    async findSubscriptionByRazorpayId(razorpaySubscriptionId) {
      const row = await db.practiceSubscription.findUnique({ where: { razorpaySubscriptionId } })
      return row ? toStored(row) : null
    },
    async updateSubscription(id, patch) {
      await db.practiceSubscription.update({ where: { id }, data: patch })
    },
    async upsertPayment(p) {
      await db.practicePayment.upsert({
        where: { razorpayPaymentId: p.razorpayPaymentId },
        create: p,
        update: { status: p.status, method: p.method, failureReason: p.failureReason, paidAt: p.paidAt, razorpayInvoiceId: p.razorpayInvoiceId },
      })
    },
  }
}

/** Default self-serve plan for practices. */
export async function selfServePlans() {
  return db.plan.findMany({
    where: { isActive: true, isSelfServe: true },
    orderBy: { monthlyPrice: 'asc' },
  })
}

/**
 * The practice's subscription row, created on first visit with a fresh trial
 * (trial length from the cheapest self-serve plan, default 14 days).
 */
export async function getOrCreatePracticeSubscription(organisationId: string, now = new Date()): Promise<PracticeSubscription> {
  const existing = await db.practiceSubscription.findUnique({ where: { organisationId } })
  if (existing) return existing
  const plan = (await selfServePlans())[0]
  const trialDays = plan?.trialDays ?? 14
  try {
    return await db.practiceSubscription.create({
      data: { organisationId, status: 'TRIAL', planId: plan?.id, trialEndsAt: new Date(now.getTime() + trialDays * DAY_MS) },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return db.practiceSubscription.findUniqueOrThrow({ where: { organisationId } })
    }
    throw error
  }
}
