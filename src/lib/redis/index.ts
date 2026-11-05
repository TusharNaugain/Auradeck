/**
 * Redis client singleton using ioredis.
 */

import Redis from 'ioredis'
import { env } from '@/env'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

function createRedisClient(): Redis {
  const client = new Redis(env.REDIS_URL, {
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
