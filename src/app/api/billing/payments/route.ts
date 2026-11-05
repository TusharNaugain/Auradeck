/**
 * /api/billing/payments — record payments manually or view history (GET/POST).
 * Payment provider callbacks live in /api/webhooks/razorpay.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { paymentListSchema, paymentCreateSchema } from '@/lib/validations/billing'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError, ConflictError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'
import { Prisma, type InvoiceStatus, type PaymentStatus } from '@prisma/client'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = paymentListSchema.parse(Object.fromEntries(searchParams))

  const org = await db.organisation.findUnique({ where: { id: organisationId }, select: { type: true } })
  const visibility = org?.type === 'AURADESK_INTERNAL' ? {} : { account: { organisationId } }

  const where: Prisma.PaymentWhereInput = {
    ...visibility,
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
    ...(query.status ? { status: query.status.toUpperCase() as PaymentStatus } : {}),
    ...(query.method ? { method: query.method.toUpperCase() } : {}),
  }

  const [items, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { invoice: { select: { invoiceNumber: true } } },
    }),
    db.payment.count({ where }),
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

  const body = await parseJsonBody(req, paymentCreateSchema)

  const invoice = await db.invoice.findFirst({
    where: { id: body.invoiceId, organisationId },
    select: { id: true, accountId: true, total: true, amountPaid: true, amountDue: true, invoiceNumber: true },
  })
  if (!invoice) throw new NotFoundError('Invoice not found')

  const amountDue = Number(invoice.amountDue)
  const amountPaid = Number(invoice.amountPaid)
  if (amountDue === 0) {
    throw new ConflictError('Invoice is already fully paid')
  }

  const paidAmount = body.amount
  if (paidAmount > amountDue) {
    throw new ConflictError('Payment exceeds the outstanding invoice balance')
  }

  const newAmountDue = amountDue - paidAmount
  const newStatus: InvoiceStatus = newAmountDue <= 0 ? 'PAID' : amountPaid + paidAmount > 0 ? 'PARTIALLY_PAID' : 'ISSUED'

  const isSettled = body.status?.toUpperCase() === 'SUCCESS'

  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        accountId: invoice.accountId,
        amount: paidAmount,
        currency: body.currency,
        method: body.method?.toUpperCase(),
        status: body.status ? (body.status.toUpperCase() as PaymentStatus) : undefined,
        transactionReference: body.transactionReference,
        providerPaymentId: body.providerPaymentId,
        paidAt: body.paidAt ? new Date(body.paidAt) : isSettled ? new Date() : undefined,
        failureReason: body.failureReason,
      },
    })

    if (isSettled) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: amountPaid + paidAmount,
          amountDue: newAmountDue,
          status: newStatus,
        },
      })
    }
    return payment
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'payment.recorded',
    resourceType: 'payment',
    resourceId: result.id,
    ipHash,
    afterJson: { invoiceNumber: invoice.invoiceNumber, amount: String(result.amount), status: result.status },
  })

  return NextResponse.json({ success: true, data: result, requestId: uuidv4() }, { status: 201 })
})
