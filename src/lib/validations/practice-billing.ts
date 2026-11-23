/** Practice (therapist) subscription checkout payloads. Only Razorpay ids — never card or bank data. */
import { z } from 'zod'

const razorpayId = (prefix: string) =>
  z.string().trim().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{6,40}$`), 'Invalid id')

export const checkoutStartSchema = z.object({
  planId: z.string().trim().min(1).max(100),
  interval: z.enum(['monthly', 'annual']),
})

export const checkoutVerifySchema = z.object({
  razorpayPaymentId: razorpayId('pay'),
  razorpaySubscriptionId: razorpayId('sub'),
  razorpaySignature: z.string().trim().regex(/^[a-f0-9]{64}$/, 'Invalid signature'),
})
