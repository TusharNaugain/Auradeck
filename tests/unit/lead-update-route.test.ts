import { beforeEach, describe, expect, it, vi } from 'vitest'

const tx = vi.hoisted(() => ({ lead: { update: vi.fn() }, activity: { create: vi.fn() } }))
const db = vi.hoisted(() => ({
  lead: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}))
const guardedRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/reports/scope', () => ({ resolveLeadScope: vi.fn(async () => ({ assignedToUserId: 'u1' })) }))
vi.mock('@/lib/services/assignment', () => ({ assertActiveMember: vi.fn(), assertCanAssign: vi.fn() }))
const applyStageFlow = vi.hoisted(() => vi.fn(async () => ['Deal created in Opportunities']))
vi.mock('@/lib/leads/stage-flow', () => ({ applyStageFlow }))
vi.mock('@/lib/utils/api-helpers', async (orig) => ({ ...(await orig<object>()), guardedRoute }))

import { PATCH } from '@/app/api/leads/[id]/route'

const existing = {
  id: 'lead1', leadNumber: 'LD-1', lifecycleStage: 'NEW', isPriority: false, assignedToUserId: 'u1', assignedTeamId: null,
  firstName: 'Asha', lastName: 'Rao', email: 'asha@clinic.in', phoneNumber: '+919876543210', alternatePhone: null,
  whatsappNumber: null, extraContacts: [], firstContactedAt: null,
}

const patch = (body: unknown) =>
  (PATCH as unknown as (r: unknown, c: unknown) => Promise<Response>)(
    { method: 'PATCH', headers: new Headers(), nextUrl: { pathname: '/api/leads/lead1' }, json: async () => body },
    { params: Promise.resolve({ id: 'lead1' }) }
  )
const updateData = () => tx.lead.update.mock.calls[0][0].data

beforeEach(() => {
  vi.clearAllMocks()
  guardedRoute.mockResolvedValue({
    context: { organisationId: 'org', ctx: { scopeType: 'OWN', teamId: null, permissions: new Set(['leads.update']) }, user: { id: 'u1' }, ipHash: 'h', userAgentHash: 'ua' },
  })
  db.lead.findFirst.mockResolvedValue({ ...existing })
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  tx.lead.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, fullName: 'Asha Rao', ...data }))
})

describe('PATCH /api/leads/[id]', () => {
  it('needs leads.update and only finds leads inside the caller scope', async () => {
    await patch({ firstName: 'Asha' })
    expect(guardedRoute.mock.calls[0][1]).toMatchObject({ permission: 'leads.update' })
    expect(db.lead.findFirst.mock.calls[0][0].where.AND).toContainEqual({ assignedToUserId: 'u1' })
  })

  it('renames a lead and keeps fullName in sync, even when only the last name changes', async () => {
    const res = await patch({ lastName: 'Iyer' })
    expect(res.status).toBe(200)
    expect(updateData()).toMatchObject({ firstName: 'Asha', lastName: 'Iyer', fullName: 'Asha Iyer' })
  })

  it('refuses to overwrite the source email or phone', async () => {
    const res = await patch({ email: 'new@clinic.in' })
    expect(res.status).toBe(400)
    expect(tx.lead.update).not.toHaveBeenCalled()
  })

  it('adds an extra contact without touching the source phone', async () => {
    const res = await patch({ addExtraContact: { type: 'phone', value: '+91 90000 11111', label: 'Reception' } })
    expect(res.status).toBe(200)
    const data = updateData()
    expect(data.phoneNumber).toBeUndefined()
    expect(data.extraContacts).toEqual([expect.objectContaining({ type: 'phone', value: '+919000011111', label: 'Reception', addedBy: 'u1' })])
  })

  it('saves the next action and moves stage, recording first contact and a history note', async () => {
    const res = await patch({ lifecycleStage: 'Contacted', nextAction: 'Send demo invite' })
    expect(res.status).toBe(200)
    expect(updateData()).toMatchObject({ lifecycleStage: 'CONTACTED', nextAction: 'Send demo invite' })
    expect(updateData().firstContactedAt).toBeInstanceOf(Date)
    expect(tx.activity.create.mock.calls[0][0].data).toMatchObject({ subject: 'Stage: Contacted', relatedLeadId: 'lead1' })
  })

  it('runs the stage flow in the same transaction and records what it did', async () => {
    await patch({ lifecycleStage: 'demo_scheduled' })
    expect(applyStageFlow).toHaveBeenCalledWith(tx, { organisationId: 'org', leadId: 'lead1', from: 'NEW', actorUserId: 'u1' })
    expect(tx.activity.create.mock.calls[0][0].data.description).toContain('Deal created in Opportunities')
  })

  it('does not run the stage flow when the stage is unchanged', async () => {
    await patch({ nextAction: 'Call back' })
    expect(applyStageFlow).not.toHaveBeenCalled()
  })
})
