import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  membership: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
  team: { findFirst: vi.fn() },
  role: { findUnique: vi.fn(), upsert: vi.fn() },
}))
const guardedRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/utils/api-helpers', () => ({
  guardedRoute,
  routeHandler: (h: unknown) => h,
  parseJsonBody: async (req: { body: unknown }, schema: { parse: (v: unknown) => unknown }) => schema.parse(req.body),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ revokeAllSessions: vi.fn() }))

import { PATCH } from '@/app/api/users/[id]/route'

const call = (body: unknown, id = 'm2') =>
  (PATCH as unknown as (r: unknown, c: unknown) => Promise<Response>)({ body }, { params: Promise.resolve({ id }) })
const actor = (roleSlug: string) =>
  guardedRoute.mockResolvedValue({ context: { organisationId: 'org', user: { id: 'u1' }, ctx: { roleSlug }, ipHash: 'h' } })
const target = (over: Record<string, unknown> = {}) => ({
  id: 'm2', userId: 'u2', status: 'ACTIVE', teamId: null, scopeOverride: null,
  role: { slug: 'sales_rep' }, user: { email: 'x@y.com', status: 'ACTIVE' }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  actor('admin')
  db.role.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) => ({ id: `r-${where.slug}`, slug: where.slug, name: where.slug }))
  db.membership.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    role: { slug: 'x', name: 'x' }, teamId: null, scopeOverride: data.scopeOverride ?? null, status: 'ACTIVE',
  }))
})

describe('PATCH /api/users/[id]', () => {
  it('returns the guard response when the caller lacks users.manage', async () => {
    guardedRoute.mockResolvedValue({ response: new Response(null, { status: 403 }) })
    expect((await call({ roleSlug: 'marketing' })).status).toBe(403)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('404s for a member of another organisation', async () => {
    db.membership.findFirst.mockResolvedValue(null)
    expect((await call({ roleSlug: 'marketing' })).status).toBe(404)
    expect(db.membership.findFirst.mock.calls[0][0].where).toEqual({ id: 'm2', organisationId: 'org' })
  })

  it('refuses to change your own access', async () => {
    db.membership.findFirst.mockResolvedValue(target({ userId: 'u1' }))
    expect((await call({ scopeType: 'organisation' })).status).toBe(400)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('stops an admin from making someone super admin', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    expect((await call({ roleSlug: 'super_admin' })).status).toBe(403)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('stops an admin from editing a super admin', async () => {
    db.membership.findFirst.mockResolvedValue(target({ role: { slug: 'super_admin' } }))
    expect((await call({ roleSlug: 'sales_rep' })).status).toBe(403)
  })

  it('stops the last super admin from being demoted', async () => {
    actor('super_admin')
    db.membership.findFirst.mockResolvedValue(target({ role: { slug: 'super_admin' } }))
    db.membership.count.mockResolvedValue(0)
    expect((await call({ roleSlug: 'admin' })).status).toBe(400)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('lets a super admin promote someone to super admin', async () => {
    actor('super_admin')
    db.membership.findFirst.mockResolvedValue(target())
    expect((await call({ roleSlug: 'super_admin' })).status).toBe(200)
    expect(db.membership.update.mock.calls[0][0].data.roleId).toBe('r-super_admin')
  })

  it('rejects unknown roles', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    expect((await call({ roleSlug: 'wizard' })).status).toBe(400)
  })

  it('changes role and visibility override', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    expect((await call({ roleSlug: 'marketing', scopeType: 'organisation' })).status).toBe(200)
    expect(db.membership.update.mock.calls[0][0].data).toEqual({ roleId: 'r-marketing', scopeOverride: 'ORGANISATION' })
  })

  it('clears the visibility override with "default"', async () => {
    db.membership.findFirst.mockResolvedValue(target({ scopeOverride: 'ORGANISATION' }))
    expect((await call({ scopeType: 'default' })).status).toBe(200)
    expect(db.membership.update.mock.calls[0][0].data).toEqual({ scopeOverride: null })
  })

  it('rejects a team from another organisation', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    db.team.findFirst.mockResolvedValue(null)
    expect((await call({ teamId: 't9' })).status).toBe(400)
    expect(db.team.findFirst.mock.calls[0][0].where).toEqual({ id: 't9', organisationId: 'org' })
  })

  it('reactivates a deactivated member', async () => {
    db.membership.findFirst.mockResolvedValue(target({ status: 'DEACTIVATED' }))
    expect((await call({ status: 'active' })).status).toBe(200)
    expect(db.membership.update.mock.calls[0][0].data).toEqual({ status: 'ACTIVE', deactivatedAt: null })
  })
})
