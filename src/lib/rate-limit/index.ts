/**
 * Redis-backed rate limiting with route-specific policies.
 * Returns HTTP 429 with safe messages and Retry-After headers.
 */

import { redis, useLocalStore } from '@/lib/redis'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

export interface RateLimitConfig {
  /** Max requests allowed in the window */
  max: number
  /** Window duration in seconds */
  windowSeconds: number
  /** Key prefix for Redis */
  prefix: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  retryAfter?: number
}

const localBuckets = new Map<string, { count: number; resetAt: number }>()
let lastLocalCleanup = 0

function localRateLimit(
  key: string,
  config: RateLimitConfig,
  now: number
): RateLimitResult {
  if (now - lastLocalCleanup > 60_000) {
    for (const [bucketKey, bucket] of localBuckets) {
      if (bucket.resetAt <= now) localBuckets.delete(bucketKey)
    }
    lastLocalCleanup = now
  }

  const bucket = localBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    localBuckets.set(key, { count: 1, resetAt: now + config.windowSeconds * 1000 })
    return {
      allowed: true,
      remaining: config.max - 1,
      resetAt: new Date(now + config.windowSeconds * 1000),
    }
  }

  bucket.count += 1
  const resetAt = new Date(bucket.resetAt)
  if (bucket.count > config.max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    }
  }
  return { allowed: true, remaining: config.max - bucket.count, resetAt }
}

// Route-specific rate limit policies
export const RATE_LIMIT_POLICIES = {
  login: { max: 5, windowSeconds: 300, prefix: 'rl:login' },
  passwordReset: { max: 3, windowSeconds: 600, prefix: 'rl:pwd_reset' },
  mfaVerify: { max: 5, windowSeconds: 300, prefix: 'rl:mfa' },
  publicForm: { max: 10, windowSeconds: 60, prefix: 'rl:form' },
  apiRead: { max: 300, windowSeconds: 60, prefix: 'rl:api_read' },
  apiWrite: { max: 60, windowSeconds: 60, prefix: 'rl:api_write' },
  export: { max: 5, windowSeconds: 3600, prefix: 'rl:export' },
  import: { max: 3, windowSeconds: 3600, prefix: 'rl:import' },
  campaignSend: { max: 10, windowSeconds: 3600, prefix: 'rl:campaign_send' },
  emailVerify: { max: 5, windowSeconds: 300, prefix: 'rl:email_verify' },
} as const

/**
 * Hash an IP address for rate limiting (privacy-preserving).
 */
export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.CSRF_SECRET ?? '')).digest('hex').slice(0, 16)
}

/**
 * Get the client IP from a NextRequest.
 */
export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '127.0.0.1'
  )
}

/**
 * Apply rate limiting using a sliding window counter.
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redisKey = `${config.prefix}:${key}`
  const now = Date.now()
  const windowMs = config.windowSeconds * 1000

  if (useLocalStore) {
    return localRateLimit(redisKey, config, now)
  }

  const pipeline = redis.pipeline()
  pipeline.zadd(redisKey, now, `${now}-${Math.random()}`)
  pipeline.zremrangebyscore(redisKey, 0, now - windowMs)
  pipeline.zcard(redisKey)
  pipeline.expire(redisKey, config.windowSeconds)

  const results = await pipeline.exec()
  const count = (results?.[2]?.[1] as number) ?? 0
  const resetAt = new Date(now + windowMs)
  const remaining = Math.max(0, config.max - count)

  if (count > config.max) {
    const oldestScore = await redis.zrange(redisKey, 0, 0, 'WITHSCORES')
    const oldestTime = parseInt(oldestScore[1] ?? '0', 10)
    const retryAfter = Math.ceil((oldestTime + windowMs - now) / 1000)

    return { allowed: false, remaining: 0, resetAt, retryAfter }
  }

  return { allowed: true, remaining, resetAt }
}

/**
 * Create a rate limit middleware response.
 */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: 'Too many requests',
      message: 'You are sending requests too quickly. Please wait and try again.',
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter ?? 60),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': result.resetAt.toISOString(),
      },
    }
  )
}

/**
 * Apply rate limiting to a route handler.
 * Returns a 429 response if the limit is exceeded.
 */
export async function withRateLimit(
  req: NextRequest,
  config: RateLimitConfig,
  keyFn?: (req: NextRequest) => string
): Promise<RateLimitResult> {
  const ip = getClientIp(req)
  const hashedIp = hashIp(ip)
  const key = keyFn ? keyFn(req) : hashedIp

  return rateLimit(key, config)
}
