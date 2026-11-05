/**
 * Role slugs selectable when inviting a member. These are the slugs the RBAC
 * sync writes to the `roles` table and `ROLE_PERMISSIONS` authorises against —
 * kept as data here because `lib/permissions` imports Prisma and is not
 * client-safe.
 */
export const ROLE_SLUGS = [
  'super_admin',
  'executive',
  'sales_head',
  'sales_rep',
  'csm_head',
  'csm',
  'support_admin',
  'support_agent',
  'finance_admin',
  'operations_admin',
  'analyst',
  'practice_owner',
  'practice_admin',
  'therapist',
  'receptionist',
  'practice_finance',
  'practice_readonly',
] as const
