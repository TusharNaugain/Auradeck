import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ lead: { findMany: vi.fn() } }))
vi.mock('@/lib/db', () => ({ db }))

import { eligibleLeads, pickAudience, selectedLeads } from '@/lib/services/campaigns'

const lead = (email: string | null, over: Record<string, unknown> = {}) => ({
  id: `id-${email}`, email, firstName: 'A', lastName: 'B', isPriority: false, consentStatus: null, lifecycleStage: 'NEW', ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('eligibleLeads', () => {
  it('queries live, non-dead leads of the org within the caller scope', async () => {
    db.lead.findMany.mockResolvedValue([])
    await eligibleLeads('org', { assignedToUserId: 'u1' })
    const { AND } = db.lead.findMany.mock.calls[0][0].where
    expect(AND[0]).toMatchObject({
      organisationId: 'org', deletedAt: null, lifecycleStage: { notIn: ['LOST'] },
    })
    expect(AND[1]).toEqual({ assignedToUserId: 'u1' })
  })

  it('drops invalid, duplicate and opted-out emails', async () => {
    db.lead.findMany.mockResolvedValue([
      lead('A@x.com', { isPriority: true }),
      lead('a@X.com'),
      lead('bad'),
      lead(null),
      lead('w@x.com', { consentStatus: 'Withdrawn' }),
      lead('n@x.com', { consentStatus: ' NO ' }),
      lead('ok@x.com', { consentStatus: 'granted' }),
    ])
    const out = await eligibleLeads('org', {})
    expect(out.map((l) => l.email)).toEqual(['a@x.com', 'ok@x.com'])
    expect(out[0]).toEqual({ id: 'id-A@x.com', email: 'a@x.com', firstName: 'A', lastName: 'B', isPriority: true, lifecycleStage: 'NEW' })
  })

  it('limits hand-picked leads to the given ids, inside the caller scope', async () => {
    db.lead.findMany.mockResolvedValue([])
    await selectedLeads('org', { assignedToUserId: 'u1' }, ['l1', 'l2', 'l1'])
    const { AND } = db.lead.findMany.mock.calls[0][0].where
    expect(AND[0]).toMatchObject({ organisationId: 'org', deletedAt: null, lifecycleStage: { notIn: ['LOST'] } })
    expect(AND[1]).toEqual({ assignedToUserId: 'u1' })
    expect(AND[2]).toEqual({ id: { in: ['l1', 'l2'] } })
  })

  it('splits audiences', () => {
    const leads = [{ ...lead('a@x.com', { isPriority: true }), email: 'a@x.com' }, { ...lead('b@x.com'), email: 'b@x.com' }] as never
    expect(pickAudience(leads, 'priority')).toHaveLength(1)
    expect(pickAudience(leads, 'others')).toHaveLength(1)
    expect(pickAudience(leads, 'all')).toHaveLength(2)
  })
})
