/**
 * Internal shared helpers used by the API layer.
 */

import { PERMISSIONS, type Permission } from '@/lib/permissions'

/** Exportable entity catalogue: name -> (permission + prisma selector) */
export const EXPORTABLE_ENTITIES: Record<
  string,
  { permission: Permission; label: string }
> = {
  leads: { permission: PERMISSIONS.LEADS_VIEW, label: 'Leads' },
  contacts: { permission: PERMISSIONS.CONTACTS_VIEW, label: 'Contacts' },
  accounts: { permission: PERMISSIONS.ACCOUNTS_VIEW, label: 'Accounts' },
  opportunities: { permission: PERMISSIONS.OPPORTUNITIES_VIEW, label: 'Opportunities' },
  tickets: { permission: PERMISSIONS.TICKETS_VIEW, label: 'Tickets' },
}
