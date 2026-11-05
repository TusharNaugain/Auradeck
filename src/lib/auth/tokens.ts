/**
 * Single-use, expiring, hashed token utilities.
 * Used for email verification, password reset, and invitations.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'

const TOKEN_BYTES = 32

/**
 * Generate a cryptographically secure random token.
 * Returns both the raw token (for the email link) and its hash (for storage).
 */
export function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

/**
 * Hash a raw token for lookup.
 */
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

/**
 * Create a password reset token for a user.
 * Invalidates any existing tokens for that user.
 */
export async function createPasswordResetToken(
  userId: string,
  expiresInMinutes = 60
): Promise<string> {
  const { raw, hash } = generateToken()
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)

  // Invalidate existing tokens
  await db.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  await db.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt,
    },
  })

  return raw
}

/**
 * Verify and consume a password reset token.
 * Returns the userId if valid, null otherwise.
 */
export async function verifyPasswordResetToken(
  rawToken: string
): Promise<string | null> {
  const hash = hashToken(rawToken)

  const token = await db.passwordResetToken.findFirst({
    where: {
      tokenHash: hash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  })

  if (!token) return null

  // Mark as used immediately (single-use)
  await db.passwordResetToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  })

  return token.userId
}

/**
 * Create an email verification token for a user.
 */
export async function createEmailVerificationToken(
  userId: string,
  expiresInHours = 24
): Promise<string> {
  const { raw, hash } = generateToken()
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)

  await db.emailVerificationToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  })

  await db.emailVerificationToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt,
    },
  })

  return raw
}

/**
 * Verify and consume an email verification token.
 */
export async function verifyEmailVerificationToken(
  rawToken: string
): Promise<string | null> {
  const hash = hashToken(rawToken)

  const token = await db.emailVerificationToken.findFirst({
    where: {
      tokenHash: hash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  })

  if (!token) return null

  await db.emailVerificationToken.update({
    where: { id: token.id },
    data: { usedAt: new Date() },
  })

  // Mark user email as verified
  await db.user.update({
    where: { id: token.userId },
    data: { emailVerifiedAt: new Date() },
  })

  return token.userId
}

/**
 * Create an invitation token.
 */
export async function createInvitationToken(
  email: string,
  organisationId: string,
  roleId: string,
  invitedByUserId: string,
  teamId?: string,
  expiresInDays = 7
): Promise<{ invitationId: string; raw: string }> {
  const { raw, hash } = generateToken()
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)

  const invitation = await db.invitation.create({
    data: {
      email,
      organisationId,
      roleId,
      teamId,
      invitedByUserId,
      tokenHash: hash,
      expiresAt,
    },
  })

  return { invitationId: invitation.id, raw }
}
