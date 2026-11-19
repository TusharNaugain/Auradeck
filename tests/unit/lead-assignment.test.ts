import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  membership: { findFirst: vi.fn() },
  userPermissionOverride: { findMany: vi.fn() },
  orgRolePolicy: { findUnique: vi.fn() },
  lead: { updateMany: vi.fn() },
}))
const guardedRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: <T,>(fn: T) => fn }))
vi.mock('@/lib/utils/api-helpers', () => ({
  guardedRoute,
  routeHandler: (h: unknown) => h,
  parseJsonBody: async (req: { body: unknown }, schema: { parse: (v: unknown) => unknown }) => schema.parse(req.body),
}))

import { assertCanAssign, assertActiveMember } from '@/lib/services/assignment'
import { getAuthContext, PermissionDeniedError, type AuthContext } from '@/lib/permissions'
import { POST as bulkAssign } from '@/app/api/leads/assign/route'

const ctx = (permissions: string[], over: Partial<AuthContext> = {}): AuthContext => ({
  userId: 'u1', organisationId: 'org', roleSlug: 'sales_rep', permissions: new Set(permissions), scopeType: 'OWN', teamId: null, ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('assertCanAssign', () => {
  it('allows keeping the same owner without leads.assign', () => {
    expect(() => assertCanAssign(ctx([]), { currentOwnerId: 'u2', nextOwnerId: 'u2' })).not.toThrow()
  })

  it('allows creating a lead for yourself without leads.assign', () => {
    expect(() => assertCanAssign(ctx([]), { currentOwnerId: null, nextOwnerId: 'u1', isCreate: true })).not.toThrow()
  })

  it('blocks re-assigning without leads.assign, even to yourself or to nobody', () => {
    expect(() => assertCanAssign(ctx(['leads.update']), { currentOwnerId: 'u2', nextOwnerId: 'u1' })).toThrow(PermissionDeniedError)
    expect(() => assertCanAssign(ctx(['leads.update']), { currentOwnerId: 'u1', nextOwnerId: null })).toThrow(PermissionDeniedError)
    expect(() => assertCanAssign(ctx(['leads.create']), { currentOwnerId: null, nextOwnerId: 'u2', isCreate: true })).toThrow(PermissionDeniedError)
  })

  it('allows re-assigning with leads.assign', () => {
    expect(() => assertCanAssign(ctx(['leads.assign']), { currentOwnerId: 'u2', nextOwnerId: 'u3' })).not.toThrow()
  })

  it('requires the new owner to be an active member of the organisation', async () => {
    db.membership.findFirst.mockResolvedValue(null)
    await expect(assertActiveMember('org', 'u9')).rejects.toThrow(/not an active member/)
    expect(db.membership.findFirst.mock.calls[0][0].where).toEqual({ organisationId: 'org', userId: 'u9', status: 'ACTIVE' })
  })
})

describe('getAuthContext', () => {
  const membership = (slug: string, over: Record<string, unknown> = {}) => ({
    roleId: `r-${slug}`, teamId: null, scopeType: 'ORGANISATION', scopeOverride: null,
    role: { slug, permissions: [] }, ...over,
  })

  beforeEach(() => db.userPermissionOverride.findMany.mockResolvedValue([]))

  it('returns null without an active membership', async () => {
    db.membership.findFirst.mockResolvedValue(null)
    expect(await getAuthContext('u1', 'org')).toBeNull()
  })

  it('uses role defaults when the organisation has not customised the role', async () => {
    db.membership.findFirst.mockResolvedValue(membership('sales_rep'))
    db.orgRolePolicy.findUnique.mockResolvedValue(null)
    const c = await getAuthContext('u1', 'org')
    expect(c!.scopeType).toBe('OWN')
    expect(c!.permissions.has('leads.assign')).toBe(false)
    expect(db.orgRolePolicy.findUnique.mock.calls[0][0].where).toEqual({ organisationId_roleId: { organisationId: 'org', roleId: 'r-sales_rep' } })
  })

  it("applies the organisation's saved policy and the member override", async () => {
    db.membership.findFirst.mockResolvedValue(membership('sales_rep', { scopeOverride: 'TEAM' }))
    db.orgRolePolicy.findUnique.mockResolvedValue({ capabilities: ['leads.view', 'leads.assign'], recordScope: 'ORGANISATION' })
    const c = await getAuthContext('u1', 'org')
    expect(c!.scopeType).toBe('TEAM')
    expect(c!.permissions.has('leads.assign')).toBe(true)
    expect(c!.permissions.has('leads.create')).toBe(false)
  })
})

describe('POST /api/leads/assign', () => {
  const call = (body: unknown) => (bulkAssign as unknown as (r: unknown) => Promise<Response>)({ body })
  const asCaller = (scopeType: string) =>
    guardedRoute.mockResolvedValue({
      context: { organisationId: 'org', user: { id: 'u1' }, ctx: ctx(['leads.assign'], { scopeType }), ipHash: 'h' },
    })

  beforeEach(() => {
    asCaller('ORGANISATION')
    db.lead.updateMany.mockResolvedValue({ count: 2 })
  })

  it('is guarded by leads.assign', async () => {
    guardedRoute.mockResolvedValue({ response: new Response(null, { status: 403 }) })
    expect((await call({ leadIds: ['l1'], assignedToUserId: 'u2' })).status).toBe(403)
    expect(guardedRoute.mock.calls[0][1].permission).toBe('leads.assign')
  })

  it('rejects an owner who is not an active member', async () => {
    db.membership.findFirst.mockResolvedValue(null)
    await expect(call({ leadIds: ['l1'], assignedToUserId: 'u9' })).rejects.toThrow(/not an active member/)
    expect(db.lead.updateMany).not.toHaveBeenCalled()
  })

  it("only updates leads in the caller's organisation and visibility", async () => {
    asCaller('OWN')
    db.membership.findFirst.mockResolvedValue({ id: 'm' })
    const res = await call({ leadIds: ['l1', 'l2', 'l1'], assignedToUserId: 'u2' })
    expect(res.status).toBe(200)
    const args = db.lead.updateMany.mock.calls[0][0]
    expect(args.where.AND[0]).toEqual({ id: { in: ['l1', 'l2'] }, organisationId: 'org', deletedAt: null })
    expect(args.where.AND[1]).toEqual({ OR: [{ assignedToUserId: 'u1' }, { createdBy: 'u1' }] })
    expect(args.data).toEqual({ assignedToUserId: 'u2' })
  })
})
