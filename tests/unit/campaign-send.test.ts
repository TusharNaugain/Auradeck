import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  campaignSend: { update: vi.fn(), count: vi.fn(), create: vi.fn() },
  lead: { findMany: vi.fn() },
}))
const client = vi.hoisted(() => ({
  createSegment: vi.fn(), addContactsToSegment: vi.fn(), sendBroadcast: vi.fn(), sendTestEmail: vi.fn(),
}))
const guardedRoute = vi.hoisted(() => vi.fn())
const env = vi.hoisted(() => ({ RESEND_API_KEY: 're_test' as string | undefined }))

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/env', () => ({ env }))
vi.mock('@/lib/email/resend-broadcast', () => client)
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/reports/scope', () => ({ resolveLeadScope: vi.fn(async () => ({})) }))
vi.mock('@/lib/utils/api-helpers', async (orig) => ({
  ...(await orig<object>()),
  guardedRoute,
}))

import { runCampaignSend, toSendDto } from '@/lib/services/campaigns'
import { POST } from '@/app/api/campaigns/send/route'

const recipients = [{ email: 'a@x.com', firstName: 'A', lastName: 'B' }]
const statuses = () => db.campaignSend.update.mock.calls.map((c) => c[0].data.status).filter(Boolean)

beforeEach(() => {
  vi.clearAllMocks()
  env.RESEND_API_KEY = 're_test'
  db.campaignSend.update.mockResolvedValue({})
  client.createSegment.mockResolvedValue('seg1')
  client.sendBroadcast.mockResolvedValue('bc1')
})

describe('runCampaignSend', () => {
  it('creates the segment, then contacts, then sends the broadcast, and marks sent', async () => {
    const order: string[] = []
    client.createSegment.mockImplementation(async () => (order.push('segment'), 'seg1'))
    client.addContactsToSegment.mockImplementation(async () => void order.push('contacts'))
    client.sendBroadcast.mockImplementation(async () => (order.push('broadcast'), 'bc1'))

    await runCampaignSend('s1', 'Hi', 'Body', recipients)

    expect(order).toEqual(['segment', 'contacts', 'broadcast'])
    expect(client.addContactsToSegment).toHaveBeenCalledWith('seg1', recipients)
    expect(client.sendBroadcast.mock.calls[0][0]).toMatchObject({ segmentId: 'seg1', subject: 'Hi' })
    expect(statuses()).toEqual(['syncing', 'sending', 'sent'])
    expect(db.campaignSend.update.mock.calls.at(-1)![0].data).toMatchObject({ resendBroadcastId: 'bc1' })
  })

  it('sends nothing and marks failed when contact sync fails', async () => {
    client.addContactsToSegment.mockRejectedValue(new Error('Resend 500: boom'))
    await runCampaignSend('s1', 'Hi', 'Body', recipients)
    expect(client.sendBroadcast).not.toHaveBeenCalled()
    expect(statuses()).toEqual(['syncing', 'failed'])
    expect(db.campaignSend.update.mock.calls.at(-1)![0].data.error).toBe('Resend 500: boom')
  })
})

describe('stale sends', () => {
  const row = (status: string, ageMs: number) => ({
    id: 's', subject: '', audience: 'all', recipientCount: 1, status, error: null,
    createdAt: new Date(), completedAt: null, updatedAt: new Date(Date.now() - ageMs),
  })
  it('reports an abandoned in-flight send as failed', () => {
    expect(toSendDto(row('sending', 2 * 3600_000)).status).toBe('failed')
    expect(toSendDto(row('sending', 1000)).status).toBe('sending')
    expect(toSendDto(row('sent', 2 * 3600_000)).status).toBe('sent')
  })
})

describe('POST /api/campaigns/send', () => {
  const post = (body: unknown) =>
    (POST as unknown as (r: unknown, c: unknown) => Promise<Response>)(
      { method: 'POST', headers: new Headers(), nextUrl: { pathname: '/' }, json: async () => body }, {}
    )
  const send = { audience: 'all', subject: 'Hi', message: 'Body', mode: 'send', confirmCount: 1 }

  beforeEach(() => {
    guardedRoute.mockResolvedValue({
      context: { organisationId: 'org', ctx: { scopeType: 'ALL', teamId: null }, user: { id: 'u1', email: 'me@x.com' }, ipHash: 'h' },
    })
    db.campaignSend.count.mockResolvedValue(0)
    db.campaignSend.create.mockResolvedValue({ id: 's1' })
    db.lead.findMany.mockResolvedValue([{ email: 'a@x.com', firstName: 'A', lastName: 'B', isPriority: false, consentStatus: null }])
  })

  it('requires the campaigns.send permission and a strict rate limit', async () => {
    guardedRoute.mockResolvedValue({ response: new Response(null, { status: 403 }) })
    expect((await post(send)).status).toBe(403)
    expect(guardedRoute.mock.calls[0][1]).toMatchObject({ permission: 'campaigns.send', policy: 'campaignSend', keyByUser: true })
  })

  it('503s without an API key', async () => {
    env.RESEND_API_KEY = undefined
    const res = await post(send)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('EMAIL_NOT_CONFIGURED')
  })

  it('test mode emails only the signed-in user and creates no send', async () => {
    const res = await post({ ...send, mode: 'test' })
    expect((await res.json()).data).toEqual({ sent: true })
    expect(client.sendTestEmail.mock.calls[0][0]).toBe('me@x.com')
    expect(db.campaignSend.create).not.toHaveBeenCalled()
  })

  it('409s with the new count when confirmCount is stale', async () => {
    const res = await post({ ...send, confirmCount: 5 })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'COUNT_CHANGED', count: 1 })
    expect(db.campaignSend.create).not.toHaveBeenCalled()
  })

  it('409s while another send is running', async () => {
    db.campaignSend.count.mockResolvedValue(1)
    const res = await post(send)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('SEND_IN_PROGRESS')
  })

  it('accepts a confirmed send with 202 and starts the job', async () => {
    client.addContactsToSegment.mockResolvedValue(undefined)
    const res = await post(send)
    expect(res.status).toBe(202)
    expect((await res.json()).data).toEqual({ id: 's1' })
    expect(db.campaignSend.create.mock.calls[0][0].data).toMatchObject({ organisationId: 'org', recipientCount: 1 })
    await vi.waitFor(() => expect(client.sendBroadcast).toHaveBeenCalled())
  })
})
