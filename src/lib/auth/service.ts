/**
 * Authentication service: all real flows, no mocks.
 * - register (optional practice organisation creation)
 * - login with progressive delay + MFA
 * - forgot/reset password (single-use hashed tokens)
 * - email verification
 * - invitation acceptance
 * Failures are logged with hashed IPs; messages are generic to avoid enumeration.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from '@/lib/auth/password'
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
  createEmailVerificationToken,
  verifyEmailVerificationToken,
  hashToken,
} from '@/lib/auth/tokens'
import {
  checkLoginAllowed,
  recordLoginAttempt,
  applyLoginDelay,
} from '@/lib/auth/login-guard'
import { verifyTotpToken, verifyAndConsumeRecoveryCode } from '@/lib/auth/mfa'
import { createSession, revokeAllSessions } from '@/lib/auth/session'
import { createAuditLog } from '@/lib/audit'
import { logger } from '@/lib/utils/logger'
import { sendTemplatedEmail, passwordResetEmail, emailVerificationEmail, invitationEmail, appUrl } from '@/lib/email'
import { slugify } from '@/lib/utils/slugify'
import type { LoginInput, RegisterInput } from '@/lib/validations/auth'

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

const REQUEST_CONTEXT: { requestId?: string; ipHash?: string; userAgentHash?: string } = {}

export function setRequestContext(ctx: { requestId?: string; ipHash?: string; userAgentHash?: string }) {
  Object.assign(REQUEST_CONTEXT, ctx)
}

function audit(params: Parameters<typeof createAuditLog>[0]) {
  return createAuditLog({ requestId: REQUEST_CONTEXT.requestId, ...params })
}

/* ---------------- Register ---------------- */

export interface RegisterResult {
  userId: string
  organisationId: string
  verificationToken: string
}

export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const existing = await db.user.findUnique({ where: { email: input.email }, select: { id: true } })
  if (existing) {
    // Deliberately ambiguous to prevent user enumeration
    throw new AuthError('REGISTRATION_FAILED', 'Unable to create the account with these details.', 400)
  }

  const strengthErrors = validatePasswordStrength(input.password)
  if (strengthErrors.length > 0) {
    throw new AuthError('WEAK_PASSWORD', strengthErrors.join('; '), 400)
  }

  const passwordHash = await hashPassword(input.password)

  try {
    // Create user, credentials, organisation (if provided) + owner membership atomically
    const { user, organisation } = await db.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          fullName: input.fullName,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email.toLowerCase(),
          status: 'INVITED',
        },
      })

      await tx.userCredential.create({
        data: { userId: newUser.id, passwordHash },
      })

      const orgName = input.organisation?.displayName ?? `${input.firstName} ${input.lastName}`
      const slug = `${slugify(input.organisation?.displayName ?? input.fullName)}-${crypto.randomUUID().slice(0, 6)}`

      const newOrganisation = await tx.organisation.create({
        data: {
          type: 'CUSTOMER_PRACTICE',
          legalName: orgName,
          displayName: input.organisation?.displayName ?? `${input.firstName} ${input.lastName}`,
          slug,
          practiceType: input.organisation?.practiceType,
          city: input.organisation?.city,
          primaryEmail: input.email.toLowerCase(),
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          dateFormat: 'DD/MM/YYYY',
          language: 'en',
          status: 'TRIAL',
          ownerUserId: newUser.id,
          lifecycleStage: 'trial',
        },
      })

      const role = await tx.role.findUnique({ where: { slug: 'practice_owner' } })
      if (!role) throw new Error('ROLE_NOT_SYNCED')

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organisationId: newOrganisation.id,
          roleId: role.id,
          status: 'ACTIVE',
          isPrimary: true,
          acceptedAt: new Date(),
          scopeType: 'ORGANISATION',
        },
      })

      return { user: newUser, organisation: newOrganisation }
    })

    const verificationToken = await createEmailVerificationToken(user.id)

    await audit({
      actorUserId: user.id,
      actorType: 'user',
      action: 'auth.register',
      resourceType: 'user',
      resourceId: user.id,
      organisationId: organisation.id,
    })

    await sendTemplatedEmail(
      user.email,
      emailVerificationEmail(`${appUrl}/verify-email?token=${verificationToken}`)
    )

    return {
      userId: user.id,
      organisationId: organisation.id,
      verificationToken,
    }
  } catch (error) {
    logger.error('Registration failed', { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}

/* ---------------- Login ---------------- */

export interface LoginResult {
  status: 'ok' | 'mfa_required'
  mfaPending?: boolean
  organisationId?: string
}

export async function login(input: LoginInput, ctx: { ipHash: string; userAgent: string }): Promise<LoginResult> {
  const guard = await checkLoginAllowed(input.email, ctx.ipHash)
  await applyLoginDelay(guard.delayMs)

  if (!guard.allowed) {
    await recordLoginAttempt(input.email, ctx.ipHash, null, false, 'locked_out')
    await audit({
      action: 'auth.login_denied',
      resourceType: 'auth',
      reason: `Locked out: ${input.email}`,
    })
    throw new AuthError('LOGIN_LOCKED_OUT', 'Too many failed attempts. Please reset your password or try again in a few minutes.', 429)
  }

  const user = await db.user.findUnique({
    where: { email: input.email },
    select: {
      id: true,
      status: true,
      credentials: { select: { passwordHash: true, id: true } },
      mfaEnabled: true,
    },
  })

  if (!user || !user.credentials) {
    // Delay to avoid timing-based enumeration
    await applyLoginDelay(200)
    await recordLoginAttempt(input.email, ctx.ipHash, null, false, 'unknown_user_or_bad_password')
    throw new AuthError('AUTH_FAILED', 'Invalid email or password.', 401)
  }

  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    await recordLoginAttempt(input.email, ctx.ipHash, user.id, false, `status_${user.status}`)
    throw new AuthError('ACCOUNT_DISABLED', 'This account has been disabled. Contact your administrator.', 403)
  }

  const ok = await verifyPassword(user.credentials.passwordHash, input.password)
  if (!ok) {
    await recordLoginAttempt(input.email, ctx.ipHash, user.id, false, 'bad_password')
    throw new AuthError('AUTH_FAILED', 'Invalid email or password.', 401)
  }

  // MFA challenge when enabled
  if (user.mfaEnabled) {
    if (!input.mfaToken && !input.recoveryCode) {
      await recordLoginAttempt(input.email, ctx.ipHash, user.id, false, 'mfa_required')
      return { status: 'mfa_required', mfaPending: true }
    }
    const mfaSecret = await db.mfaSecret.findFirst({
      where: { userId: user.id, isActive: true },
      select: { secret: true },
    })
    if (!mfaSecret) {
      throw new AuthError('MFA_MISCONFIGURED', 'MFA setup is incomplete. Contact support.', 500)
    }
    let mfaOk = false
    if (input.mfaToken) {
      mfaOk = verifyTotpToken(mfaSecret.secret, input.mfaToken)
    } else if (input.recoveryCode) {
      mfaOk = await verifyAndConsumeRecoveryCode(user.id, input.recoveryCode)
    }
    if (!mfaOk) {
      await recordLoginAttempt(input.email, ctx.ipHash, user.id, false, 'mfa_failed')
      await audit({
        action: 'auth.mfa_failed',
        resourceType: 'auth',
        actorUserId: user.id,
        reason: 'Bad MFA token/recovery code',
      })
      throw new AuthError('MFA_FAILED', 'Invalid or expired multi-factor code.', 401)
    }
  }

  const membership = await db.membership.findFirst({
    where: { userId: user.id, status: 'ACTIVE' },
    orderBy: { isPrimary: 'desc' },
    select: { organisationId: true },
  })

  await createSession(user.id, membership?.organisationId ?? undefined, {
    userAgent: ctx.userAgent,
    ipAddress: undefined,
  })

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
  await recordLoginAttempt(input.email, ctx.ipHash, user.id, true)
  await audit({
    actorUserId: user.id,
    action: 'auth.login_success',
    resourceType: 'auth',
    resourceId: user.id,
  })

  // First successful login after invitation activates account
  if (user.status === 'INVITED') {
    await db.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } }).catch(() => {})
  }

  return { status: 'ok', organisationId: membership?.organisationId ?? undefined }
}

/* ---------------- Forgot / Reset password ---------------- */

export async function forgotPassword(email: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, fullName: true } })
  if (!user) {
    // Silent success to avoid enumeration
    return
  }

  const token = await createPasswordResetToken(user.id, 60)
  const url = `${appUrl}/reset-password?token=${token}`
  const sent = await sendTemplatedEmail(email, passwordResetEmail(url))

  await audit({
    actorUserId: user.id,
    action: 'auth.password_reset_requested',
    resourceType: 'user',
    resourceId: user.id,
    reason: sent ? 'Email sent' : 'Email delivery failed',
  })
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const errors = validatePasswordStrength(newPassword)
  if (errors.length > 0) {
    throw new AuthError('WEAK_PASSWORD', errors.join('; '), 400)
  }

  const userId = await verifyPasswordResetToken(token)
  if (!userId) {
    // Same error for bad/expired/used tokens
    throw new AuthError('RESET_TOKEN_INVALID', 'This reset link is invalid or has expired. Request a new one.', 400)
  }

  const passwordHash = await hashPassword(newPassword)
  await db.userCredential.update({ where: { userId }, data: { passwordHash } })
  await revokeAllSessions(userId)
  await audit({ actorUserId: userId, action: 'auth.password_reset', resourceType: 'user', resourceId: userId })
}

export async function verifyEmailToken(token: string): Promise<{ userId: string } | null> {
  const userId = await verifyEmailVerificationToken(token)
  if (!userId) return null
  await audit({ actorUserId: userId, action: 'auth.email_verified', resourceType: 'user', resourceId: userId })
  return { userId }
}

/* ---------------- Invitation acceptance ---------------- */

export async function acceptInvitation(params: {
  token: string
  password?: string
  fullName?: string
}): Promise<{ userId: string; organisationId: string }> {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(params.token) },
  })

  if (!invitation || invitation.acceptedAt || invitation.revokedAt) {
    throw new AuthError('INVITATION_INVALID', 'This invitation link is invalid or has already been used.', 400)
  }
  if (invitation.expiresAt < new Date()) {
    throw new AuthError('INVITATION_EXPIRED', 'This invitation has expired. Ask your administrator to resend it.', 400)
  }

  const password = params.password
  if (password) {
    const errors = validatePasswordStrength(password)
    if (errors.length > 0) throw new AuthError('WEAK_PASSWORD', errors.join('; '), 400)
  }

  const result = await db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } })
    if (!user) {
      const fallbackName = capitaliseWords(invitation.email.split('@')[0].replace(/[._-]+/g, ' '))
      user = await tx.user.create({
        data: {
          email: invitation.email.toLowerCase(),
          fullName: params.fullName || fallbackName,
          firstName: (params.fullName ?? fallbackName).split(' ')[0],
          lastName: (params.fullName ?? fallbackName).split(' ').slice(1).join(' '),
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
        select: { id: true },
      })
    } else {
      await tx.user.update({
        where: { id: user.id },
        data: { ...(params.fullName ? { fullName: params.fullName } : {}) },
      })
    }

    await tx.membership.upsert({
      where: {
        userId_organisationId: {
          userId: user.id,
          organisationId: invitation.organisationId,
        },
      },
      create: {
        userId: user.id,
        organisationId: invitation.organisationId,
        roleId: invitation.roleId,
        teamId: invitation.teamId ?? undefined,
        status: 'ACTIVE',
        isPrimary: false,
        acceptedAt: new Date(),
        invitedBy: invitation.invitedByUserId,
        invitedAt: invitation.createdAt,
        scopeType: 'ORGANISATION',
      },
      update: {
        status: 'ACTIVE',
        roleId: invitation.roleId,
        teamId: invitation.teamId ?? undefined,
        acceptedAt: new Date(),
      },
    })

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date(), invitedUserId: user.id },
    })

    return { userId: user.id, organisationId: invitation.organisationId }
  })

  if (password) {
    const passwordHash = await hashPassword(password)
    await db.$transaction([
      db.userCredential.upsert({
        where: { userId: result.userId },
        create: { userId: result.userId, passwordHash },
        update: { passwordHash },
      }),
      db.user.update({
        where: { id: result.userId },
        data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
      }),
    ])
  }

  await audit({
    actorUserId: result.userId,
    organisationId: result.organisationId,
    action: 'auth.invitation_accepted',
    resourceType: 'invitation',
    resourceId: invitation.id,
  })

  return result
}

export function invitationTemplate(url: string, organisationName: string, invitedByName: string) {
  return invitationEmail(url, organisationName, invitedByName)
}

function capitaliseWords(input: string): string {
  return input
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

void REQUEST_CONTEXT
