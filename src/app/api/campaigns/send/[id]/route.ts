/** GET /api/campaigns/send/[id] — one send (status polling). */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { sendSelect, toSendDto } from '@/lib/services/campaigns'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response

  const send = await db.campaignSend.findFirst({
    where: { id, organisationId: guard.context!.organisationId },
    select: sendSelect,
  })
  if (!send) throw new NotFoundError('Send not found')
  return NextResponse.json({ success: true, data: toSendDto(send), requestId: uuidv4() })
})
