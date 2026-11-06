/**
 * /api/health — liveness + readiness: database and configured dependencies.
 * Redis is optional in local development, where in-memory limits are used.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { redis, useLocalStore } from '@/lib/redis'
import { checkFirestoreConnection } from '@/lib/firebase-admin'
import { v4 as uuidv4 } from 'uuid'

export async function GET(req: NextRequest) {
  const requestId = uuidv4()
  void req

  const startedAt = Date.now()
  const checks: Record<string, { status: 'ok' | 'down' | 'skipped'; latencyMs?: number; error?: string }> = {}

  // Database
  try {
    const t = Date.now()
    await db.$queryRaw`SELECT 1`
    checks.database = { status: 'ok', latencyMs: Date.now() - t }
  } catch (err) {
    checks.database = { status: 'down', error: err instanceof Error ? err.message : 'unknown' }
  }

  if (useLocalStore) {
    checks.redis = { status: 'skipped' }
  } else {
    try {
      const t = Date.now()
      const pong = await redis.ping()
      checks.redis = { status: pong === 'PONG' ? 'ok' : 'down', latencyMs: Date.now() - t }
    } catch (err) {
      checks.redis = { status: 'down', error: err instanceof Error ? err.message : 'unknown' }
    }
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') {
    try {
      const t = Date.now()
      await checkFirestoreConnection()
      checks.firestore = { status: 'ok', latencyMs: Date.now() - t }
    } catch (err) {
      checks.firestore = { status: 'down', error: err instanceof Error ? err.message : 'unknown' }
    }
  }

  const allOk = Object.values(checks).every((check) => check.status !== 'down')

  return NextResponse.json(
    {
      status: allOk ? 'healthy' : 'degraded',
      checks,
      totalLatencyMs: Date.now() - startedAt,
      requestId,
    },
    { status: allOk ? 200 : 503 }
  )
}
