import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const { getCurrentUser, getAuthContext } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getAuthContext: vi.fn(),
}))

vi.mock('@/lib/auth/session', () => ({ getCurrentUser }))
vi.mock('@/lib/permissions', () => ({
  getAuthContext,
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}))

import { parseBody, parsePagination, requireAuth, requireAuthAndOrg } from '@/lib/utils/api'

describe('API request helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses valid JSON asynchronously through the schema', async () => {
    const request = new NextRequest('http://localhost/api', {
      method: 'POST',
      body: JSON.stringify({ count: '4' }),
    })

    await expect(
      parseBody(request, z.object({ count: z.string().transform(async (value) => Number(value)) }))
    ).resolves.toEqual({ count: 4 })
  })

  it('returns a validation response for schema failures', async () => {
    const request = new NextRequest('http://localhost/api', {
      method: 'POST',
      body: JSON.stringify({ count: 'not-a-number' }),
    })

    const response = await parseBody(request, z.object({ count: z.coerce.number() }))

    expect(response).toBeInstanceOf(Response)
    if (response instanceof Response) {
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Validation failed',
      })
    }
  })

  it('returns a validation response for malformed JSON', async () => {
    const request = new NextRequest('http://localhost/api', {
      method: 'POST',
      body: '{',
    })

    const response = await parseBody(request, z.object({}))

    expect(response).toBeInstanceOf(Response)
    if (response instanceof Response) expect(response.status).toBe(400)
  })

  it('normalizes malformed and unsafe pagination inputs without producing NaN', () => {
    expect(parsePagination(new URLSearchParams('page=2&pageSize=25'))).toEqual({
      page: 2,
      pageSize: 25,
      skip: 25,
    })
    expect(parsePagination(new URLSearchParams('page=2oops&pageSize=999'))).toEqual({
      page: 1,
      pageSize: 100,
      skip: 0,
    })
    expect(parsePagination(new URLSearchParams('page=9007199254740991&pageSize=100')).skip)
      .toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    expect(parsePagination(new URLSearchParams('page=-2&pageSize=0'))).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
    })
  })

  it('returns a correctly narrowed unauthenticated result', async () => {
    getCurrentUser.mockResolvedValue(null)
    const requestId = 'request-123'

    const result = await requireAuth(requestId)

    expect(result.user).toBeNull()
    if (result.error === null) throw new Error('Expected unauthenticated response')
    expect(result.error).toBeInstanceOf(Response)
    expect(result.error.status).toBe(401)
    await expect(result.error.json()).resolves.toMatchObject({ requestId })
  })

  it('requires an active organisation membership before returning context', async () => {
    const user = { id: 'user-1', status: 'ACTIVE' }
    const context = { permissions: new Set<string>() }
    getCurrentUser.mockResolvedValue(user)
    getAuthContext.mockResolvedValue(context)

    const request = new NextRequest('http://localhost/api')
    await expect(requireAuthAndOrg(request, 'org-1')).resolves.toEqual({
      user,
      ctx: context,
      error: null,
    })
    expect(getAuthContext).toHaveBeenCalledWith('user-1', 'org-1')
  })
})
