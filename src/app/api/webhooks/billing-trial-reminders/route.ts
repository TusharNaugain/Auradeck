/**
 * POST /api/webhooks/billing-trial-reminders — emails practices whose free trial ends
 * within 3 days (once each). Meant for a daily scheduler (e.g. a Railway cron)
 * sending `Authorization: Bearer <BILLING_CRON_SECRET>`.
 */

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { appUrl, sendTemplatedEmail, trialEndingEmail } from '@/lib/email'
import { billingEnabled } from '@/lib/billing/razorpay'
import { DAY_MS, TRIAL_REMINDER_DAYS, shouldSendTrialReminder } from '@/lib/billing/state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function authorised(req: NextRequest): boolean {
  const secret = process.env.BILLING_CRON_SECRET?.trim()
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!secret || secret.length < 32 || token.length !== secret.length) return false
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ success: false, code: 'AUTH_REQUIRED' }, { status: 401 })
  if (!billingEnabled()) return NextResponse.json({ success: true, data: { sent: 0, skipped: 'billing_disabled' } })

  const now = new Date()
  const due = await db.practiceSubscription.findMany({
    where: {
      status: { in: ['TRIAL', 'CREATED'] },
      trialReminderSentAt: null,
      trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_DAYS * DAY_MS) },
    },
    include: { organisation: { select: { displayName: true, primaryEmail: true } } },
    take: 200,
  })

  let sent = 0
  for (const sub of due) {
    if (!shouldSendTrialReminder(sub, now) || !sub.trialEndsAt) continue
    // Claim first so two scheduler runs never double-send.
    const claimed = await db.practiceSubscription.updateMany({
      where: { id: sub.id, trialReminderSentAt: null },
      data: { trialReminderSentAt: now },
    })
    if (claimed.count !== 1) continue
    const endsOn = sub.trialEndsAt.toLocaleDateString('en-IN', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
    })
    const ok = await sendTemplatedEmail(
      sub.organisation.primaryEmail,
      trialEndingEmail(sub.organisation.displayName, endsOn, `${appUrl}/billing/plan`)
    )
    if (ok) sent += 1
    else await db.practiceSubscription.update({ where: { id: sub.id }, data: { trialReminderSentAt: null } })
  }

  return NextResponse.json({ success: true, data: { due: due.length, sent } })
}
