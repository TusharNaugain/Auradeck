/**
 * Role-Based Access Control (RBAC) with resource-level and field-level authorization.
 *
 * Permission format: "resource.action"
 * Examples: "leads.view", "leads.create", "tickets.manage"
 *
 * Principles:
 * - Deny by default
 * - Check server-side on every mutation and protected read
 * - Support explicit user permission overrides
 * - Log permission denials
 */

import { cache } from 'react'
import { db } from '@/lib/db'
import { createAuditLog } from '@/lib/audit'

// All system permissions
export const PERMISSIONS = {
  // Dashboard
  DASHBOARD_VIEW: 'dashboard.view',

  // Leads
  LEADS_VIEW: 'leads.view',
  LEADS_CREATE: 'leads.create',
  LEADS_UPDATE: 'leads.update',
  LEADS_DELETE: 'leads.delete',
  LEADS_EXPORT: 'leads.export',
  LEADS_IMPORT: 'leads.import',
  LEADS_ASSIGN: 'leads.assign',
  LEADS_CONVERT: 'leads.convert',

  // Accounts
  ACCOUNTS_VIEW: 'accounts.view',
  ACCOUNTS_CREATE: 'accounts.create',
  ACCOUNTS_UPDATE: 'accounts.update',
  ACCOUNTS_DELETE: 'accounts.delete',
  ACCOUNTS_MANAGE: 'accounts.manage',

  // Contacts
  CONTACTS_VIEW: 'contacts.view',
  CONTACTS_CREATE: 'contacts.create',
  CONTACTS_UPDATE: 'contacts.update',
  CONTACTS_DELETE: 'contacts.delete',
  CONTACTS_MANAGE: 'contacts.manage',

  // Opportunities
  OPPORTUNITIES_VIEW: 'opportunities.view',
  OPPORTUNITIES_CREATE: 'opportunities.create',
  OPPORTUNITIES_UPDATE: 'opportunities.update',
  OPPORTUNITIES_DELETE: 'opportunities.delete',
  OPPORTUNITIES_MANAGE: 'opportunities.manage',

  // Activities
  ACTIVITIES_VIEW: 'activities.view',
  ACTIVITIES_CREATE: 'activities.create',
  ACTIVITIES_UPDATE: 'activities.update',
  ACTIVITIES_DELETE: 'activities.delete',

  // Onboarding
  ONBOARDING_VIEW: 'onboarding.view',
  ONBOARDING_MANAGE: 'onboarding.manage',

  // Customer Success
  SUCCESS_VIEW: 'success.view',
  SUCCESS_MANAGE: 'success.manage',

  // Support Tickets
  TICKETS_VIEW: 'tickets.view',
  TICKETS_CREATE: 'tickets.create',
  TICKETS_UPDATE: 'tickets.update',
  TICKETS_MANAGE: 'tickets.manage',
  TICKETS_ASSIGN: 'tickets.assign',
  TICKETS_INTERNAL_NOTES: 'tickets.internal_notes',

  // Clients (practice-specific, privacy-controlled)
  CLIENTS_VIEW: 'clients.view',
  CLIENTS_VIEW_PII: 'clients.view_pii',      // Protected: DOB, phone, address
  CLIENTS_CREATE: 'clients.create',
  CLIENTS_UPDATE: 'clients.update',
  CLIENTS_DELETE: 'clients.delete',

  // Clinical Notes (separate permission, highly restricted)
  CLINICAL_NOTES_VIEW: 'clinical_notes.view',
  CLINICAL_NOTES_CREATE: 'clinical_notes.create',
  CLINICAL_NOTES_UPDATE: 'clinical_notes.update',

  // Appointments
  APPOINTMENTS_VIEW: 'appointments.view',
  APPOINTMENTS_CREATE: 'appointments.create',
  APPOINTMENTS_UPDATE: 'appointments.update',
  APPOINTMENTS_MANAGE: 'appointments.manage',

  // Billing
  BILLING_VIEW: 'billing.view',
  BILLING_MANAGE: 'billing.manage',
  BILLING_EXPORT: 'billing.export',

  // Reports
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  // Settings
  SETTINGS_MANAGE: 'settings.manage',

  // Users
  USERS_INVITE: 'users.invite',
  USERS_MANAGE: 'users.manage',
  USERS_VIEW: 'users.view',

  // Teams
  TEAMS_VIEW: 'teams.view',
  TEAMS_MANAGE: 'teams.manage',

  // Audit
  AUDIT_VIEW: 'audit.view',
  AUDIT_EXPORT: 'audit.export',

  // Automations
  AUTOMATIONS_VIEW: 'automations.view',
  AUTOMATIONS_MANAGE: 'automations.manage',

  // Import/Export
  IMPORT_MANAGE: 'import.manage',
  EXPORT_MANAGE: 'export.manage',

  // Organisation Management (internal only)
  ORGS_VIEW: 'organisations.view',
  ORGS_MANAGE: 'organisations.manage',

  // Super Admin
  SUPER_ADMIN: 'super_admin',
} as const

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// Role-permission mapping (system defaults)
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  super_admin: Object.values(PERMISSIONS),

  executive: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.LEADS_VIEW,
    PERMISSIONS.LEADS_EXPORT,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ONBOARDING_VIEW,
    PERMISSIONS.SUCCESS_VIEW,
    PERMISSIONS.TICKETS_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.TEAMS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.ORGS_VIEW,
  ],

  sales_head: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.LEADS_VIEW,
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_UPDATE,
    PERMISSIONS.LEADS_DELETE,
    PERMISSIONS.LEADS_EXPORT,
    PERMISSIONS.LEADS_IMPORT,
    PERMISSIONS.LEADS_ASSIGN,
    PERMISSIONS.LEADS_CONVERT,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.ACCOUNTS_CREATE,
    PERMISSIONS.ACCOUNTS_UPDATE,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_MANAGE,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.OPPORTUNITIES_MANAGE,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_UPDATE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.TEAMS_VIEW,
    PERMISSIONS.BILLING_VIEW,
  ],

  sales_rep: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.LEADS_VIEW,
    PERMISSIONS.LEADS_CREATE,
    PERMISSIONS.LEADS_UPDATE,
    PERMISSIONS.LEADS_CONVERT,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_CREATE,
    PERMISSIONS.CONTACTS_UPDATE,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.OPPORTUNITIES_CREATE,
    PERMISSIONS.OPPORTUNITIES_UPDATE,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_UPDATE,
    PERMISSIONS.REPORTS_VIEW,
  ],

  csm_head: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_MANAGE,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.OPPORTUNITIES_MANAGE,
    PERMISSIONS.ONBOARDING_VIEW,
    PERMISSIONS.ONBOARDING_MANAGE,
    PERMISSIONS.SUCCESS_VIEW,
    PERMISSIONS.SUCCESS_MANAGE,
    PERMISSIONS.TICKETS_VIEW,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_UPDATE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.BILLING_VIEW,
  ],

  csm: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.ACCOUNTS_UPDATE,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_CREATE,
    PERMISSIONS.CONTACTS_UPDATE,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.OPPORTUNITIES_CREATE,
    PERMISSIONS.ONBOARDING_VIEW,
    PERMISSIONS.ONBOARDING_MANAGE,
    PERMISSIONS.SUCCESS_VIEW,
    PERMISSIONS.SUCCESS_MANAGE,
    PERMISSIONS.TICKETS_VIEW,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.ACTIVITIES_UPDATE,
    PERMISSIONS.REPORTS_VIEW,
  ],

  support_admin: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TICKETS_VIEW,
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_MANAGE,
    PERMISSIONS.TICKETS_ASSIGN,
    PERMISSIONS.TICKETS_INTERNAL_NOTES,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.ACTIVITIES_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.USERS_VIEW,
  ],

  support_agent: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.TICKETS_VIEW,
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_UPDATE,
    PERMISSIONS.TICKETS_INTERNAL_NOTES,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.ACTIVITIES_CREATE,
  ],

  finance_admin: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.BILLING_EXPORT,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.REPORTS_EXPORT,
  ],

  operations_admin: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.ACCOUNTS_MANAGE,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_INVITE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.TEAMS_VIEW,
    PERMISSIONS.TEAMS_MANAGE,
    PERMISSIONS.ONBOARDING_VIEW,
    PERMISSIONS.ONBOARDING_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.ORGS_VIEW,
    PERMISSIONS.ORGS_MANAGE,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.IMPORT_MANAGE,
    PERMISSIONS.EXPORT_MANAGE,
  ],

  analyst: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.LEADS_VIEW,
    PERMISSIONS.ACCOUNTS_VIEW,
    PERMISSIONS.OPPORTUNITIES_VIEW,
    PERMISSIONS.TICKETS_VIEW,
  ],

  // Practice roles
  practice_owner: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_VIEW_PII,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.CLIENTS_DELETE,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_MANAGE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_INVITE,
    PERMISSIONS.USERS_MANAGE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_MANAGE,
  ],

  practice_admin: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_VIEW_PII,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_MANAGE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.USERS_VIEW,
    PERMISSIONS.USERS_INVITE,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_MANAGE,
  ],

  therapist: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_VIEW_PII,
    PERMISSIONS.CLINICAL_NOTES_VIEW,
    PERMISSIONS.CLINICAL_NOTES_CREATE,
    PERMISSIONS.CLINICAL_NOTES_UPDATE,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_UPDATE,
  ],

  receptionist: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.CLIENTS_CREATE,
    PERMISSIONS.CLIENTS_UPDATE,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_CREATE,
    PERMISSIONS.APPOINTMENTS_UPDATE,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.CONTACTS_VIEW,
    PERMISSIONS.CONTACTS_CREATE,
  ],

  practice_finance: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.BILLING_VIEW,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],

  practice_readonly: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CLIENTS_VIEW,
    PERMISSIONS.APPOINTMENTS_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],
}

export interface AuthContext {
  userId: string
  organisationId: string
  roleSlug: string
  permissions: Set<string>
  scopeType: string
  teamId: string | null
}

/**
 * Load the auth context for a user within an organisation.
 * Returns null if the user is not a member of the organisation.
 */
export const getAuthContext = cache(async (
  userId: string,
  organisationId: string
): Promise<AuthContext | null> => {
  const [membership, overrides] = await Promise.all([
    db.membership.findFirst({
      where: {
        userId,
        organisationId,
        status: 'ACTIVE',
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    }),
    db.userPermissionOverride.findMany({
      where: {
        userId,
        organisationId,
      },
      include: {
        permission: true,
      },
    }),
  ])

  if (!membership) return null

  // Build permission set from role
  const permissionSet = new Set<string>(
    membership.role.permissions.map(p => p.action)
  )

  // Add ROLE_PERMISSIONS defaults
  const rolePerms = ROLE_PERMISSIONS[membership.role.slug] ?? []
  for (const perm of rolePerms) {
    permissionSet.add(perm)
  }

  // Apply explicit overrides
  for (const override of overrides) {
    if (override.granted) {
      permissionSet.add(override.permission.action)
    } else {
      permissionSet.delete(override.permission.action)
    }
  }

  return {
    userId,
    organisationId,
    roleSlug: membership.role.slug,
    permissions: permissionSet,
    scopeType: membership.scopeType,
    teamId: membership.teamId,
  }
})

/**
 * Check if a user has a specific permission.
 * Super admin bypasses all permission checks.
 */
export function hasPermission(
  ctx: AuthContext,
  permission: Permission
): boolean {
  if (ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) return true
  return ctx.permissions.has(permission)
}

/**
 * Assert that a user has a permission; throw if not.
 * Logs the denial for security audit.
 */
export async function assertPermission(
  ctx: AuthContext,
  permission: Permission,
  resourceType?: string,
  resourceId?: string
): Promise<void> {
  if (hasPermission(ctx, permission)) return

  // Log the denial
  await createAuditLog({
    organisationId: ctx.organisationId,
    actorUserId: ctx.userId,
    action: 'permission.denied',
    resourceType: resourceType ?? 'unknown',
    resourceId: resourceId,
    reason: `Missing permission: ${permission}`,
  })

  throw new PermissionDeniedError(permission)
}

/**
 * Custom permission denied error.
 * Does NOT reveal whether the resource exists.
 */
export class PermissionDeniedError extends Error {
  public readonly statusCode = 403
  public readonly code = 'PERMISSION_DENIED'

  constructor(permission?: string) {
    super(
      permission
        ? `You do not have the required permission: ${permission}`
        : 'You do not have permission to perform this action'
    )
    this.name = 'PermissionDeniedError'
  }
}

/**
 * Field-level masking for sensitive fields.
 * Returns a redacted version of the object based on permissions.
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  ctx: AuthContext,
  sensitiveFields: Array<{ field: keyof T; permission: Permission }>
): T {
  const masked = { ...obj }

  for (const { field, permission } of sensitiveFields) {
    if (!hasPermission(ctx, permission)) {
      masked[field] = '***' as T[keyof T]
    }
  }

  return masked
}
