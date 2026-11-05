/**
 * /api/billing — hub: subscriptions (GET list), plus invoice + payment data
 * available under /api/billing/invoices and /api/billing/payments.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type SubscriptionStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler, parseJsonBody } from '@/lib/utils/api-helpers'
import { subscriptionListSchema, subscriptionCreateSchema } from '@/lib/validations/billing'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_VIEW })
  if (guard.response) return guard.response
  const { organisationId, ctx } = guard.context!
  const canViewContacts = ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW)

  const { searchParams } = new URL(req.url)
  const query = subscriptionListSchema.parse(Object.fromEntries(searchParams))

  // AuraDeck internal org sees subscriptions across all practices.
  // Customer practice users only see their own subscription.
  const isInternal = (await db.organisation.findUnique({
    where: { id: organisationId },
    select: { type: true },
  }))?.type === 'AURADESK_INTERNAL'

  const where: Prisma.SubscriptionWhereInput = {
    AND: [
      // AuraDeck internal org sees subscriptions across all practices;
      // customer practice users only see subscriptions of their own account.
      ...(isInternal ? [] : [{ account: { organisationId } }]),
      ...(query.status ? [{ status: query.status.toUpperCase() as SubscriptionStatus }] : []),
      ...(query.accountId ? [{ accountId: query.accountId }] : []),
      ...(query.renewalWithinDays
        ? [{ renewalDate: { gte: new Date(), lte: new Date(Date.now() + query.renewalWithinDays * 24 * 3600 * 1000) } }]
        : []),
      ...(query.search ? [{ account: { accountName: { contains: query.search, mode: 'insensitive' as const } } }] : []),
    ],
  }

  const [items, total] = await Promise.all([
    db.subscription.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        account: {
          select: {
            id: true,
            accountName: true,
            ...(canViewContacts ? {
              contacts: {
                where: { deletedAt: null },
                orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'desc' as const }],
                take: 1,
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  phoneNumber: true,
                  whatsappNumber: true,
                  jobTitle: true,
                  lastContactedAt: true,
                },
              },
            } : {}),
          },
        },
        plan: { select: { name: true, monthlyPrice: true } },
      },
    }),
    db.subscription.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.BILLING_MANAGE,
    policy: 'apiWrite',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, subscriptionCreateSchema)

  const account = await db.account.findFirst({
    where: { id: body.accountId, organisationId },
    select: { id: true },
  })
  if (!account) throw new NotFoundError('Account not found in this organisation')

  const subscription = await db.subscription.create({
    data: {
      accountId: account.id,
      organisationId,
      planId: body.planId,
      status: body.status ? (body.status.toUpperCase() as SubscriptionStatus) : undefined,
      billingFrequency: body.billingFrequency,
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      renewalDate: body.renewalDate ? new Date(body.renewalDate) : undefined,
      seats: body.seats ?? 1,
      amount: body.amount ?? 0,
      currency: body.currency,
      paymentProvider: body.paymentProvider,
      providerCustomerId: body.providerCustomerId,
      providerSubscriptionId: body.providerSubscriptionId,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'subscription.create',
    resourceType: 'subscription',
    resourceId: subscription.id,
    ipHash,
    afterJson: { amount: subscription.amount, frequency: subscription.billingFrequency },
  })

  return NextResponse.json({ success: true, data: subscription, requestId: uuidv4() }, { status: 201 })
})
