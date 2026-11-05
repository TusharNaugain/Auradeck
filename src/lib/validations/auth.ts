/**
 * Auth validation schemas: login, register, password reset, MFA, invitations.
 */

import { z } from 'zod'
import { emailSchema, phoneSchema } from './common'

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
  mfaToken: z.string().regex(/^\d{6}$/).optional(),
  recoveryCode: z.string().max(20).optional(),
})

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(100),
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName: z.string().trim().min(1, 'Last name is required').max(50),
  email: emailSchema,
  phone: phoneSchema.optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  // Registration can create a new practice organisation (optional)
  organisation: z
    .object({
      displayName: z.string().trim().min(2).max(100),
      practiceType: z.string().trim().max(50).optional(),
      city: z.string().trim().max(100).optional(),
    })
    .optional(),
})

export const forgotPasswordSchema = z.object({
  email: emailSchema,
})

export const resetPasswordSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(8).max(128),
})

export const verifyEmailSchema = z.object({
  token: z.string().min(16),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
