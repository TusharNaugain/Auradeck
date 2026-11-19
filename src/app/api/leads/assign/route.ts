/**
 * POST /api/leads/assign — give one or more visible leads to a team member (or unassign them).
 * Needs leads.assign; only leads inside the caller's own visibility are touched, and the
 * new owner must be an active member of the organisation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { resolveLeadScope } from '@/lib/reports/scope'
import { assertActiveMember } from '@/lib/services/assignment'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

const bodySchema = z.object({
  leadIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  assignedToUserId: z.string().min(1).max(64).nullable(),
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.LEADS_ASSIGN, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, bodySchema)
  if (body.assignedToUserId) await assertActiveMember(organisationId, body.assignedToUserId)

  const scope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)
  const { count } = await db.lead.updateMany({
    where: { AND: [{ id: { in: Array.from(new Set(body.leadIds)) }, organisationId, deletedAt: null }, scope] },
    data: { assignedToUserId: body.assignedToUserId },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.assign',
    resourceType: 'lead',
    ipHash,
    afterJson: { assignedToUserId: body.assignedToUserId, requested: body.leadIds.length, updated: count },
  })

  return NextResponse.json({ success: true, data: { updated: count }, requestId: uuidv4() })
})
