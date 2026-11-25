import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ activity: { findMany: vi.fn(), count: vi.fn() } }))
const guardedRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/utils/api-helpers', async (orig) => ({ ...(await orig<object>()), guardedRoute }))

import { GET } from '@/app/api/activities/route'

const get = (qs: string) =>
  (GET as unknown as (r: unknown, c: unknown) => Promise<Response>)(
    { method: 'GET', url: `http://x/api/activities?${qs}`, headers: new Headers(), nextUrl: { pathname: '/api/activities' } }, {}
  )
const where = () => db.activity.findMany.mock.calls[0][0].where

beforeEach(() => {
  vi.clearAllMocks()
  guardedRoute.mockResolvedValue({ context: { organisationId: 'org', ctx: { scopeType: 'ORGANISATION' }, user: { id: 'me' } } })
  db.activity.findMany.mockResolvedValue([])
  db.activity.count.mockResolvedValue(0)
})

describe('GET /api/activities (activity feed)', () => {
  it('filters by who did it (owner or creator), keeping the visibility rule', async () => {
    const res = await get('doneByUserId=u2')
    expect(res.status).toBe(200)
    expect(where().organisationId).toBe('org')
    expect(where().AND).toContainEqual({ OR: [{ ownerUserId: 'u2' }, { createdBy: 'u2' }] })
    expect(where().AND[0].OR).toContainEqual({ visibility: 'TEAM' })
  })

  it('searches subject, notes and the lead name, and can limit to lead activities', async () => {
    await get('search=asha&leadsOnly=true')
    expect(where().relatedLeadId).toEqual({ not: null })
    const search = where().AND.find((c: { OR?: unknown[] }) => JSON.stringify(c).includes('asha'))
    expect(search.OR).toContainEqual({ relatedLead: { fullName: { contains: 'asha', mode: 'insensitive' } } })
  })

  it('returns the lead and who logged it on each entry, newest first', async () => {
    await get('')
    const args = db.activity.findMany.mock.calls[0][0]
    expect(args.orderBy).toEqual({ createdAt: 'desc' })
    expect(args.select.relatedLead).toBeTruthy()
    expect(args.select.owner).toBeTruthy()
  })
})
