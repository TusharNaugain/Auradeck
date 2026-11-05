/**
 * Health score engine: event-driven score with 0-100 bounds, category events and
 * status thresholds. All mutations record HealthScoreEvents for the timeline.
 * Thresholds: >=80 healthy | >=60 watch | >=35 at_risk | else critical.
 */

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

const BOUNDS = { min: 0, max: 100 }
const THRESHOLDS = { healthy: 80, watch: 60, atRisk: 35 }

export interface HealthEventInput {
  accountId: string
  category: 'LOGIN' | 'USAGE' | 'SUPPORT' | 'PAYMENT' | 'ENGAGEMENT' | 'NPS' | 'RENEWAL' | 'MANUAL'
  scoreDelta: number
  reason?: string
  source?: string
  tx?: Prisma.TransactionClient
}

export function statusForScore(score: number): 'healthy' | 'watch' | 'at_risk' | 'critical' {
  if (score >= THRESHOLDS.healthy) return 'healthy'
  if (score >= THRESHOLDS.watch) return 'watch'
  if (score >= THRESHOLDS.atRisk) return 'at_risk'
  return 'critical'
}

/**
 * Apply a score delta (bounded), persist the event log row and update the account.
 * Idempotency for repeated identical deltas is the caller's responsibility for
 * automation-triggered events; manual apply always records.
 */
export async function applyHealthScoreEvent(input: HealthEventInput): Promise<{
  scoreBefore: number
  scoreAfter: number
  healthStatus: string
}> {
  const apply = async (tx: Prisma.TransactionClient) => {
    const account = await tx.account.findUnique({
      where: { id: input.accountId },
      select: { id: true, healthScore: true },
    })
    if (!account) throw new Error('ACCOUNT_NOT_FOUND')

    const scoreBefore = account.healthScore
    // clamped delta
    const scoreAfter = Math.min(BOUNDS.max, Math.max(BOUNDS.min, scoreBefore + input.scoreDelta))

    await tx.healthScoreEvent.create({
      data: {
        accountId: input.accountId,
        category: input.category,
        scoreDelta: scoreAfter - scoreBefore,
        scoreBefore,
        scoreAfter,
        reason: input.reason,
        source: input.source,
      },
    })

    const healthStatus = statusForScore(scoreAfter).toUpperCase()
    await tx.account.update({
      where: { id: input.accountId },
      data: {
        healthScore: scoreAfter,
        healthStatus: healthStatus as never,
        healthScoreReason: input.reason ?? null,
      },
    })

    return { scoreBefore, scoreAfter, healthStatus: statusForScore(scoreAfter) }
  }

  if (input.tx) {
    return apply(input.tx)
  }
  return db.$transaction(apply)
}

/**
 * Recalculate from agents in health events (rule-based, for job scheduler):
 * - no login in 21+ days: -5
 * - unresolved tickets > 7 days: -10
 * - overdue invoices: -10
 * - NPS provided: +5
 */
export async function recalculateAccountHealth(accountId: string): Promise<void> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      lastLoginAt: true,
      npsScore: true,
    },
  })
  if (!account) return

  const [hasOverdueInvoices, hasAgingTickets] = await Promise.all([
    db.invoice.findFirst({
      where: { accountId, status: 'OVERDUE' },
      select: { id: true },
    }),
    db.supportTicket.findFirst({
      where: {
        accountId,
        status: { in: ['NEW', 'OPEN', 'PENDING_INTERNAL'] },
        createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
      },
      select: { id: true },
    }),
  ])

  let delta = 0
  if (account.lastLoginAt && Date.now() - account.lastLoginAt.getTime() > 21 * 24 * 3600 * 1000) {
    delta -= 5
  }
  if (hasOverdueInvoices) delta -= 10
  if (hasAgingTickets) delta -= 10
  if (account.npsScore !== null && account.npsScore >= 8) delta += 5

  if (delta !== 0) {
    await applyHealthScoreEvent({
      accountId,
      category: 'USAGE',
      scoreDelta: delta,
      reason: 'Automated health recalculation',
      source: 'system.recalc',
    })
  }
}
