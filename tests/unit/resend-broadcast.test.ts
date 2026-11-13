import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  RESEND_API_KEY: 're_test' as string | undefined,
  RESEND_API_URL: 'http://stub',
  EMAIL_FROM_NAME: 'Auradeck',
  EMAIL_FROM_ADDRESS: 'hi@auradeck.in',
}))
vi.mock('@/env', () => ({ env }))

import { addContactsToSegment, createSegment, EmailNotConfiguredError, sendBroadcast } from '@/lib/email/resend-broadcast'

const json = (status: number, body: unknown = { id: 'id1' }, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })
const fetchMock = vi.fn()
const calls = () => fetchMock.mock.calls.map((c) => ({ url: String(c[0]).replace('http://stub', ''), init: c[1] }))
const run = async <T>(p: Promise<T>) => {
  const settled = p.then((v) => v, (e) => { throw e })
  settled.catch(() => undefined)
  await vi.runAllTimersAsync()
  return settled
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  env.RESEND_API_KEY = 're_test'
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('resend client', () => {
  it('throws EmailNotConfiguredError without an API key and never calls fetch', async () => {
    env.RESEND_API_KEY = undefined
    await expect(createSegment('x')).rejects.toBeInstanceOf(EmailNotConfiguredError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds existing contacts by email, creates unknown ones, and never sends unsubscribed', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200))
      .mockResolvedValueOnce(json(404, { message: 'not found' }))
      .mockResolvedValueOnce(json(200))
    await run(addContactsToSegment('seg', [
      { email: 'a@x.com', firstName: 'A', lastName: 'B' },
      { email: 'b@x.com', firstName: 'C', lastName: 'D' },
    ]))
    const [added, probe, created] = calls()
    expect(added.url).toBe('/contacts/a%40x.com/segments/seg')
    expect(probe.url).toBe('/contacts/b%40x.com/segments/seg')
    expect(created.url).toBe('/contacts')
    expect(JSON.parse(created.init.body)).toEqual({
      email: 'b@x.com', first_name: 'C', last_name: 'D', segments: [{ id: 'seg' }],
    })
    expect(JSON.stringify(calls())).not.toContain('unsubscribed')
    expect(added.init.headers.Authorization).toBe('Bearer re_test')
  })

  it('paces calls and retries a 429 after Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(json(429, {}, { 'retry-after': '3' })).mockResolvedValueOnce(json(200))
    const start = Date.now()
    await run(createSegment('x'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(Date.now() - start).toBeGreaterThanOrEqual(3000)
  })

  it('gives up after repeated 429s with a truncated error and no key', async () => {
    fetchMock.mockImplementation(async () => json(429, { message: 'x'.repeat(1000) }))
    const err = await run(createSegment('x')).catch((e: Error) => e)
    expect((err as Error).message.length).toBeLessThan(320)
    expect((err as Error).message).not.toContain('re_test')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('creates and sends the broadcast in one call', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'b1' }))
    const id = await run(sendBroadcast({ segmentId: 's', name: 'n', subject: 'Hi', html: '<p>x</p>', text: 'x' }))
    expect(id).toBe('b1')
    expect(JSON.parse(calls()[0].init.body)).toMatchObject({
      segment_id: 's', from: 'Auradeck <hi@auradeck.in>', subject: 'Hi', send: true,
    })
  })
})
