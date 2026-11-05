/**
 * RBAC sync: keeps Roles + Permission rows in the database in lock-step with
 * the code-defined PERMISSIONS catalogue and ROLE_PERMISSIONS mapping.
 * System roles are marked isSystem so admins cannot mangle them via UI.
 * Call from seed and from a post-migration job.
 */

import { db } from '@/lib/db'
import { PERMISSIONS, ROLE_PERMISSIONS } from '@/lib/permissions'

export const ROLE_DEFINITIONS: Array<{
  slug: string
  name: string
  description: string
  organisationType: 'AURADESK_INTERNAL' | 'CUSTOMER_PRACTICE' | null
}> = [
  { slug: 'super_admin', name: 'Super Admin', description: 'Full platform access', organisationType: null },
  { slug: 'executive', name: 'Executive / Management', description: 'Dashboards, reports, and portfolio visibility', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'sales_head', name: 'Sales Head', description: 'Manage entire sales pipeline and team', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'sales_rep', name: 'Sales Representative', description: 'Manage assigned leads and opportunities', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'csm_head', name: 'Customer Success Head', description: 'Portfolio management, renewals, health', organisationType: 'AURADESK_INTERNAL' },
  { slug: 'csm', name: 'Customer Success Manager', description: 'Assigned accounts, onboarding, success plans', organisationType: 'AURADESK_INTERNAL' },
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

    const rolePerms = ROLE_PERMISSIONS[def.slug] ?? []
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
