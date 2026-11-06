/**
 * Redis client singleton using ioredis.
 */

import Redis from 'ioredis'
import { env } from '@/env'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

/**
 * Redis is optional. Without REDIS_URL, rate limits and login lockouts use an
 * in-memory store (single instance, reset on restart).
 */
export const redisConfigured = Boolean(env.REDIS_URL?.trim())
export const useLocalStore = process.env.NODE_ENV === 'development' || !redisConfigured

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: process.env.NODE_ENV === 'development' ? 1 : 3,
    lazyConnect: true,
    enableReadyCheck: false,
    ...(process.env.NODE_ENV === 'development'
      ? { connectTimeout: 2_000, commandTimeout: 2_000 }
      : {}),
  })

  client.on('error', (err) => {
    console.error('[Redis] Connection error:', err.message)
  })

  client.on('connect', () => {
    console.log('[Redis] Connected')
  })

  return client
}

export const redis = globalForRedis.redis ?? createRedisClient()

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

export default redis
