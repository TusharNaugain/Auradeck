import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createLoginAttempt, redisGet, redisEval, redisDel, redisPipeline } = vi.hoisted(() => ({
  createLoginAttempt: vi.fn(),
  redisGet: vi.fn(),
  redisEval: vi.fn(),
  redisDel: vi.fn(),
  redisPipeline: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: { loginAttempt: { create: createLoginAttempt } },
}))
vi.mock('@/lib/redis', () => ({
  redis: {
    get: redisGet,
    eval: redisEval,
    del: redisDel,
    pipeline: redisPipeline,
  },
}))

import { checkLoginAllowed, recordLoginAttempt } from '@/lib/auth/login-guard'
import { rateLimit } from '@/lib/rate-limit'

describe('development Redis fallbacks', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development')
    createLoginAttempt.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('applies rate limits in memory without connecting to Redis', async () => {
    const config = { max: 2, windowSeconds: 60, prefix: 'test' }

    expect((await rateLimit('client', config)).allowed).toBe(true)
    expect((await rateLimit('client', config)).allowed).toBe(true)
    expect((await rateLimit('client', config)).allowed).toBe(false)
    expect(redisPipeline).not.toHaveBeenCalled()
  })

  it('keeps login lockout checks working without connecting to Redis', async () => {
    const email = 'dev-fallback@example.test'
    const ipHash = 'dev-fallback-ip'

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordLoginAttempt(email, ipHash, null, false, 'bad_password')
    }

    await expect(checkLoginAllowed(email, ipHash)).resolves.toMatchObject({
      allowed: false,
      attemptsRemaining: 0,
    })
    expect(redisGet).not.toHaveBeenCalled()
    expect(redisEval).not.toHaveBeenCalled()
  })
})
