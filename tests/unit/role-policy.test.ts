import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  role: { findUnique: vi.fn(), upsert: vi.fn() },
  orgRolePolicy: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}))
const guardedRoute = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/utils/api-helpers', () => ({
  guardedRoute,
  routeHandler: (h: unknown) => h,
  parseJsonBody: async (req: { body: unknown }, schema: { parse: (v: unknown) => unknown }) => schema.parse(req.body),
}))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))

import { PUT, DELETE } from '@/app/api/access/roles/[slug]/route'

type Handler = (r: unknown, c: unknown) => Promise<Response>
const put = (slug: string, body: unknown) => (PUT as unknown as Handler)({ body }, { params: Promise.resolve({ slug }) })
const del = (slug: string) => (DELETE as unknown as Handler)({}, { params: Promise.resolve({ slug }) })

beforeEach(() => {
  vi.clearAllMocks()
  guardedRoute.mockResolvedValue({ context: { organisationId: 'org', user: { id: 'u1' }, ctx: { roleSlug: 'super_admin' }, ipHash: 'h' } })
  db.role.findUnique.mockImplementation(async ({ where }: { where: { slug: string } }) => ({ id: `r-${where.slug}`, slug: where.slug, name: where.slug }))
  db.orgRolePolicy.findUnique.mockResolvedValue(null)
  db.orgRolePolicy.upsert.mockImplementation(async ({ create }: { create: unknown }) => create)
  db.orgRolePolicy.deleteMany.mockResolvedValue({ count: 1 })
})

describe('PUT /api/access/roles/[slug]', () => {
  it('is guarded by roles.manage', async () => {
    guardedRoute.mockResolvedValue({ response: new Response(null, { status: 403 }) })
    expect((await put('sales_rep', { capabilities: [], recordScope: 'OWN' })).status).toBe(403)
    expect(guardedRoute.mock.calls[0][1].permission).toBe('roles.manage')
    expect(db.orgRolePolicy.upsert).not.toHaveBeenCalled()
  })

  it('never edits the super admin role', async () => {
    expect((await put('super_admin', { capabilities: [], recordScope: 'OWN' })).status).toBe(400)
    expect(db.orgRolePolicy.upsert).not.toHaveBeenCalled()
  })

  it('404s for roles outside the team set', async () => {
    expect((await put('therapist', { capabilities: [], recordScope: 'OWN' })).status).toBe(404)
  })

  it('rejects unknown capabilities', async () => {
    expect((await put('sales_rep', { capabilities: ['leads.view', 'root'], recordScope: 'OWN' })).status).toBe(400)
  })

  it('saves a de-duplicated policy scoped to the organisation', async () => {
    const res = await put('sales_rep', { capabilities: ['leads.view', 'leads.export', 'leads.view'], recordScope: 'TEAM' })
    expect(res.status).toBe(200)
    const args = db.orgRolePolicy.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ organisationId_roleId: { organisationId: 'org', roleId: 'r-sales_rep' } })
    expect(args.create).toMatchObject({ organisationId: 'org', capabilities: ['leads.export', 'leads.view'], recordScope: 'TEAM' })
  })
})

describe('DELETE /api/access/roles/[slug]', () => {
  it('resets a role to its defaults in this organisation only', async () => {
    expect((await del('marketing')).status).toBe(200)
    expect(db.orgRolePolicy.deleteMany.mock.calls[0][0].where).toEqual({ organisationId: 'org', roleId: 'r-marketing' })
  })
})
