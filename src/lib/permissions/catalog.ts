/**
 * Client-safe permission catalogue: every permission string and the built-in
 * role defaults. No Prisma import here, so UI code can use it too.
 */

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

  // Email campaigns
  CAMPAIGNS_SEND: 'campaigns.send',

  // Organisation Management (internal only)
  ORGS_VIEW: 'organisations.view',
  ORGS_MANAGE: 'organisations.manage',

  // Roles & access matrix (super admin only)
  ROLES_MANAGE: 'roles.manage',

  // Super Admin
  SUPER_ADMIN: 'super_admin',
} as const

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS]

// Role-permission mapping (system defaults) for roles outside the team set.
// Use defaultRolePermissions() from ./access for the complete picture.
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

  // sales_head, sales_rep, csm_head, csm, admin and marketing are team roles: their
  // defaults come from capabilities in ./access.ts (TEAM_ROLES) and are editable per org.

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
