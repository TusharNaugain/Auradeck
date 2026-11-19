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

import { PERMISSIONS, type Permission } from './catalog'
import { resolveAccess, type RecordScope } from './access'

export { PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './catalog'

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
 * Returns null if the user is not an active member of the organisation.
 * Permissions and record visibility come from resolveAccess (./access): role defaults,
 * the organisation's Roles & access customisation, the member's visibility override and
 * per-user overrides.
 */
export const getAuthContext = cache(async (
  userId: string,
  organisationId: string
): Promise<AuthContext | null> => {
  const [membership, overrides] = await Promise.all([
    db.membership.findFirst({
      where: { userId, organisationId, status: 'ACTIVE' },
      include: { role: { include: { permissions: true } } },
    }),
    db.userPermissionOverride.findMany({
      where: { userId, organisationId },
      include: { permission: true },
    }),
  ])

  if (!membership) return null

  const policy = await db.orgRolePolicy.findUnique({
    where: { organisationId_roleId: { organisationId, roleId: membership.roleId } },
    select: { capabilities: true, recordScope: true },
  })

  const access = resolveAccess({
    roleSlug: membership.role.slug,
    dbRolePermissions: membership.role.permissions.map(p => p.action),
    policy: policy ? { capabilities: policy.capabilities, recordScope: policy.recordScope as RecordScope } : null,
    memberScopeOverride: (membership.scopeOverride ?? null) as RecordScope | null,
    legacyScope: membership.scopeType as RecordScope,
    overrides: overrides.map(o => ({ action: o.permission.action, granted: o.granted })),
  })

  return {
    userId,
    organisationId,
    roleSlug: membership.role.slug,
    permissions: access.permissions,
    scopeType: access.scopeType,
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
