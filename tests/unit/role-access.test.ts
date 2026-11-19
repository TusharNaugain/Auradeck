import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES, TEAM_ROLES, canAssignRole, defaultRolePermissions, isKnownRole, permissionsForCapabilities,
  resolveAccess, roleCapabilities, scopeFromVisibility, teamRole,
} from '@/lib/permissions/access'
import { PERMISSIONS } from '@/lib/permissions/catalog'

const perms = (slug: string) => new Set<string>(defaultRolePermissions(slug))

describe('default role matrix (as approved)', () => {
  it('gives every capability to admin but never roles.manage', () => {
    const admin = resolveAccess({ roleSlug: 'admin' })
    for (const cap of CAPABILITIES) for (const p of cap.permissions) expect(admin.permissions.has(p)).toBe(true)
    expect(admin.permissions.has(PERMISSIONS.ROLES_MANAGE)).toBe(false)
    expect(admin.permissions.has(PERMISSIONS.SUPER_ADMIN)).toBe(false)
    expect(admin.scopeType).toBe('ORGANISATION')
  })

  it('lets marketing distribute, import, export and run campaigns but not delete or convert', () => {
    const p = perms('marketing')
    for (const ok of ['leads.view', 'leads.create', 'leads.update', 'leads.assign', 'leads.import', 'leads.export', 'campaigns.send']) {
      expect(p.has(ok)).toBe(true)
    }
    for (const no of ['leads.delete', 'leads.convert', 'opportunities.view', 'users.invite', 'settings.manage']) {
      expect(p.has(no)).toBe(false)
    }
    expect(teamRole('marketing')!.defaultScope).toBe('ORGANISATION')
  })

  it('limits sales to their own leads, without assign/delete/export/campaigns', () => {
    const access = resolveAccess({ roleSlug: 'sales_rep' })
    expect(access.scopeType).toBe('OWN')
    for (const ok of ['leads.view', 'leads.create', 'leads.update', 'leads.convert', 'opportunities.create']) {
      expect(access.permissions.has(ok)).toBe(true)
    }
    for (const no of ['leads.assign', 'leads.delete', 'leads.export', 'leads.import', 'campaigns.send', 'users.manage']) {
      expect(access.permissions.has(no)).toBe(false)
    }
  })

  it('lets the sales manager see all leads, assign, delete and export', () => {
    const access = resolveAccess({ roleSlug: 'sales_head' })
    expect(access.scopeType).toBe('ORGANISATION')
    for (const ok of ['leads.assign', 'leads.delete', 'leads.export', 'leads.convert', 'reports.export']) {
      expect(access.permissions.has(ok)).toBe(true)
    }
    expect(access.permissions.has('campaigns.send')).toBe(false)
  })

  it('gives CSM their own leads and customer success, but no lead creation', () => {
    const access = resolveAccess({ roleSlug: 'csm' })
    expect(access.scopeType).toBe('OWN')
    expect(access.permissions.has('leads.view')).toBe(true)
    expect(access.permissions.has('leads.update')).toBe(true)
    expect(access.permissions.has('leads.create')).toBe(false)
    expect(access.permissions.has('onboarding.manage')).toBe(true)
    expect(access.permissions.has('opportunities.create')).toBe(false)
  })

  it('lets the CS manager assign leads and see all records', () => {
    const access = resolveAccess({ roleSlug: 'csm_head' })
    expect(access.scopeType).toBe('ORGANISATION')
    expect(access.permissions.has('leads.assign')).toBe(true)
    expect(access.permissions.has('leads.create')).toBe(false)
  })

  it('always grants the dashboard base permission to team roles', () => {
    for (const role of TEAM_ROLES) expect(perms(role.slug).has('dashboard.view')).toBe(true)
  })
})

describe('resolveAccess', () => {
  it('super admin always has everything and all records, whatever is saved', () => {
    const access = resolveAccess({
      roleSlug: 'super_admin',
      policy: { capabilities: [], recordScope: 'OWN' },
      memberScopeOverride: 'OWN',
      overrides: [{ action: 'leads.view', granted: false }],
    })
    expect(access.scopeType).toBe('ORGANISATION')
    expect(access.permissions.has('leads.view')).toBe(true)
    expect(access.permissions.has(PERMISSIONS.ROLES_MANAGE)).toBe(true)
  })

  it('an organisation policy replaces the role defaults (it can take access away)', () => {
    const access = resolveAccess({
      roleSlug: 'sales_head',
      policy: { capabilities: ['leads.view'], recordScope: 'TEAM' },
    })
    expect(access.scopeType).toBe('TEAM')
    expect(access.permissions.has('leads.view')).toBe(true)
    expect(access.permissions.has('leads.delete')).toBe(false)
    expect(access.permissions.has('dashboard.view')).toBe(true)
  })

  it('an organisation policy can widen a role', () => {
    const access = resolveAccess({
      roleSlug: 'sales_rep',
      policy: { capabilities: ['leads.view', 'leads.export'], recordScope: 'ORGANISATION' },
    })
    expect(access.permissions.has('leads.export')).toBe(true)
    expect(access.scopeType).toBe('ORGANISATION')
  })

  it('member visibility override wins over the role visibility', () => {
    expect(resolveAccess({ roleSlug: 'sales_rep', memberScopeOverride: 'ORGANISATION' }).scopeType).toBe('ORGANISATION')
    expect(resolveAccess({
      roleSlug: 'marketing',
      policy: { capabilities: ['leads.view'], recordScope: 'ORGANISATION' },
      memberScopeOverride: 'OWN',
    }).scopeType).toBe('OWN')
  })

  it('ignores the legacy membership scope for team roles', () => {
    // Invites used to store ORGANISATION for everyone; that no longer leaks all leads to Sales.
    expect(resolveAccess({ roleSlug: 'sales_rep', legacyScope: 'ORGANISATION' }).scopeType).toBe('OWN')
  })

  it('keeps legacy (non-team) roles on their catalogue permissions and membership scope', () => {
    const access = resolveAccess({ roleSlug: 'support_agent', legacyScope: 'ASSIGNED', dbRolePermissions: ['tickets.view'] })
    expect(access.scopeType).toBe('ASSIGNED')
    expect(access.permissions.has('tickets.create')).toBe(true)
    expect(access.permissions.has('leads.view')).toBe(false)
  })

  it('applies per-user overrides after the role', () => {
    const access = resolveAccess({
      roleSlug: 'sales_rep',
      overrides: [{ action: 'leads.export', granted: true }, { action: 'leads.create', granted: false }],
    })
    expect(access.permissions.has('leads.export')).toBe(true)
    expect(access.permissions.has('leads.create')).toBe(false)
  })

  it('never lets an override or policy hand out super admin powers', () => {
    const access = resolveAccess({
      roleSlug: 'admin',
      overrides: [{ action: 'roles.manage', granted: true }, { action: 'super_admin', granted: true }],
    })
    expect(access.permissions.has('roles.manage')).toBe(false)
    expect(access.permissions.has('super_admin')).toBe(false)
  })
})

describe('helpers', () => {
  it('expands capabilities and ignores unknown keys', () => {
    const p = permissionsForCapabilities(['crm.view', 'not.a.capability'])
    expect([...p].sort()).toEqual(['accounts.view', 'activities.view', 'contacts.view', 'dashboard.view'])
  })

  it('reports the super admin as having every capability', () => {
    expect(roleCapabilities('super_admin', { capabilities: [], recordScope: 'OWN' })).toHaveLength(CAPABILITIES.length)
    expect(roleCapabilities('sales_rep', { capabilities: ['leads.view', 'bogus'], recordScope: 'OWN' })).toEqual(['leads.view'])
  })

  it('only a super admin may grant super admin', () => {
    expect(canAssignRole('super_admin', 'super_admin')).toBe(true)
    expect(canAssignRole('admin', 'super_admin')).toBe(false)
    expect(canAssignRole('admin', 'marketing')).toBe(true)
    expect(canAssignRole('admin', 'made_up')).toBe(false)
  })

  it('knows team and legacy roles', () => {
    expect(isKnownRole('marketing')).toBe(true)
    expect(isKnownRole('support_agent')).toBe(true)
    expect(isKnownRole('nope')).toBe(false)
  })

  it('maps API visibility values', () => {
    expect(scopeFromVisibility('organisation')).toBe('ORGANISATION')
    expect(scopeFromVisibility('team')).toBe('TEAM')
    expect(scopeFromVisibility('own')).toBe('OWN')
    expect(scopeFromVisibility('assigned')).toBe('OWN')
    expect(scopeFromVisibility('default')).toBeNull()
    expect(scopeFromVisibility(undefined)).toBeNull()
  })
})
