/**
 * Billing validation: subscriptions, invoices, payments.
 * No card numbers, CVVs or bank credentials are ever accepted — provider tokens only.
 */

import { z } from 'zod'
import { safeTextOptional, paginationSchema, customFieldsSchema } from './common'

export const subscriptionStatus = z.enum(['trial', 'active', 'past_due', 'cancelled', 'paused', 'expired'])
export const billingFrequency = z.enum(['monthly', 'quarterly', 'half_yearly', 'annual'])
export const invoiceStatus = z.enum(['draft', 'issued', 'partially_paid', 'paid', 'overdue', 'void'])

export const subscriptionCreateSchema = z.object({
  accountId: z.string(),
  planId: z.string().optional().nullable(),
  status: subscriptionStatus.optional().default('trial'),
  billingFrequency: billingFrequency.default('monthly'),
  startDate: z.string().datetime().optional(),
  renewalDate: z.string().datetime().optional().nullable(),
  seats: z.coerce.number().int().min(1).max(10000).optional().default(1),
  amount: z.coerce.number().min(0).max(1e10).optional(),
  currency: z.string().length(3).default('INR'),
  paymentProvider: safeTextOptional(50),
  providerCustomerId: safeTextOptional(100),
  providerSubscriptionId: safeTextOptional(100),
})

export const subscriptionUpdateSchema = subscriptionCreateSchema.partial()

export const subscriptionListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: subscriptionStatus.optional(),
  accountId: z.string().optional(),
  renewalWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  sortBy: z.enum(['createdAt', 'renewalDate', 'amount']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

export const invoiceCreateSchema = z.object({
  accountId: z.string(),
  subscriptionId: z.string().optional().nullable(),
  status: invoiceStatus.optional().default('draft'),
  issueDate: z.string().datetime().optional(),
  dueDate: z.string().datetime(),
  subtotal: z.coerce.number().min(0).max(1e10),
  tax: z.coerce.number().min(0).max(1e9).optional().default(0),
  discount: z.coerce.number().min(0).max(1e10).optional().default(0),
  amountPaid: z.coerce.number().min(0).max(1e10).optional().default(0),
  currency: z.string().length(3).default('INR'),
  billingAddress: customFieldsSchema.optional(),
  notes: safeTextOptional(1000),
}).transform((data) => {
  const total = data.subtotal + (data.tax ?? 0) - (data.discount ?? 0)
  return {
    ...data,
    total,
    amountDue: total - (data.amountPaid ?? 0),
  }
}).superRefine((data, ctx) => {
  if (data.total < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: 'Discount cannot exceed subtotal + tax' })
  }
})

export const invoiceUpdateSchema = z.object({
  status: invoiceStatus.optional(),
  dueDate: z.string().datetime().optional(),
  tax: z.coerce.number().min(0).optional(),
  discount: z.coerce.number().min(0).optional(),
  amountPaid: z.coerce.number().min(0).optional(),
  currency: z.string().length(3).optional(),
  billingAddress: customFieldsSchema.optional(),
  notes: safeTextOptional(1000).optional(),
})

export const invoiceListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: invoiceStatus.optional(),
  accountId: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  dueBefore: z.string().optional(),
  dueAfter: z.string().optional(),
  sortBy: z.enum(['createdAt', 'dueDate', 'total']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

export const paymentCreateSchema = z.object({
  invoiceId: z.string(),
  amount: z.coerce.number().min(0.01).max(1e10),
  currency: z.string().length(3).default('INR'),
  method: z.enum(['upi', 'card', 'net_banking', 'bank_transfer', 'cash', 'cheque', 'other']).optional().default('upi'),
  status: z.enum(['pending', 'success', 'failed', 'refunded', 'partial_refund']).optional().default('pending'),
  transactionReference: safeTextOptional(100),
  providerPaymentId: safeTextOptional(100),
  paidAt: z.string().datetime().optional(),
  failureReason: safeTextOptional(500),
})

export const paymentListSchema = paginationSchema.extend({
  accountId: z.string().optional(),
  invoiceId: z.string().optional(),
  status: z.enum(['pending', 'success', 'failed', 'refunded', 'partial_refund']).optional(),
  method: z.string().optional(),
})
