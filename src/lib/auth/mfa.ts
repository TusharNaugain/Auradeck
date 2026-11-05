/**
 * Multi-factor authentication (TOTP) implementation.
 * Uses RFC 6238 TOTP with a 30-second window.
 */

import * as OTPAuth from 'otpauth'
import crypto from 'crypto'
import { db } from '@/lib/db'

const RECOVERY_CODE_COUNT = 10
const TOTP_ISSUER = 'AuraDeck CRM'
const TOTP_ALGORITHM = 'SHA1'
const TOTP_DIGITS = 6
const TOTP_PERIOD = 30

/**
 * Generate a new TOTP secret for a user.
 * Returns the secret and the otpauth URI for QR code generation.
 */
export function generateTotpSecret(userEmail: string): {
  secret: string
  otpauthUri: string
} {
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: userEmail,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
  })

  return {
    secret: totp.secret.base32,
    otpauthUri: totp.toString(),
  }
}

/**
 * Verify a TOTP token against a secret.
 * Allows 1 window of drift in either direction.
 */
export function verifyTotpToken(secret: string, token: string): boolean {
  try {
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(secret),
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
    })

    const delta = totp.validate({ token, window: 1 })
    return delta !== null
  } catch {
    return false
  }
}

/**
 * Generate recovery codes for a user.
 * Returns plaintext codes (shown once) and their hashes (stored).
 */
export function generateRecoveryCodes(): {
  plaintext: string[]
  hashed: string[]
} {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = crypto.randomBytes(6).toString('hex').toUpperCase()
    // Format as XXXX-XXXX-XXXX
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
  })

  const hashed = codes.map(code =>
    crypto.createHash('sha256').update(code).digest('hex')
  )

  return { plaintext: codes, hashed }
}

/**
 * Verify a recovery code for a user.
 * Consumes the code if valid (one-time use).
 */
export async function verifyAndConsumeRecoveryCode(
  userId: string,
  code: string
): Promise<boolean> {
  const normalizedCode = code.trim().toUpperCase().replace(/\s/g, '')
  const codeHash = crypto.createHash('sha256').update(normalizedCode).digest('hex')

  const mfaSecret = await db.mfaSecret.findFirst({
    where: {
      userId,
      isActive: true,
    },
  })

  if (!mfaSecret) return false

  const recoveryCodeIndex = mfaSecret.recoveryCodes.indexOf(codeHash)
  if (recoveryCodeIndex === -1) return false

  // Remove the used code
  const updatedCodes = [...mfaSecret.recoveryCodes]
  updatedCodes.splice(recoveryCodeIndex, 1)

  await db.mfaSecret.update({
    where: { id: mfaSecret.id },
    data: { recoveryCodes: updatedCodes },
  })

  return true
}

/**
 * Enable MFA for a user after verifying the setup token.
 */
export async function enableMfa(
  userId: string,
  secret: string,
  verificationToken: string,
  recoveryCodes: string[]
): Promise<boolean> {
  if (!verifyTotpToken(secret, verificationToken)) {
    return false
  }

  // Deactivate any existing MFA secrets
  await db.mfaSecret.updateMany({
    where: { userId },
    data: { isActive: false },
  })

  await db.mfaSecret.create({
    data: {
      userId,
      secret,
      recoveryCodes,
      isActive: true,
      verifiedAt: new Date(),
    },
  })

  await db.user.update({
    where: { id: userId },
    data: { mfaEnabled: true },
  })

  return true
}

/**
 * Disable MFA for a user.
 */
export async function disableMfa(userId: string): Promise<void> {
  await db.mfaSecret.updateMany({
    where: { userId },
    data: { isActive: false },
  })

  await db.user.update({
    where: { id: userId },
    data: { mfaEnabled: false },
  })
}
