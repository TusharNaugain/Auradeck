/**
 * /api/campaigns/send — recent sends (GET) and test / send a campaign (POST).
 * A send is one Resend Broadcast built from the fixed template; the job runs in the background
 * and the client polls GET /api/campaigns/send/[id].
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { env } from '@/env'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveLeadScope } from '@/lib/reports/scope'
import { renderCampaignHtml, renderCampaignText, withSampleValues } from '@/lib/email/campaign-template'
import { sendTestEmail } from '@/lib/email/resend-broadcast'
import {
  ACTIVE_STATUSES, MAX_RECIPIENTS, STALE_AFTER_MS, eligibleLeads, pickAudience, runCampaignSend, sendSelect, toSendDto,
} from '@/lib/services/campaigns'
import { v4 as uuidv4 } from 'uuid'

const bodySchema = z.object({
  audience: z.enum(['priority', 'others', 'all']),
  subject: z.string().trim().min(1).max(150),
  message: z.string().trim().min(1).max(10000),
  mode: z.enum(['test', 'send']),
  confirmCount: z.number().int().min(0).optional(),
})

const fail = (error: string, code: string, status: number, extra: object = {}) =>
  NextResponse.json({ success: false, error, code, ...extra, requestId: uuidv4() }, { status })

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response

  const sends = await db.campaignSend.findMany({
    where: { organisationId: guard.context!.organisationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: sendSelect,
  })
  return NextResponse.json({ success: true, data: sends.map(toSendDto), requestId: uuidv4() })
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'campaignSend', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, bodySchema)
  if (!env.RESEND_API_KEY) return fail('Email sending is not configured.', 'EMAIL_NOT_CONFIGURED', 503)

  if (body.mode === 'test') {
    await sendTestEmail(
      user.email,
      `[Test] ${body.subject}`,
      withSampleValues(renderCampaignHtml(body)),
      withSampleValues(renderCampaignText(body))
    )
    return NextResponse.json({ success: true, data: { sent: true }, requestId: uuidv4() })
  }

  const running = await db.campaignSend.count({
    where: {
      organisationId,
      status: { in: ACTIVE_STATUSES },
      updatedAt: { gt: new Date(Date.now() - STALE_AFTER_MS) },
    },
  })
  if (running) return fail('Another campaign is still being sent.', 'SEND_IN_PROGRESS', 409)

  const scope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const recipients = pickAudience(await eligibleLeads(organisationId, scope), body.audience)
  if (body.confirmCount !== recipients.length) {
    return fail('The audience changed. Review the new count and confirm again.', 'COUNT_CHANGED', 409, { count: recipients.length })
  }
  if (!recipients.length) return fail('No eligible recipients.', 'NO_RECIPIENTS', 400)
  if (recipients.length > MAX_RECIPIENTS) {
    return fail(`A campaign can have at most ${MAX_RECIPIENTS} recipients.`, 'TOO_MANY_RECIPIENTS', 400)
  }

  const send = await db.campaignSend.create({
    data: {
      organisationId,
      createdByUserId: user.id,
      subject: body.subject,
      message: body.message,
      audience: body.audience,
      recipientCount: recipients.length,
    },
    select: { id: true },
  })
  void runCampaignSend(send.id, body.subject, body.message, recipients)

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'campaign.send',
    resourceType: 'campaign_send',
    resourceId: send.id,
    ipHash,
    afterJson: { audience: body.audience, recipientCount: recipients.length, subject: body.subject },
  })
  return NextResponse.json({ success: true, data: { id: send.id }, requestId: uuidv4() }, { status: 202 })
})
