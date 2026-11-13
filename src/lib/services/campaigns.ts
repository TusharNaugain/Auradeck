/** Campaign sending: recipient eligibility and the background job that hands a send to Resend. */

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { logger } from '@/lib/utils/logger'
import { DEAD_LEAD_STAGES } from '@/lib/services/leads'
import { renderCampaignHtml, renderCampaignText } from '@/lib/email/campaign-template'
import { addContactsToSegment, createSegment, sendBroadcast, type CampaignContact } from '@/lib/email/resend-broadcast'

export type Audience = 'priority' | 'others' | 'all'

export const MAX_RECIPIENTS = 5000
/** Sends still queued/syncing/sending after this long are treated as interrupted (e.g. server restart). */
export const STALE_AFTER_MS = 60 * 60 * 1000
export const ACTIVE_STATUSES = ['queued', 'syncing', 'sending']

const OPTED_OUT = new Set(['withdrawn', 'opted_out', 'opt_out', 'no', 'none', 'revoked', 'unsubscribed'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type EligibleLead = CampaignContact & { isPriority: boolean }

/** Live, non-dead leads with a valid email and no opt-out, one per (lower-cased) email, priority first. */
export async function eligibleLeads(organisationId: string, scope: Prisma.LeadWhereInput): Promise<EligibleLead[]> {
  const leads = await db.lead.findMany({
    where: {
      AND: [
        { organisationId, deletedAt: null, email: { not: null }, lifecycleStage: { notIn: [...DEAD_LEAD_STAGES] } },
        scope,
      ],
    },
    orderBy: [{ isPriority: 'desc' }, { createdAt: 'asc' }],
    select: { email: true, firstName: true, lastName: true, isPriority: true, consentStatus: true },
  })
  const seen = new Set<string>()
  const out: EligibleLead[] = []
  for (const { email, consentStatus, ...rest } of leads) {
    const key = email?.trim().toLowerCase()
    if (!key || !EMAIL_RE.test(key) || seen.has(key)) continue
    if (OPTED_OUT.has(consentStatus?.trim().toLowerCase() ?? '')) continue
    seen.add(key)
    out.push({ ...rest, email: key })
  }
  return out
}

export const pickAudience = (leads: EligibleLead[], audience: Audience): EligibleLead[] =>
  audience === 'all' ? leads : leads.filter((l) => l.isPriority === (audience === 'priority'))

export const sendSelect = {
  id: true, subject: true, audience: true, recipientCount: true, status: true, error: true,
  createdAt: true, completedAt: true, updatedAt: true,
} as const

/** API shape of a send; an abandoned in-flight row is reported as failed. */
export function toSendDto({ updatedAt, ...row }: Prisma.CampaignSendGetPayload<{ select: typeof sendSelect }>) {
  const stale = ACTIVE_STATUSES.includes(row.status) && Date.now() - updatedAt.getTime() > STALE_AFTER_MS
  return stale ? { ...row, status: 'failed', error: 'Interrupted before completion (server restart or timeout).' } : row
}

/**
 * Runs one send. Nothing is emailed until the final broadcast call, so any earlier failure leaves
 * Resend untouched. Never throws: every error ends as a failed row.
 */
export async function runCampaignSend(id: string, subject: string, message: string, recipients: CampaignContact[]) {
  const update = (data: Prisma.CampaignSendUpdateInput) => db.campaignSend.update({ where: { id }, data })
  try {
    await update({ status: 'syncing' })
    const resendSegmentId = await createSegment(`CRM ${id}`)
    await update({ resendSegmentId })
    await addContactsToSegment(resendSegmentId, recipients)
    await update({ status: 'sending' })
    const resendBroadcastId = await sendBroadcast({
      segmentId: resendSegmentId,
      name: `CRM ${id}`,
      subject,
      html: renderCampaignHtml({ message }),
      text: renderCampaignText({ message }),
    })
    await update({ status: 'sent', resendBroadcastId, completedAt: new Date() })
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    logger.error('Campaign send failed', { id, error })
    await update({ status: 'failed', error, completedAt: new Date() }).catch(() => undefined)
  }
}
