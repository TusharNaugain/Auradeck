/**
 * Password hashing and verification using Argon2id.
 * Argon2id is recommended by OWASP for password hashing (2024).
 */

import argon2 from 'argon2'

// Argon2id parameters per OWASP recommendations
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,       // 3 iterations
  parallelism: 4,
}

/**
 * Hash a plaintext password securely using Argon2id.
 * @param password - The plaintext password to hash
 * @returns The hashed password string (includes algorithm params and salt)
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }
  return argon2.hash(password, ARGON2_OPTIONS)
}

/**
 * Verify a plaintext password against a stored hash.
 * Returns false (not throws) if verification fails.
 * @param hash - The stored Argon2id hash
 * @param password - The plaintext password to verify
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password)
  } catch {
    // Verification failure is not an exception for the caller
    return false
  }
}

/**
 * Validate password strength.
 * Returns an array of validation error messages (empty = valid).
 */
export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = []

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long')
  }
  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters')
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter')
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter')
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character')
  }

  return errors
}

/**
 * Check if password needs rehashing (e.g., after parameter upgrade).
 */
export async function needsRehash(hash: string): Promise<boolean> {
  return argon2.needsRehash(hash, ARGON2_OPTIONS)
}
