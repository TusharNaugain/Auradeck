/**
 * GET /api/campaigns/send/leads — leads the sender can pick for a campaign.
 * Same rules as a real send: only leads in the sender's visibility, with a valid email,
 * not dead and not opted out. `search` matches name, email or practice.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveLeadScope } from '@/lib/reports/scope'
import { eligibleLeads } from '@/lib/services/campaigns'
import { searchWords } from '@/lib/utils/list'
import type { Prisma } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

const querySchema = z.object({ search: z.string().trim().max(200).optional() })
const LIMIT = 50

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.CAMPAIGNS_SEND, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user } = guard.context!

  const { search } = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams))
  const scope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const words = searchWords(search, ['firstName', 'lastName', 'fullName', 'email', 'organisationName']) as Prisma.LeadWhereInput[]
  const leads = await eligibleLeads(organisationId, scope, words.length ? { AND: words } : undefined, LIMIT)

  return NextResponse.json(
    {
      success: true,
      data: leads.map(({ id, email, firstName, lastName, isPriority, lifecycleStage }) => ({
        id, email, name: `${firstName} ${lastName}`.trim(), isPriority, lifecycleStage,
      })),
      requestId: uuidv4(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
