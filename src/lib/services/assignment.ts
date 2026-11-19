/**
 * Lead ownership rules shared by create, edit and bulk-assign:
 * giving a lead to someone other than yourself needs leads.assign, and the new owner
 * must be an active member of the same organisation.
 */

import { db } from '@/lib/db'
import { hasPermission, PERMISSIONS, PermissionDeniedError, type AuthContext } from '@/lib/permissions'
import { ValidationFailedError } from '@/lib/services/errors'

/**
 * Throw unless the caller may set `assignedToUserId` from `currentOwnerId` to `nextOwnerId`.
 * Keeping the owner unchanged is always allowed; anything else needs leads.assign,
 * except taking an unassigned lead for yourself on create.
 */
export function assertCanAssign(
  ctx: AuthContext,
  change: { currentOwnerId: string | null; nextOwnerId: string | null; isCreate?: boolean }
): void {
  if (change.currentOwnerId === change.nextOwnerId) return
  if (change.isCreate && change.nextOwnerId === ctx.userId) return
  if (!hasPermission(ctx, PERMISSIONS.LEADS_ASSIGN)) {
    throw new PermissionDeniedError(PERMISSIONS.LEADS_ASSIGN)
  }
}

/** Throw unless `userId` holds an active seat in the organisation. */
export async function assertActiveMember(organisationId: string, userId: string): Promise<void> {
  const member = await db.membership.findFirst({
    where: { organisationId, userId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!member) throw new ValidationFailedError('The selected owner is not an active member of this workspace')
}
