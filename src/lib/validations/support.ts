/**
 * Support module validation: tickets, comments, SLA.
 */

import { z } from 'zod'
import {
  safeText,
  safeTextOptional,
  longText,
  longTextOptional,
  tagsSchema,
  paginationSchema,
} from './common'

export const ticketPriority = z.enum(['low', 'normal', 'high', 'urgent'])
export const ticketStatus = z.enum(['new', 'open', 'pending_customer', 'pending_internal', 'resolved', 'closed'])
export const ticketSource = z.enum(['email', 'portal', 'phone', 'whatsapp', 'internal'])
export const commentVisibility = z.enum(['internal', 'customer'])

/** SLA hours by priority — configurable per organisation (defaults here) */
export const SLA_HOURS: Record<string, { firstResponse: number; resolution: number }> = {
  low: { firstResponse: 24, resolution: 96 },
  normal: { firstResponse: 8, resolution: 48 },
  high: { firstResponse: 4, resolution: 24 },
  urgent: { firstResponse: 1, resolution: 8 },
}

export const ticketCreateSchema = z.object({
  accountId: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
  subject: safeText(200),
  description: longText(10_000),
  category: safeTextOptional(100),
  subcategory: safeTextOptional(100),
  priority: ticketPriority.default('normal'),
  source: ticketSource.default('portal'),
  assignedToUserId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  tags: tagsSchema,
  internalNotes: longTextOptional(5000),
})

export const ticketUpdateSchema = z.object({
  subject: safeText(200).optional(),
  description: longText().optional(),
  category: safeTextOptional(100),
  subcategory: safeTextOptional(100),
  priority: ticketPriority.optional(),
  status: ticketStatus.optional(),
  assignedToUserId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  satisfactionScore: z.coerce.number().int().min(1).max(5).optional().nullable(),
  tags: tagsSchema,
  internalNotes: longTextOptional(5000),
})

export const ticketListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: ticketStatus.optional(),
  priority: ticketPriority.optional(),
  assignedToUserId: z.string().optional(),
  teamId: z.string().optional(),
  accountId: z.string().optional(),
  slaStatus: z.enum(['on_time', 'at_risk', 'breached']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'priority', 'slaStatus', 'status']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

export const ticketCommentCreateSchema = z.object({
  body: longText(10_000),
  visibility: commentVisibility.default('customer'),
  attachments: z
    .array(z.object({
      fileName: safeText(255),
      fileSize: z.number().int().min(1).max(20 * 1024 * 1024),
      mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/).max(100),
      storageKey: safeText(500),
    }))
    .max(10)
    .optional(),
})

/** Compute SLA due dates from priority and open time */
export function computeSlaDueDates(priority: string, from: Date = new Date()): {
  firstResponseDueAt: Date
  resolutionDueAt: Date
} {
  const sla = SLA_HOURS[priority] ?? SLA_HOURS.normal
  return {
    firstResponseDueAt: new Date(from.getTime() + sla.firstResponse * 3600 * 1000),
    resolutionDueAt: new Date(from.getTime() + sla.resolution * 3600 * 1000),
  }
}

/** SLA status: at-risk when >75% of window elapsed without response, breached when overdue */
export function computeSlaStatus(
  ticket: { firstResponseDueAt?: Date | null; resolutionDueAt?: Date | null; firstRespondedAt?: Date | null; resolvedAt?: Date | null },
  now: Date = new Date()
): 'on_time' | 'at_risk' | 'breached' {
  const deadline = ticket.firstRespondedAt ? ticket.firstResponseDueAt : ticket.resolutionDueAt
  if (!deadline) return 'on_time'
  if (ticket.resolvedAt) return 'on_time'
  if (now > deadline) return 'breached'
  // at-risk inside last 25% of window
  return 'at_risk'
}
