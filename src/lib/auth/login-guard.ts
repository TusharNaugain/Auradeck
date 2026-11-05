/**
 * Login attempt tracking, account lockout and progressive delay.
 * Uses database for persistent state across instances.
 */

import { db } from '@/lib/db'
import { redis } from '@/lib/redis'

const MAX_ATTEMPTS = 5
const LOCKOUT_WINDOW_SECONDS = 300 // 5 minutes
const LOCKOUT_DURATION_SECONDS = 900 // 15 minutes
const PROGRESSIVE_DELAYS = [0, 0, 1000, 2000, 5000] // ms before response
const localAttempts = new Map<string, { count: number; resetAt: number }>()
let lastLocalCleanup = 0
const RECORD_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = tonumber(ARGV[1])
if count >= tonumber(ARGV[2]) then
  ttl = tonumber(ARGV[3])
end
redis.call('EXPIRE', KEYS[1], ttl)
return count
`

function getLocalAttemptCount(key: string, now: number): number {
  const attempt = localAttempts.get(key)
  if (!attempt || attempt.resetAt <= now) {
    localAttempts.delete(key)
    return 0
  }
  return attempt.count
}

function recordLocalFailure(key: string, now: number): void {
  if (now - lastLocalCleanup > 60_000) {
    for (const [attemptKey, attempt] of localAttempts) {
      if (attempt.resetAt <= now) localAttempts.delete(attemptKey)
    }
    lastLocalCleanup = now
  }

  const count = getLocalAttemptCount(key, now) + 1
  const resetAt =
    now +
    (count >= MAX_ATTEMPTS ? LOCKOUT_DURATION_SECONDS : LOCKOUT_WINDOW_SECONDS) * 1000
  localAttempts.set(key, { count, resetAt })
}

/**
 * Check if a login attempt is allowed (not locked out).
 * Returns delay in ms if allowed, or null if locked out.
 */
export async function checkLoginAllowed(
  email: string,
  ipAddressHash: string
): Promise<{ allowed: boolean; delayMs: number; attemptsRemaining: number }> {
  const emailKey = `login_attempts:email:${email}`
  const ipKey = `login_attempts:ip:${ipAddressHash}`

  let emailCount: number
  let ipCount: number
  if (process.env.NODE_ENV === 'development') {
    const now = Date.now()
    emailCount = getLocalAttemptCount(emailKey, now)
    ipCount = getLocalAttemptCount(ipKey, now)
  } else {
    const [emailAttempts, ipAttempts] = await Promise.all([
      redis.get(emailKey),
      redis.get(ipKey),
    ])
    emailCount = parseInt(emailAttempts ?? '0', 10)
    ipCount = parseInt(ipAttempts ?? '0', 10)
  }
  const maxCount = Math.max(emailCount, ipCount)

  if (maxCount >= MAX_ATTEMPTS) {
    return { allowed: false, delayMs: 0, attemptsRemaining: 0 }
  }

  const delayIndex = Math.min(maxCount, PROGRESSIVE_DELAYS.length - 1)
  const delayMs = PROGRESSIVE_DELAYS[delayIndex]

  return {
    allowed: true,
    delayMs,
    attemptsRemaining: MAX_ATTEMPTS - maxCount,
  }
}

/**
 * Record a login attempt (success or failure).
 */
export async function recordLoginAttempt(
  email: string,
  ipAddressHash: string,
  userId: string | null,
  success: boolean,
  failureReason?: string
) {
  const emailKey = `login_attempts:email:${email}`
  const ipKey = `login_attempts:ip:${ipAddressHash}`

  if (process.env.NODE_ENV === 'development') {
    if (success) {
      localAttempts.delete(emailKey)
      localAttempts.delete(ipKey)
    } else {
      const now = Date.now()
      recordLocalFailure(emailKey, now)
      recordLocalFailure(ipKey, now)
    }
  } else {
    if (!success) {
      await Promise.all([
        redis.eval(
          RECORD_FAILURE_SCRIPT,
          1,
          emailKey,
          String(LOCKOUT_WINDOW_SECONDS),
          String(MAX_ATTEMPTS),
          String(LOCKOUT_DURATION_SECONDS)
        ),
        redis.eval(
          RECORD_FAILURE_SCRIPT,
          1,
          ipKey,
          String(LOCKOUT_WINDOW_SECONDS),
          String(MAX_ATTEMPTS),
          String(LOCKOUT_DURATION_SECONDS)
        ),
      ])
    } else {
      await Promise.all([
        redis.del(emailKey),
        redis.del(ipKey),
      ])
    }
  }

  // Log to database for audit
  await db.loginAttempt.create({
    data: {
      userId: userId ?? undefined,
      email,
      ipAddressHash,
      success,
      failureReason: failureReason?.substring(0, 255),
    },
  }).catch(() => {}) // Non-critical
}

/**
 * Clear lockout for a user (admin action).
 */
export async function clearLoginLockout(email: string) {
  const key = `login_attempts:email:${email}`
  if (process.env.NODE_ENV === 'development') {
    localAttempts.delete(key)
  } else {
    await redis.del(key)
  }
}

/**
 * Apply progressive delay before responding to a login attempt.
 */
export async function applyLoginDelay(delayMs: number): Promise<void> {
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }
}
