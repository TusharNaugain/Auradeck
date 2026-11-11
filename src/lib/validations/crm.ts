/**
 * CRM entity validation schemas: leads, contacts, opportunities, activities, accounts, campaigns.
 */

import { z } from 'zod'
import {
  emailSchema,
  phoneSchema,
  safeText,
  safeTextOptional,
  longText,
  longTextOptional,
  urlSchema,
  tagsSchema,
  customFieldsSchema,
  dateRangeSchema,
} from './common'
import { paginationSchema } from './common'

/* ---------- Leads ---------- */

export const leadSource = z.enum(['website', 'referral', 'partner', 'campaign', 'inbound_call', 'whatsapp', 'social', 'event', 'import', 'other'])
export const leadLifecycleStage = z.enum(['new', 'contacted', 'qualified', 'demo_booked', 'proposal_sent', 'negotiation', 'converted', 'lost', 'disqualified'])
export const preferredContactMethod = z.enum(['email', 'phone', 'whatsapp', 'sms'])

export const leadCreateObject = z.object({
  firstName: safeText(50),
  lastName: safeText(50),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  alternatePhone: phoneSchema.optional().nullable(),
  whatsappNumber: phoneSchema.optional().nullable(),
  organisationName: safeTextOptional(150),
  jobTitle: safeTextOptional(100),
  website: z.string().trim().max(300).optional().nullable(),
  city: safeTextOptional(100),
  state: safeTextOptional(100),
  country: safeTextOptional(2),
  leadSource: leadSource.default('other'),
  sourceDetail: safeTextOptional(255),
  campaignId: z.string().optional().nullable(),
  qualificationStatus: z.string().max(50).optional().nullable(),
  estimatedPracticeSize: z.string().max(50).optional().nullable(),
  estimatedUsers: z.coerce.number().int().min(0).max(100000).optional().nullable(),
  currentSoftware: safeTextOptional(150),
  painPoints: longText().optional().nullable(),
  useCase: longText().optional().nullable(),
  budgetRange: z.string().max(50).optional().nullable(),
  expectedTimeline: z.string().max(50).optional().nullable(),
  preferredContactMethod: preferredContactMethod.optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  assignedTeamId: z.string().optional().nullable(),
  nextFollowUpAt: z.string().datetime().optional().nullable(),
  consentStatus: z.string().max(50).optional().nullable(),
  consentSource: z.string().max(200).optional().nullable(),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

export const leadCreateSchema = leadCreateObject.superRefine((data, ctx) => {
  // At least one contact method
  if (!data.email && !data.phone && !data.whatsappNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Provide at least an email, phone or WhatsApp number' })
  }
})

export const leadUpdateSchema = leadCreateObject.partial().extend({
  lifecycleStage: leadLifecycleStage.optional(),
  isPriority: z.boolean().optional(),
})
export const leadListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  source: leadSource.optional(),
  stage: leadLifecycleStage.optional(),
  priority: z.enum(['priority', 'others']).optional(),
  /** Default (omitted) hides dead leads; 'pipeline' also hides converted ones; 'dead' shows only dead. An explicit `stage` wins. */
  view: z.enum(['active', 'pipeline', 'dead']).optional(),
  assignedToUserId: z.string().optional(),
  assignedTeamId: z.string().optional(),
  tags: z.string().optional(), // comma-separated
  dateRange: dateRangeSchema,
  sortBy: z.enum(['createdAt', 'leadScore', 'nextFollowUpAt', 'firstName', 'lastName']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Contacts ---------- */

export const contactType = z.enum(['owner', 'decision_maker', 'admin', 'therapist', 'finance', 'receptionist', 'champion', 'end_user', 'other'])

export const contactCreateSchema = z.object({
  accountId: z.string().optional().nullable(),
  firstName: safeText(50),
  lastName: safeText(50),
  preferredName: safeTextOptional(50),
  email: emailSchema.optional(),
  secondaryEmail: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  whatsappNumber: phoneSchema.optional().nullable(),
  jobTitle: safeTextOptional(100),
  department: safeTextOptional(100),
  contactType: contactType.default('other'),
  isPrimary: z.boolean().optional().default(false),
  isDecisionMaker: z.boolean().optional().default(false),
  influenceLevel: z.enum(['low', 'medium', 'high']).optional().nullable(),
  preferredLanguage: safeTextOptional(50),
  preferredContactMethod: preferredContactMethod.optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  linkedinUrl: urlSchema,
  notes: longText().optional().nullable(),
  consentStatus: z.string().max(50).optional().nullable(),
  doNotContact: z.boolean().optional().default(false),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

export const contactUpdateSchema = contactCreateSchema.partial()
export const contactListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  accountId: z.string().optional(),
  contactType: contactType.optional(),
  isDecisionMaker: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'fullName', 'email']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Opportunities ---------- */

export const opportunityType = z.enum(['new_business', 'expansion', 'renewal', 'cross_sell', 'upsell'])
export const opportunityStage = z.enum(['discovery', 'qualified', 'demo', 'solution_fit', 'proposal', 'negotiation', 'verbal_commit', 'won', 'lost'])
export const forecastCategory = z.enum(['pipeline', 'best_case', 'commit', 'closed'])

/** Stage -> default probability (%). Configurable via OrganisationSettings.customFields or admin config later. */
export const DEFAULT_STAGE_PROBABILITY: Record<string, number> = {
  discovery: 10,
  qualified: 20,
  demo: 40,
  solution_fit: 50,
  proposal: 60,
  negotiation: 75,
  verbal_commit: 90,
  won: 100,
  lost: 0,
}

export const opportunityCreateSchema = z.object({
  accountId: z.string().optional().nullable(),
  primaryContactId: z.string().optional().nullable(),
  name: safeText(200),
  type: opportunityType.default('new_business'),
  stage: opportunityStage.default('discovery'),
  amount: z.coerce.number().min(0).max(1e12),
  currency: z.string().length(3).default('INR'),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  contractStartDate: z.string().datetime().optional().nullable(),
  contractEndDate: z.string().datetime().optional().nullable(),
  planId: z.string().optional().nullable(),
  seatsOrUsers: z.coerce.number().int().min(1).optional().nullable(),
  billingFrequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annual']).optional().nullable(),
  nextStep: safeTextOptional(500),
  competitor: safeTextOptional(150),
  source: safeTextOptional(100),
  ownerUserId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  forecastCategory: forecastCategory.optional().default('pipeline'),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

export const opportunityUpdateSchema = z.object({
  accountId: z.string().optional().nullable(),
  primaryContactId: z.string().optional().nullable(),
  name: safeText(200).optional(),
  type: opportunityType.optional(),
  stage: opportunityStage.optional(),
  amount: z.coerce.number().min(0).max(1e12).optional(),
  currency: z.string().length(3).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedCloseDate: z.string().datetime().optional().nullable(),
  contractStartDate: z.string().datetime().optional().nullable(),
  contractEndDate: z.string().datetime().optional().nullable(),
  planId: z.string().optional().nullable(),
  seatsOrUsers: z.coerce.number().int().min(1).optional().nullable(),
  billingFrequency: z.enum(['monthly', 'quarterly', 'half_yearly', 'annual']).optional().nullable(),
  nextStep: safeTextOptional(500),
  competitor: safeTextOptional(150),
  lossReason: safeTextOptional(300).optional(),
  source: safeTextOptional(100).optional(),
  ownerUserId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  forecastCategory: forecastCategory.optional(),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

export const opportunityListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  accountId: z.string().optional(),
  stage: opportunityStage.optional(),
  type: opportunityType.optional(),
  forecastCategory: forecastCategory.optional(),
  ownerUserId: z.string().optional(),
  teamId: z.string().optional(),
  dateRange: dateRangeSchema,
  sortBy: z.enum(['createdAt', 'amount', 'expectedCloseDate', 'stage']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/** Compute weighted amount server-side */
export function computeWeightedAmount(amount: number, probability: number): number {
  return Math.round(amount * (probability / 100) * 100) / 100
}

/* ---------- Activities ---------- */

export const activityType = z.enum(['call', 'email', 'whatsapp', 'meeting', 'demo', 'note', 'task', 'visit', 'support_followup'])
export const activityStatus = z.enum(['planned', 'completed', 'cancelled', 'no_show'])
export const activityVisibility = z.enum(['private', 'team', 'organisation'])

export const activityCreateObject = z.object({
  activityType: activityType,
  subject: safeText(255),
  description: longTextOptional(5000),
  outcome: safeTextOptional(255),
  status: activityStatus.default('planned'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
  dueAt: z.string().datetime().optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  durationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  relatedLeadId: z.string().optional().nullable(),
  relatedAccountId: z.string().optional().nullable(),
  relatedContactId: z.string().optional().nullable(),
  relatedOpportunityId: z.string().optional().nullable(),
  relatedTicketId: z.string().optional().nullable(),
  externalReference: safeTextOptional(2000),
  reminderAt: z.string().datetime().optional().nullable(),
  visibility: activityVisibility.default('team'),
  customFields: customFieldsSchema,
})

export const activityCreateSchema = activityCreateObject.superRefine((data, ctx) => {
  if (!data.relatedLeadId && !data.relatedAccountId && !data.relatedContactId && !data.relatedOpportunityId && !data.relatedTicketId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['relatedLeadId'], message: 'Activity must be related to at least one record (lead, account, contact, opportunity or ticket)' })
  }
})

export const activityUpdateSchema = activityCreateObject.partial()
export const activityListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  activityType: activityType.optional(),
  status: activityStatus.optional(),
  assignedToUserId: z.string().optional(),
  relatedLeadId: z.string().optional(),
  relatedAccountId: z.string().optional(),
  relatedContactId: z.string().optional(),
  relatedOpportunityId: z.string().optional(),
  relatedTicketId: z.string().optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
  sortBy: z.enum(['createdAt', 'dueAt', 'subject']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Accounts ---------- */

export const healthStatus = z.enum(['healthy', 'watch', 'at_risk', 'critical', 'unknown'])

export const accountCreateSchema = z.object({
  customerAccountCode: safeTextOptional(50),
  accountName: safeText(200),
  accountType: safeTextOptional(50),
  segment: safeTextOptional(50),
  lifecycleStage: safeTextOptional(50),
  ownerUserId: z.string().optional().nullable(),
  csmUserId: z.string().optional().nullable(),
  supportOwnerUserId: z.string().optional().nullable(),
  healthStatus: healthStatus.optional().default('unknown'),
  healthScore: z.coerce.number().int().min(0).max(100).optional(),
  planId: z.string().optional().nullable(),
  mrr: z.coerce.number().min(0).optional().nullable(),
  arr: z.coerce.number().min(0).optional().nullable(),
  contractValue: z.coerce.number().min(0).optional().nullable(),
  paymentStatus: safeTextOptional(50),
  renewalDate: z.string().datetime().optional().nullable(),
  nextBusinessReviewAt: z.string().datetime().optional().nullable(),
  npsScore: z.coerce.number().int().min(0).max(10).optional().nullable(),
  activeUsersCount: z.coerce.number().int().min(0).optional().nullable(),
  licensedUsersCount: z.coerce.number().int().min(0).optional().nullable(),
  expansionPotential: z.enum(['low', 'medium', 'high']).optional().nullable(),
  riskReason: longTextOptional(2000),
  competitors: safeTextOptional(300),
  strategicNotes: longTextOptional(5000),
  tags: tagsSchema,
})

export const accountUpdateSchema = accountCreateSchema.partial()

export const accountListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  healthStatus: healthStatus.optional(),
  segment: z.string().optional(),
  ownerUserId: z.string().optional(),
  csmUserId: z.string().optional(),
  renewalWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  sortBy: z.enum(['createdAt', 'accountName', 'healthScore', 'renewalDate', 'mrr']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Campaigns ---------- */

export const campaignCreateSchema = z.object({
  name: safeText(200),
  channel: safeTextOptional(50),
  objective: safeTextOptional(200),
  budget: z.coerce.number().min(0).optional().nullable(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']).optional().default('draft'),
  utmSource: safeTextOptional(100),
  utmMedium: safeTextOptional(100),
  utmCampaign: safeTextOptional(100),
  ownerUserId: z.string().optional().nullable(),
})

export const campaignUpdateSchema = campaignCreateSchema.partial()
