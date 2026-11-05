/**
 * Prisma client singleton for Next.js.
 * Prevents multiple instances in development hot-reloading.
 *
 * Connection pool is sized to match typical Next.js dev concurrency:
 * - `connection_limit=10` — allows up to 10 concurrent DB connections
 * - `pool_timeout=10`    — fail fast (10 s) rather than queue indefinitely
 */

import { PrismaClient, Prisma } from '@prisma/client'

export { Prisma }

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const dbUrl = process.env.DATABASE_URL ?? ''
  // Append pool params only if not already present in the URL
  const datasourceUrl = dbUrl.includes('connection_limit')
    ? dbUrl
    : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}connection_limit=10&pool_timeout=10`

  return new PrismaClient({
    datasources: { db: { url: datasourceUrl } },
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
