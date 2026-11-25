/**
 * Team access model: the roles an organisation hands out to its Marketing, Sales and
 * Customer Success people, the capabilities shown in Settings -> Roles & access, and
 * the rules that turn (role defaults + organisation customisation + member override)
 * into the effective permission set and record visibility.
 *
 * Pure and client-safe (no Prisma): the server enforces with it in getAuthContext,
 * the settings UI renders the same matrix from it.
 */

import { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './catalog'

export type RecordScope = 'OWN' | 'ASSIGNED' | 'TEAM' | 'ORGANISATION'

/** Visibility choices offered in the UI. ASSIGNED stays valid for legacy memberships. */
export const VISIBILITY_OPTIONS: Array<{ value: RecordScope; label: string; description: string }> = [
  { value: 'ORGANISATION', label: 'All records', description: 'Every lead, deal and account in the workspace.' },
  { value: 'TEAM', label: 'Team records', description: "Records assigned to anyone in the member's team." },
  { value: 'OWN', label: 'Own records', description: 'Only records assigned to or created by the member.' },
]

export const SUPER_ADMIN_ROLE = 'super_admin'

/* ---------- Capabilities (rows of the matrix) ---------- */

export interface Capability {
  key: string
  label: string
  description: string
  permissions: Permission[]
}

export interface CapabilityGroup {
  id: string
  label: string
  capabilities: Capability[]
}

const P = PERMISSIONS

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    id: 'leads',
    label: 'Leads',
    capabilities: [
      { key: 'leads.view', label: 'View leads', description: 'Open the Leads page. Which leads appear depends on visibility.', permissions: [P.LEADS_VIEW] },
      { key: 'leads.create', label: 'Create leads', description: 'Add new leads by hand.', permissions: [P.LEADS_CREATE] },
      { key: 'leads.update', label: 'Edit leads', description: 'Edit name, stage, next action, follow-ups and priority, and add extra contacts to visible leads.', permissions: [P.LEADS_UPDATE] },
      { key: 'leads.delete', label: 'Delete leads', description: 'Remove leads.', permissions: [P.LEADS_DELETE] },
      { key: 'leads.assign', label: 'Assign leads', description: 'Give leads to a team member or move them to someone else.', permissions: [P.LEADS_ASSIGN] },
      { key: 'leads.import', label: 'Import leads', description: 'Upload lead files.', permissions: [P.LEADS_IMPORT, P.IMPORT_MANAGE] },
      { key: 'leads.export', label: 'Export leads', description: 'Download visible leads as CSV.', permissions: [P.LEADS_EXPORT] },
      { key: 'leads.convert', label: 'Convert leads', description: 'Create the customer account for a lead that signed up.', permissions: [P.LEADS_CONVERT] },
    ],
  },
  {
    id: 'customers',
    label: 'Contacts, accounts & deals',
    capabilities: [
      { key: 'crm.view', label: 'View contacts & accounts', description: 'See contacts, accounts and their activity history.', permissions: [P.CONTACTS_VIEW, P.ACCOUNTS_VIEW, P.ACTIVITIES_VIEW] },
      { key: 'crm.edit', label: 'Edit contacts & accounts', description: 'Create and update contacts, accounts and logged activities.', permissions: [P.CONTACTS_CREATE, P.CONTACTS_UPDATE, P.ACCOUNTS_CREATE, P.ACCOUNTS_UPDATE, P.ACTIVITIES_CREATE, P.ACTIVITIES_UPDATE] },
      { key: 'deals.view', label: 'View deals', description: 'See the opportunity pipeline.', permissions: [P.OPPORTUNITIES_VIEW] },
      { key: 'deals.manage', label: 'Manage deals', description: 'Create deals and move them through stages.', permissions: [P.OPPORTUNITIES_CREATE, P.OPPORTUNITIES_UPDATE] },
    ],
  },
  {
    id: 'success',
    label: 'Customer success',
    capabilities: [
      { key: 'cs.view', label: 'View onboarding & tickets', description: 'See customer onboarding projects and support tickets.', permissions: [P.ONBOARDING_VIEW, P.TICKETS_VIEW] },
      { key: 'cs.manage', label: 'Manage onboarding & tickets', description: 'Run onboarding projects and handle support tickets.', permissions: [P.ONBOARDING_MANAGE, P.TICKETS_CREATE, P.TICKETS_UPDATE, P.TICKETS_MANAGE] },
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing',
    capabilities: [
      { key: 'campaigns.send', label: 'Send email campaigns', description: 'Write and send campaigns to an audience or to hand-picked visible leads.', permissions: [P.CAMPAIGNS_SEND] },
    ],
  },
  {
    id: 'insights',
    label: 'Reports',
    capabilities: [
      { key: 'reports.view', label: 'View reports', description: 'Dashboards and reports, limited to visible records.', permissions: [P.REPORTS_VIEW] },
      { key: 'reports.export', label: 'Export reports', description: 'Download report data and contact, account and deal CSVs.', permissions: [P.REPORTS_EXPORT, P.EXPORT_MANAGE] },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    capabilities: [
      { key: 'members.view', label: 'See team members', description: 'See who is on the team (needed to pick an owner when assigning).', permissions: [P.USERS_VIEW, P.TEAMS_VIEW] },
      { key: 'members.manage', label: 'Manage members', description: 'Invite people, change their role and deactivate them.', permissions: [P.USERS_VIEW, P.USERS_INVITE, P.USERS_MANAGE, P.TEAMS_VIEW, P.TEAMS_MANAGE] },
      { key: 'settings.manage', label: 'Workspace settings & sync', description: 'Organisation settings, Google Sheet sync, automations and the audit log.', permissions: [P.SETTINGS_MANAGE, P.AUDIT_VIEW, P.AUTOMATIONS_VIEW, P.AUTOMATIONS_MANAGE] },
      { key: 'billing.view', label: 'View billing', description: 'Subscriptions, invoices and payments.', permissions: [P.BILLING_VIEW] },
    ],
  },
]

export const CAPABILITIES: Capability[] = CAPABILITY_GROUPS.flatMap(g => g.capabilities)
export const CAPABILITY_KEYS = new Set(CAPABILITIES.map(c => c.key))

/** Always granted to every team role: the app shell, tasks and notifications need it. */
export const BASE_PERMISSIONS: Permission[] = [P.DASHBOARD_VIEW]

/* ---------- Team roles (columns of the matrix) ---------- */

export interface TeamRole {
  slug: string
  name: string
  description: string
  defaultScope: RecordScope
  defaultCapabilities: string[]
  /** Super admin: always everything, cannot be edited. */
  locked?: boolean
}

const ALL_CAPABILITIES = CAPABILITIES.map(c => c.key)

export const TEAM_ROLES: TeamRole[] = [
  {
    slug: SUPER_ADMIN_ROLE,
    name: 'Super admin',
    description: 'Full access to everything, including who can do what.',
    defaultScope: 'ORGANISATION',
    defaultCapabilities: ALL_CAPABILITIES,
    locked: true,
  },
  {
    slug: 'admin',
    name: 'Admin',
    description: 'Runs the workspace and the team. Cannot change role permissions.',
    defaultScope: 'ORGANISATION',
    defaultCapabilities: ALL_CAPABILITIES,
  },
  {
    slug: 'marketing',
    name: 'Marketing',
    description: 'Brings leads in, distributes them and runs campaigns.',
    defaultScope: 'ORGANISATION',
    defaultCapabilities: [
      'leads.view', 'leads.create', 'leads.update', 'leads.assign', 'leads.import', 'leads.export',
      'crm.view', 'campaigns.send', 'reports.view', 'reports.export', 'members.view',
    ],
  },
  {
    slug: 'sales_head',
    name: 'Sales Manager',
    description: 'Owns the sales pipeline and hands leads to the sales team.',
    defaultScope: 'ORGANISATION',
    defaultCapabilities: [
      'leads.view', 'leads.create', 'leads.update', 'leads.delete', 'leads.assign', 'leads.export', 'leads.convert',
      'crm.view', 'crm.edit', 'deals.view', 'deals.manage', 'cs.view', 'reports.view', 'reports.export', 'members.view',
    ],
  },
  {
    slug: 'sales_rep',
    name: 'Sales',
    description: 'Works the leads and deals assigned to them.',
    defaultScope: 'OWN',
    defaultCapabilities: [
      'leads.view', 'leads.create', 'leads.update', 'leads.convert',
      'crm.view', 'crm.edit', 'deals.view', 'deals.manage', 'reports.view', 'members.view',
    ],
  },
  {
    slug: 'csm_head',
    name: 'CS Manager',
    description: 'Leads customer success: onboarding and support tickets.',
    defaultScope: 'ORGANISATION',
    defaultCapabilities: [
      'leads.view', 'leads.update', 'leads.assign', 'crm.view', 'crm.edit', 'deals.view',
      'cs.view', 'cs.manage', 'reports.view', 'reports.export', 'members.view',
    ],
  },
  {
    slug: 'csm',
    name: 'CSM',
    description: 'Looks after the customers and leads assigned to them.',
    defaultScope: 'OWN',
    defaultCapabilities: [
      'leads.view', 'leads.update', 'crm.view', 'crm.edit', 'deals.view',
      'cs.view', 'cs.manage', 'reports.view', 'members.view',
    ],
  },
]

const TEAM_ROLE_BY_SLUG = new Map(TEAM_ROLES.map(r => [r.slug, r]))

export function teamRole(slug: string): TeamRole | undefined {
  return TEAM_ROLE_BY_SLUG.get(slug)
}

/* ---------- Resolution ---------- */

/** Expand capability keys into permission strings (unknown keys are ignored). */
export function permissionsForCapabilities(capabilities: Iterable<string>): Set<string> {
  const wanted = new Set(capabilities)
  const out = new Set<string>(BASE_PERMISSIONS)
  for (const cap of CAPABILITIES) {
    if (wanted.has(cap.key)) for (const p of cap.permissions) out.add(p)
  }
  return out
}

/** Built-in permissions per role slug: team roles from their capabilities, the rest from the catalogue. */
export function defaultRolePermissions(slug: string): Permission[] {
  if (slug === SUPER_ADMIN_ROLE) return Object.values(PERMISSIONS)
  const role = teamRole(slug)
  if (role) return Array.from(permissionsForCapabilities(role.defaultCapabilities)) as Permission[]
  return ROLE_PERMISSIONS[slug] ?? []
}

/** Every role slug that may be given to a member. */
export function isKnownRole(slug: string): boolean {
  return TEAM_ROLE_BY_SLUG.has(slug) || slug in ROLE_PERMISSIONS
}

export interface RolePolicy {
  capabilities: string[]
  recordScope: RecordScope
}

export interface AccessInput {
  roleSlug: string
  /** Permissions linked to the role row in the database (legacy roles only). */
  dbRolePermissions?: string[]
  /** The organisation's customisation for this role, if any. */
  policy?: RolePolicy | null
  /** Membership.scopeOverride */
  memberScopeOverride?: RecordScope | null
  /** Membership.scopeType: the legacy per-member scope, used for roles outside the team set. */
  legacyScope?: RecordScope | null
  /** Explicit per-user grants/denials. */
  overrides?: Array<{ action: string; granted: boolean }>
}

export interface EffectiveAccess {
  permissions: Set<string>
  scopeType: RecordScope
}

/**
 * The single rule for what a member can do and see:
 * - super admin: everything, all records, never customisable;
 * - team roles: the organisation's policy if saved, else the built-in defaults;
 *   visibility = member override, else the policy/default visibility;
 * - any other (legacy/practice) role: catalogue + DB role permissions and the membership scope, as before;
 * - per-user overrides apply last (except to the super admin).
 */
export function resolveAccess(input: AccessInput): EffectiveAccess {
  if (input.roleSlug === SUPER_ADMIN_ROLE) {
    return { permissions: new Set<string>(Object.values(PERMISSIONS)), scopeType: 'ORGANISATION' }
  }

  const role = teamRole(input.roleSlug)
  let permissions: Set<string>
  let scopeType: RecordScope

  if (role) {
    permissions = input.policy
      ? permissionsForCapabilities(input.policy.capabilities)
      : new Set<string>(defaultRolePermissions(role.slug))
    scopeType = input.memberScopeOverride ?? input.policy?.recordScope ?? role.defaultScope
  } else {
    permissions = new Set<string>([...(input.dbRolePermissions ?? []), ...(ROLE_PERMISSIONS[input.roleSlug] ?? [])])
    scopeType = input.memberScopeOverride ?? input.legacyScope ?? 'ASSIGNED'
  }

  for (const o of input.overrides ?? []) {
    if (o.granted) permissions.add(o.action)
    else permissions.delete(o.action)
  }
  // Only the super admin role may ever hold these, whatever an override says.
  permissions.delete(PERMISSIONS.SUPER_ADMIN)
  permissions.delete(PERMISSIONS.ROLES_MANAGE)

  return { permissions, scopeType }
}

/** Capability keys currently switched on for a role (policy or defaults). */
export function roleCapabilities(slug: string, policy?: RolePolicy | null): string[] {
  const role = teamRole(slug)
  if (!role) return []
  if (role.locked) return ALL_CAPABILITIES
  return policy ? policy.capabilities.filter(k => CAPABILITY_KEYS.has(k)) : role.defaultCapabilities
}

/**
 * Who may give which role. Only a super admin may hand out (or take away) super admin;
 * anyone else with members.manage may give any other role.
 */
export function canAssignRole(actorRoleSlug: string, targetRoleSlug: string): boolean {
  if (targetRoleSlug === SUPER_ADMIN_ROLE) return actorRoleSlug === SUPER_ADMIN_ROLE
  return isKnownRole(targetRoleSlug)
}

/** UI visibility labels, mapping legacy ASSIGNED onto "Own records". */
export function visibilityLabel(scope: RecordScope | null | undefined): string {
  if (scope === 'ORGANISATION') return 'All records'
  if (scope === 'TEAM') return 'Team records'
  return 'Own records'
}

/** Map the API's visibility value onto Membership.scopeOverride (null = follow the role). */
export function scopeFromVisibility(value: string | null | undefined): RecordScope | null {
  switch (value) {
    case 'organisation': return 'ORGANISATION'
    case 'team': return 'TEAM'
    case 'own':
    case 'assigned': return 'OWN'
    default: return null
  }
}
