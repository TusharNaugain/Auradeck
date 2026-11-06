import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { queryRaw, ping, checkFirestoreConnection } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ping: vi.fn(),
  checkFirestoreConnection: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: { $queryRaw: queryRaw } }))
vi.mock('@/lib/redis', () => ({
  redis: { ping },
  get useLocalStore() {
    return process.env.NODE_ENV === 'development'
  },
}))
vi.mock('@/lib/firebase-admin', () => ({ checkFirestoreConnection }))

import { GET } from '@/app/api/health/route'

describe('health route', () => {
  beforeEach(() => {
    vi.stubEnv('FIREBASE_PROJECT_ID', 'auradesk-ddf2b')
    queryRaw.mockResolvedValue([])
    ping.mockResolvedValue('PONG')
    checkFirestoreConnection.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not initialize Firestore while browser-only Demo mode is active', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'true')

    await GET(new NextRequest('http://localhost/api/health'))

    expect(checkFirestoreConnection).not.toHaveBeenCalled()
  })

  it('checks Firestore when Demo mode is disabled and a project is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', 'false')

    await GET(new NextRequest('http://localhost/api/health'))

    expect(checkFirestoreConnection).toHaveBeenCalledOnce()
  })

  it('skips Redis in development because local fallbacks are used', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const response = await GET(new NextRequest('http://localhost/api/health'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.checks.redis.status).toBe('skipped')
    expect(ping).not.toHaveBeenCalled()
  })
})
