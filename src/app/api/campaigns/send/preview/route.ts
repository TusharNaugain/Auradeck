/** POST /api/campaigns/send/preview — the branded template rendered with sample values. */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { renderCampaignHtml, withSampleValues } from '@/lib/email/campaign-template'
import { v4 as uuidv4 } from 'uuid'

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response

  const { message } = await parseJsonBody(req, z.object({ message: z.string().max(10000) }))
  return NextResponse.json({ success: true, data: { html: withSampleValues(renderCampaignHtml({ message })) }, requestId: uuidv4() })
})
