import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redis, createLoginAttempt } = vi.hoisted(() => ({
  redis: {
    eval: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
  },
  createLoginAttempt: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  redis,
  get useLocalStore() {
    return process.env.NODE_ENV === 'development'
  },
}))
vi.mock('@/lib/db', () => ({
  db: { loginAttempt: { create: createLoginAttempt } },
}))

import { recordLoginAttempt } from '@/lib/auth/login-guard'

describe('login attempt lockout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createLoginAttempt.mockResolvedValue({})
  })

  it('atomically increments and expires counters, using the longer lockout at the threshold', async () => {
    await recordLoginAttempt('user@example.com', 'ip-hash', null, false, 'bad_password')

    expect(redis.eval).toHaveBeenCalledTimes(2)
    for (const [script, keyCount, key, window, threshold, lockout] of redis.eval.mock.calls) {
      expect(script).toContain("redis.call('INCR', KEYS[1])")
      expect(script).toContain("redis.call('EXPIRE', KEYS[1], ttl)")
      expect(keyCount).toBe(1)
      expect(key).toMatch(/^login_attempts:(email|ip):/)
      expect(window).toBe('300')
      expect(threshold).toBe('5')
      expect(lockout).toBe('900')
    }
  })
})
