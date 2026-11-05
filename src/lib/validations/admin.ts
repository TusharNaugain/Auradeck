/**
 * Admin/module validation: organisations, teams, users, onboarding, success plans, settings,
 * tasks, notifications, automations.
 */

import { z } from 'zod'
import {
  emailSchema,
  phoneSchema,
  safeText,
  safeTextOptional,
  longText,
  longTextOptional,
  tagsSchema,
  customFieldsSchema,
  paginationSchema,
  urlSchema,
} from './common'

/* ---------- Organisations ---------- */

export const organisationUpdateSchema = z.object({
  legalName: safeText(200).optional(),
  displayName: safeText(150).optional(),
  practiceName: safeTextOptional(150),
  logoUrl: urlSchema,
  website: urlSchema,
  description: longTextOptional(2000),
  industry: safeTextOptional(100),
  practiceType: safeTextOptional(100),
  registrationNumber: safeTextOptional(100),
  taxNumber: safeTextOptional(20), // encrypted at rest, masked in responses
  primaryEmail: emailSchema.optional(),
  primaryPhone: phoneSchema.optional(),
  alternatePhone: phoneSchema.optional().nullable(),
  addressLine1: safeTextOptional(200),
  addressLine2: safeTextOptional(200),
  city: safeTextOptional(100),
  state: safeTextOptional(100),
  postalCode: safeTextOptional(10),
  timezone: z.string().max(50).optional(),
  currency: z.string().max(3).optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD']).optional(),
  language: z.string().max(10).optional(),
  status: z.enum(['prospect', 'trial', 'onboarding', 'active', 'paused', 'churned', 'archived']).optional(),
  lifecycleStage: safeTextOptional(50),
  leadSource: safeTextOptional(50),
  referralPartner: safeTextOptional(150),
  onboardingStartDate: z.string().datetime().optional().nullable(),
  goLiveDate: z.string().datetime().optional().nullable(),
  renewalDate: z.string().datetime().optional().nullable(),
  churnReason: safeTextOptional(500),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

/* ---------- Teams ---------- */

export const teamType = z.enum(['sales', 'csm', 'support', 'finance', 'operations', 'management'])

export const teamCreateSchema = z.object({
  name: safeText(100),
  description: longTextOptional(500),
  teamType: teamType,
  managerUserId: z.string().optional().nullable(),
})

export const teamUpdateSchema = teamCreateSchema.partial()
export const teamListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  teamType: teamType.optional(),
})

/* ---------- Users ---------- */

export const inviteUserSchema = z.object({
  email: emailSchema,
  roleSlug: z.string().min(2).max(50),
  teamId: z.string().optional().nullable(),
  scopeType: z.enum(['own', 'assigned', 'team', 'organisation']).optional(),
  firstName: safeText(50).optional(),
  lastName: safeText(50).optional(),
})

export const updateUserSchema = z.object({
  fullName: safeText(100).optional(),
  firstName: safeText(50).optional(),
  lastName: safeText(50).optional(),
  jobTitle: safeTextOptional(100),
  department: safeTextOptional(100),
  phoneCountryCode: safeTextOptional(5),
  phoneNumber: phoneSchema.optional().nullable(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  notificationPreferences: z.record(z.any()).optional(),
})

export const userListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: z.enum(['invited', 'active', 'suspended', 'deactivated']).optional(),
  organisationId: z.string().optional(),
})

/* ---------- Onboarding ---------- */

export const onboardingStatus = z.enum(['not_started', 'scheduled', 'in_progress', 'blocked', 'ready_for_go_live', 'completed', 'cancelled'])
export const onboardingTaskStatus = z.enum(['todo', 'in_progress', 'blocked', 'done', 'skipped'])

export const onboardingCreateSchema = z.object({
  accountId: z.string(),
  onboardingTemplateId: z.string().optional().nullable(),
  projectName: safeText(200),
  status: onboardingStatus.optional().default('not_started'),
  kickoffDate: z.string().datetime().optional().nullable(),
  targetGoLiveDate: z.string().datetime().optional().nullable(),
  implementationOwnerId: z.string().optional().nullable(),
  csmOwnerId: z.string().optional().nullable(),
  currentPhase: safeTextOptional(100),
  blockers: longTextOptional(2000),
  successCriteria: longTextOptional(2000),
  dataMigrationRequired: z.boolean().optional().default(false),
  trainingRequired: z.boolean().optional().default(false),
  integrationRequired: z.boolean().optional().default(false),
  notes: longTextOptional(5000),
})

export const onboardingUpdateSchema = z.object({
  projectName: safeText(200).optional(),
  status: onboardingStatus.optional(),
  kickoffDate: z.string().datetime().optional().nullable(),
  targetGoLiveDate: z.string().datetime().optional().nullable(),
  actualGoLiveDate: z.string().datetime().optional().nullable(),
  implementationOwnerId: z.string().optional().nullable(),
  csmOwnerId: z.string().optional().nullable(),
  currentPhase: safeTextOptional(100),
  blockers: longTextOptional(2000),
  successCriteria: longTextOptional(2000),
  dataMigrationRequired: z.boolean().optional(),
  trainingRequired: z.boolean().optional(),
  integrationRequired: z.boolean().optional(),
  notes: longTextOptional(5000),
  progressPercentage: z.coerce.number().int().min(0).max(100).optional(),
})

export const onboardingListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: onboardingStatus.optional(),
  accountId: z.string().optional(),
  implementationOwnerId: z.string().optional(),
  csmOwnerId: z.string().optional(),
})

export const onboardingTaskCreateSchema = z.object({
  onboardingId: z.string(),
  title: safeText(200),
  description: longTextOptional(2000),
  phase: safeTextOptional(100),
  assignedToUserId: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  dependencyTaskId: z.string().optional().nullable(),
  order: z.number().int().min(0).optional(),
})

export const onboardingTaskUpdateSchema = z.object({
  title: safeText(200).optional(),
  description: longTextOptional(2000),
  phase: safeTextOptional(100),
  assignedToUserId: z.string().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable(),
  status: onboardingTaskStatus.optional(),
  dependencyTaskId: z.string().optional().nullable(),
  completionNote: longTextOptional(1000).optional(),
})

/* ---------- Success plans ---------- */

export const successPlanCreateSchema = z.object({
  accountId: z.string(),
  ownerUserId: z.string().optional().nullable(),
  objective: safeText(500),
  targetOutcome: longTextOptional(1000),
  metricName: safeTextOptional(100),
  baselineValue: z.coerce.number().optional().nullable(),
  targetValue: z.coerce.number().optional().nullable(),
  currentValue: z.coerce.number().optional().nullable(),
  targetDate: z.string().datetime().optional().nullable(),
  status: z.enum(['draft', 'active', 'achieved', 'cancelled']).optional().default('active'),
  risks: longTextOptional(2000),
  nextReviewDate: z.string().datetime().optional().nullable(),
  notes: longTextOptional(5000),
})

export const successPlanUpdateSchema = successPlanCreateSchema.partial().extend({
  progressPercentage: z.coerce.number().int().min(0).max(100).optional(),
  currentValue: z.coerce.number().optional(),
})

export const successPlanListSchema = paginationSchema.extend({
  accountId: z.string().optional(),
  status: z.enum(['draft', 'active', 'achieved', 'cancelled']).optional(),
})

/* ---------- Tasks ---------- */

export const taskStatus = z.enum(['todo', 'in_progress', 'blocked', 'done', 'cancelled'])
export const taskPriority = z.enum(['low', 'normal', 'high', 'urgent'])

export const taskCreateSchema = z.object({
  title: safeText(255),
  description: longTextOptional(5000),
  taskType: safeTextOptional(50),
  status: taskStatus.optional().default('todo'),
  priority: taskPriority.optional().default('normal'),
  dueAt: z.string().datetime().optional().nullable(),
  ownerUserId: z.string().optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  relatedEntityType: z.enum(['lead', 'account', 'contact', 'opportunity', 'ticket', 'onboarding', 'client']).optional().nullable(),
  relatedEntityId: z.string().optional().nullable(),
  recurrenceRule: safeTextOptional(100),
})

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  completedAt: z.string().datetime().optional().nullable(),
})

export const taskListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: taskStatus.optional(),
  priority: taskPriority.optional(),
  assignedToUserId: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  dueBefore: z.string().datetime().optional(),
  dueAfter: z.string().datetime().optional(),
  sortBy: z.enum(['createdAt', 'dueAt', 'priority']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Notifications ---------- */

export const notificationCreateSchema = z.object({
  userId: z.string(),
  type: safeText(50),
  title: safeText(255),
  message: longText(1000),
  severity: z.enum(['info', 'success', 'warning', 'error']).optional().default('info'),
  actionUrl: z.string().max(500).optional().nullable(),
})

/* ---------- Automations ---------- */

export const automationTriggerSchema = z.enum([
  'LEAD_CREATED',
  'LEAD_STAGE_CHANGED',
  'OPPORTUNITY_STAGE_CHANGED',
  'OPPORTUNITY_WON',
  'TICKET_CREATED',
  'TICKET_OVERDUE',
  'ONBOARDING_BLOCKED',
  'HEALTH_SCORE_CHANGED',
  'RENEWAL_APPROACHING',
  'TASK_OVERDUE',
  'CUSTOM',
])

export const automationCreateSchema = z.object({
  name: safeText(200),
  description: longTextOptional(1000),
  trigger: automationTriggerSchema,
  conditions: z
    .array(z.object({ field: safeText(100), operator: z.enum(['equals', 'not_equals', 'in', 'contains', 'greater_than', 'less_than']), value: z.unknown() }))
    .max(10)
    .optional(),
  actions: z
    .array(z.object({ type: z.enum(['create_task', 'notify', 'assign_user', 'move_stage']), payload: z.record(z.any()) }))
    .max(5)
    .min(1),
  delaySeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
  status: z.enum(['active', 'inactive', 'draft']).optional().default('draft'),
})

export const automationUpdateSchema = automationCreateSchema.partial()
