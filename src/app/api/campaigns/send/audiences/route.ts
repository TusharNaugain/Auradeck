/** GET /api/campaigns/send/audiences — eligible recipient counts per audience. */

import { NextRequest, NextResponse } from 'next/server'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveLeadScope } from '@/lib/reports/scope'
import { eligibleLeads } from '@/lib/services/campaigns'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const scope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const leads = await eligibleLeads(organisationId, scope)
  const priority = leads.filter((l) => l.isPriority).length
  return NextResponse.json(
    { success: true, data: { priority, others: leads.length - priority, all: leads.length }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
