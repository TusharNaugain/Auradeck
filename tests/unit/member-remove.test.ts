import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  membership: { findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
  invitation: { updateMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}))
const guardedRoute = vi.hoisted(() => vi.fn())
const revokeAllSessions = vi.hoisted(() => vi.fn())

vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/utils/api-helpers', () => ({ guardedRoute, routeHandler: (h: unknown) => h }))
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({ revokeAllSessions }))
vi.mock('@/lib/permissions', () => ({ PERMISSIONS: { USERS_MANAGE: 'users.manage' } }))

import { DELETE } from '@/app/api/users/[id]/route'

const call = (id = 'm1') =>
  (DELETE as unknown as (r: unknown, c: unknown) => Promise<Response>)({}, { params: Promise.resolve({ id }) })
const target = (over: Record<string, unknown> = {}) => ({
  id: 'm1', userId: 'u2', status: 'ACTIVE', role: { slug: 'sales_rep' }, user: { email: 'x@y.com' }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  guardedRoute.mockResolvedValue({ context: { organisationId: 'org', user: { id: 'u1' }, ipHash: 'h' } })
  db.membership.update.mockResolvedValue({})
  db.invitation.updateMany.mockResolvedValue({})
})

describe('DELETE /api/users/[id]', () => {
  it('returns the guard response when unauthenticated or forbidden', async () => {
    guardedRoute.mockResolvedValue({ response: new Response(null, { status: 401 }) })
    expect((await call()).status).toBe(401)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('404s for a membership outside the organisation', async () => {
    db.membership.findFirst.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(db.membership.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'm1', organisationId: 'org' })
  })

  it('refuses to remove yourself', async () => {
    db.membership.findFirst.mockResolvedValue(target({ userId: 'u1' }))
    expect((await call()).status).toBe(400)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('refuses to remove the last super admin', async () => {
    db.membership.findFirst.mockResolvedValue(target({ role: { slug: 'super_admin' } }))
    db.membership.count.mockResolvedValue(0)
    expect((await call()).status).toBe(400)
    expect(db.membership.update).not.toHaveBeenCalled()
  })

  it('removes one of several super admins', async () => {
    db.membership.findFirst.mockResolvedValue(target({ role: { slug: 'super_admin' } }))
    db.membership.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1)
    expect((await call()).status).toBe(200)
    expect(db.membership.update.mock.calls[0][0].data.status).toBe('DEACTIVATED')
  })

  it('deactivates, revokes pending invites and ends sessions on the last seat', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    db.membership.count.mockResolvedValue(0)
    expect((await call()).status).toBe(200)
    expect(db.invitation.updateMany.mock.calls[0][0].where).toMatchObject({ organisationId: 'org', acceptedAt: null, revokedAt: null })
    expect(revokeAllSessions).toHaveBeenCalledWith('u2')
  })

  it('keeps sessions when the user still has another active seat', async () => {
    db.membership.findFirst.mockResolvedValue(target())
    db.membership.count.mockResolvedValue(1)
    expect((await call()).status).toBe(200)
    expect(revokeAllSessions).not.toHaveBeenCalled()
  })
})
