/**
 * POST /api/leads/[id]/convert — atomic lead -> account + contact + opportunity.
 * Transactional with full audit history; guarded against double conversion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { guardedRoute, parseJsonBody } from '@/lib/utils/api-helpers'
import { routeHandler } from '@/lib/utils/api-helpers'
import { convertLead } from '@/lib/services/leads'
import { createAuditLog } from '@/lib/audit'
import { createNotifications } from '@/lib/services/notifications'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { db } from '@/lib/db'
import { resolveLeadScope } from '@/lib/reports/scope'
import { v4 as uuidv4 } from 'uuid'

const convertSchema = z.object({
  accountName: z.string().max(150).optional(),
  opName: z.string().max(200).optional(),
  opAmount: z.number().min(0).max(1e12).optional(),
  opExpectedCloseDate: z.string().datetime().optional(),
  opOwnerUserId: z.string().optional(),
  billingFrequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annual']).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const POST = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.LEADS_CONVERT,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!
  const recordScope = await resolveLeadScope(organisationId, ctx.scopeType, user.id, ctx.teamId)

  const lead = await db.lead.findFirst({
    where: { AND: [{ id, organisationId, deletedAt: null }, recordScope] },
    select: { id: true, leadNumber: true, lifecycleStage: true },
  })
  if (!lead) throw new NotFoundError('Lead not found')

  const body = await parseJsonBody(req, convertSchema)

  // Notify implementers/CS-heads post-conversion
  const csmHeads = await db.membership.findMany({
    where: {
      organisationId,
      status: 'ACTIVE',
      role: { slug: { in: ['csm_head', 'operations_admin'] } },
    },
    select: { userId: true },
  })

  const result = await convertLead({
    organisationId,
    leadId: lead.id,
    actorUserId: user.id,
    createOpportunity: true,
    opportunity: {
      name: body.opName,
      amount: body.opAmount,
      expectedCloseDate: body.opExpectedCloseDate ? new Date(body.opExpectedCloseDate) : null,
      billingFrequency: body.billingFrequency,
      ownerUserId: body.opOwnerUserId ?? user.id,
    },
    accountOverrides: { accountName: body.accountName },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'lead.convert',
    resourceType: 'lead',
    resourceId: lead.id,
    afterJson: {
      accountId: result.accountId,
      contactId: result.contactId,
      opportunityId: result.opportunityId,
      leadNumber: lead.leadNumber,
    },
    ipHash,
  })

  await createNotifications({
    userIds: csmHeads.map((m) => m.userId),
    organisationId,
    type: 'lead.converted',
    title: `Lead ${lead.leadNumber} converted`,
    message: 'A new practice account was created from a converted lead. Onboarding setup needed.',
    severity: 'success',
    actionUrl: `/accounts/${result.accountId}`,
  })

  return NextResponse.json(
    { success: true, data: { accountId: result.accountId, contactId: result.contactId, opportunityId: result.opportunityId }, requestId: uuidv4() },
    { status: 201 }
  )
})
