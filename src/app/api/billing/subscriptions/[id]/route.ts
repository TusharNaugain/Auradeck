import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { ConflictError, NotFoundError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

const manualActivationSchema = z.object({
  confirmManualActivation: z.literal(true),
  reason: z.string().trim().max(500).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

export const PATCH = routeHandler(async (req: NextRequest, context: RouteContext) => {
  const { id } = await context.params
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.BILLING_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!
  const body = await parseJsonBody(req, manualActivationSchema)

  const currentOrganisation = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { type: true },
  })
  const subscription = await db.subscription.findFirst({
    where: {
      id,
      ...(currentOrganisation?.type === 'AURADESK_INTERNAL'
        ? {}
        : { account: { organisationId } }),
    },
    select: { id: true, accountId: true, organisationId: true, status: true },
  })
  if (!subscription) throw new NotFoundError('Subscription not found')
  if (!['TRIAL', 'PAST_DUE'].includes(subscription.status)) {
    throw new ConflictError('Only trial or past-due subscriptions can be manually marked active')
  }

  const result = await db.$transaction(async (tx) => {
    const changed = await tx.subscription.updateMany({
      where: { id: subscription.id, status: { in: ['TRIAL', 'PAST_DUE'] } },
      data: { status: 'ACTIVE' },
    })
    if (changed.count !== 1) {
      throw new ConflictError('Subscription status changed. Refresh and try again')
    }

    const updated = await tx.subscription.findUniqueOrThrow({ where: { id: subscription.id } })
    await tx.activity.create({
      data: {
        organisationId: subscription.organisationId,
        activityType: 'NOTE',
        subject: 'Subscription manually marked active',
        description: body.reason || 'CRM status manually changed to active. No payment was verified or recorded.',
        outcome: 'Manual activation confirmed',
        status: 'COMPLETED',
        ownerUserId: user.id,
        assignedToUserId: user.id,
        relatedAccountId: subscription.accountId,
        visibility: 'TEAM',
        createdBy: user.id,
      },
    })
    return updated
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'subscription.manual_activate',
    resourceType: 'subscription',
    resourceId: subscription.id,
    beforeJson: { status: subscription.status },
    afterJson: { status: result.status, paymentVerified: false },
    ipHash,
  })

  return NextResponse.json({ success: true, data: result, requestId: uuidv4() })
})
