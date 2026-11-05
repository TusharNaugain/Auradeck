/**
 * Practice module validation: clients (privacy-controlled), appointments, clinical notes.
 * Client PII fields are protected by separate permissions — see clients.view_pii.
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
} from './common'

export const clientStatus = z.enum(['enquiry', 'active', 'inactive', 'discharged', 'archived'])

export const clientCreateSchema = z.object({
  firstName: safeText(50),
  lastName: safeText(50),
  preferredName: safeTextOptional(50),
  dateOfBirth: z.string().datetime().optional().nullable(),
  gender: safeTextOptional(30),
  pronouns: safeTextOptional(30),
  email: emailSchema.optional().nullable(),
  phone: phoneSchema.optional().nullable(),
  emergencyContactName: safeTextOptional(100),
  emergencyContactPhone: phoneSchema.optional().nullable(),
  address: z
    .object({
      line1: z.string().max(200).optional(),
      line2: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      postalCode: z.string().max(10).optional(),
      country: z.string().max(50).optional(),
    })
    .optional()
    .nullable(),
  referralSource: safeTextOptional(150),
  assignedPractitionerId: z.string().optional().nullable(),
  status: clientStatus.optional().default('enquiry'),
  consentStatus: safeTextOptional(50),
  communicationPreferences: z
    .object({
      email: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      sms: z.boolean().optional(),
      reminderHoursBefore: z.number().int().min(0).max(72).optional(),
    })
    .optional(),
  tags: tagsSchema,
  customFields: customFieldsSchema,
})

export const clientUpdateSchema = clientCreateSchema.partial()

export const clientListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  status: clientStatus.optional(),
  assignedPractitionerId: z.string().optional(),
  hasOutstandingBalance: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['createdAt', 'firstName', 'lastName', 'lastAppointmentAt', 'outstandingBalance']).optional().default('createdAt'),
  sort: z.enum(['asc', 'desc']).default('desc'),
})

/* ---------- Appointments ---------- */

export const appointmentStatus = z.enum(['scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'])

export const appointmentCreateObject = z.object({
  clientId: z.string(),
  practitionerId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  appointmentType: safeText(100),
  status: appointmentStatus.optional().default('scheduled'),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  timezone: z.string().max(50).optional().default('Asia/Kolkata'),
  notesVisibility: z.enum(['practitioner', 'front_desk', 'all']).optional().default('practitioner'),
  paymentStatus: z.enum(['pending', 'paid', 'partially_paid', 'free', 'insurance']).optional(),
  notes: longTextOptional(2000),
})

export const appointmentCreateSchema = appointmentCreateObject.superRefine((data, ctx) => {
  const start = new Date(data.startAt).getTime()
  const end = new Date(data.endAt).getTime()
  if (isNaN(start) || isNaN(end)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startAt'], message: 'Invalid dates' })
    return
  }
  if (end <= start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'endAt must be after startAt' })
  }
  if (end - start > 12 * 3600 * 1000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAt'], message: 'Appointment cannot exceed 12 hours' })
  }
})

export const appointmentUpdateSchema = appointmentCreateObject.partial()

export const appointmentListSchema = paginationSchema.extend({
  search: z.string().trim().max(200).optional(),
  clientId: z.string().optional(),
  practitionerId: z.string().optional(),
  status: z.enum(['scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'upcoming', 'today']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const practitionerSelfSchema = z.object({
  practitionerId: z.string().min(1),
})

/**
 * Boolean: can caller see appointment notes/write clinical content?
 * Enforced at service layer via role check, using appointment.notesVisibility.
 */

/* ---------- Clinical Notes (separate protected module) ---------- */

export const clinicalNoteCreateSchema = z.object({
  clientId: z.string(),
  noteType: safeText(50),
  content: longText(50_000),
  sessionDate: z.string().datetime().optional(),
  isConfidential: z.boolean().optional().default(true),
})

export const clinicalNoteUpdateSchema = z.object({
  noteType: safeText(50).optional(),
  content: longText(50_000).optional(),
  sessionDate: z.string().datetime().optional(),
  isConfidential: z.boolean().optional(),
})
