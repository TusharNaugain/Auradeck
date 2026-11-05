/**
 * /api/billing/invoices — list (GET), create (POST). Tenant-isolated to
 * AuraDeck internal org (all practices) or customer practice's own invoices.
 */

import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type InvoiceStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { invoiceListSchema, invoiceCreateSchema } from '@/lib/validations/billing'
import { nextNumber } from '@/lib/services/numbering'
import { createAuditLog } from '@/lib/audit'
import { PERMISSIONS } from '@/lib/permissions'
import { NotFoundError } from '@/lib/services/errors'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_VIEW })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = invoiceListSchema.parse(Object.fromEntries(searchParams))

  const org = await db.organisation.findUnique({ where: { id: organisationId }, select: { type: true } })
  const visibility = org?.type === 'AURADESK_INTERNAL' ? {} : { account: { organisationId } }

  const where: Prisma.InvoiceWhereInput = {
    ...visibility,
    ...(query.status ? { status: query.status.toUpperCase() as InvoiceStatus } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.overdue === 'true'
      ? { status: 'ISSUED' as const, dueDate: { lt: new Date() }, amountDue: { gt: 0 } }
      : {}),
    ...(query.dueBefore || query.dueAfter
      ? {
          dueDate: {
            ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
            ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
          },
        }
      : {}),
    ...(query.search
      ? { invoiceNumber: { contains: query.search, mode: 'insensitive' as const } }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.invoice.findMany({
      where,
      orderBy: { [query.sortBy]: query.sort },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        account: { select: { accountName: true, customerAccountCode: true } },
      },
    }),
    db.invoice.count({ where }),
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

  const body = await parseJsonBody(req, invoiceCreateSchema)

  const account = await db.account.findFirst({
    where: { id: body.accountId, organisationId },
    select: { id: true },
  })
  if (!account) throw new NotFoundError('Account not found in this organisation')

  const invoiceNumber = await nextNumber(organisationId, 'invoice')

  const invoice = await db.invoice.create({
    data: {
      organisationId,
      accountId: account.id,
      subscriptionId: body.subscriptionId,
      invoiceNumber,
      status: body.status ? (body.status.toUpperCase() as InvoiceStatus) : undefined,
      issueDate: body.issueDate ? new Date(body.issueDate) : new Date(),
      dueDate: new Date(body.dueDate),
      subtotal: body.subtotal,
      tax: body.tax ?? 0,
      discount: body.discount ?? 0,
      total: body.total,
      amountPaid: body.amountPaid ?? 0,
      amountDue: body.amountDue,
      currency: body.currency,
      billingAddress: body.billingAddress ?? {},
      notes: body.notes,
    },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'invoice.create',
    resourceType: 'invoice',
    resourceId: invoice.id,
    ipHash,
    afterJson: { invoiceNumber: invoice.invoiceNumber, total: String(invoice.total) },
  })

  return NextResponse.json({ success: true, data: invoice, requestId: uuidv4() }, { status: 201 })
})
