/**
 * RBAC sync: keeps Roles + Permission rows in the database in lock-step with
 * the code-defined PERMISSIONS catalogue and ROLE_PERMISSIONS mapping.
 * System roles are marked isSystem so admins cannot mangle them via UI.
 * Call from seed and from a post-migration job.
 */

import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/permissions'
import { defaultRolePermissions } from '@/lib/permissions/access'

export const ROLE_DEFINITIONS: Array<{
  slug: string
  name: string
  description: string
  organisationType: 'AURADESK_INTERNAL' | 'CUSTOMER_PRACTICE' | null
}> = [
  { slug: 'super_admin', name: 'Super admin', description: 'Full platform access', organisationType: null },
  { slug: 'admin', name: 'Admin', description: 'Runs the workspace and the team', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'marketing', name: 'Marketing', description: 'Lead generation, distribution and campaigns', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'executive', name: 'Executive / Management', description: 'Dashboards, reports, and portfolio visibility', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'sales_head', name: 'Sales Manager', description: 'Owns the sales pipeline and hands out leads', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'sales_rep', name: 'Sales', description: 'Works assigned leads and deals', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'csm_head', name: 'CS Manager', description: 'Customer success: onboarding, health, renewals', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'csm', name: 'CSM', description: 'Assigned customers, onboarding, success plans', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'support_admin', name: 'Support Admin', description: 'All tickets, SLA, escalation management', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'support_agent', name: 'Support Agent', description: 'Assigned tickets and customer communication', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'finance_admin', name: 'Finance Admin', description: 'Subscriptions, invoices, payments, reports', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'operations_admin', name: 'Operations Admin', description: 'Practices, users, onboarding, settings', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'analyst', name: 'Read-only Analyst', description: 'Approved dashboards and reports only', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'practice_owner', name: 'Practice Owner', description: 'Full access to their practice', organisationType: 'CUSTOMER_PRACTICE' },
  { slug: 'practice_admin', name: 'Practice Admin', description: 'Practice setup, staff, schedules', organisationType: 'CUSTOMER_PRACTICE' },
  { slug: 'therapist', name: 'Therapist / Practitioner', description: 'Assigned clients, appointments, clinical notes', organisationType: 'CUSTOMER_PRACTICE' },
  { slug: 'receptionist', name: 'Receptionist / Front Desk', description: 'Enquiries, appointments, basic billing', organisationType: 'CUSTOMER_PRACTICE' },
  { slug: 'practice_finance', name: 'Practice Finance User', description: 'Invoices and payments only', organisationType: 'CUSTOMER_PRACTICE' },
  { slug: 'practice_readonly', name: 'Read-only Practice User', description: 'View approved practice data only', organisationType: 'CUSTOMER_PRACTICE' },
]

export async function syncRbac(): Promise<{ roles: number; permissions: number; links: number }> {
  // 1. Permissions catalogue
  const permissionValues = Object.entries(PERMISSIONS)

  for (const [constant, action] of permissionValues) {
    await db.permission.upsert({
      where: { action },
      create: {
        action,
        description: `System permission: ${constant.toLowerCase().replace(/_/g, ' ')}`,
      },
      update: {},
    })
  }

  const permissionRows = await db.permission.findMany({ select: { id: true, action: true } })
  const permissionByAction = new Map(permissionRows.map((p) => [p.action, p.id]))

  // 2. Roles and links
  let links = 0
  for (const def of ROLE_DEFINITIONS) {
    const role = await db.role.upsert({
      where: { slug: def.slug },
      create: {
        slug: def.slug,
        name: def.name,
        description: def.description,
        organisationType: def.organisationType,
        isSystem: true,
      },
      update: {
        name: def.name,
        description: def.description,
        organisationType: def.organisationType,
        isSystem: true,
      },
    })

    const rolePerms = defaultRolePermissions(def.slug)
    // Clear then reconnect (cannot mix set + connectOrCreate on one relation)
    await db.role.update({ where: { id: role.id }, data: { permissions: { set: [] } } })
    await db.role.update({
      where: { id: role.id },
      data: {
        permissions: {
          connect: rolePerms.map((action) => {
            const permissionId = permissionByAction.get(action)
            if (!permissionId) throw new Error(`Unknown permission: ${action}`)
            return { id: permissionId }
          }),
        },
      },
    })
    links += rolePerms.length
  }

  return { roles: ROLE_DEFINITIONS.length, permissions: permissionValues.length, links }
}

/**
 * Return the role row for a slug, creating it from ROLE_DEFINITIONS when it is missing
 * (a role added in code after the last bootstrap). Team roles resolve their permissions
 * from code, so the row only needs to exist for the membership foreign key.
 */
export async function ensureRole(slug: string): Promise<{ id: string; slug: string; name: string } | null> {
  const existing = await db.role.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } })
  if (existing) return existing
  const def = ROLE_DEFINITIONS.find(d => d.slug === slug)
  if (!def) return null
  return db.role.upsert({
    where: { slug },
    create: { slug, name: def.name, description: def.description, organisationType: def.organisationType, isSystem: true },
    update: {},
    select: { id: true, slug: true, name: true },
  })
}
