/**
 * PUT /api/access/roles/[slug] — save what a team role can do and see in this organisation.
 * DELETE /api/access/roles/[slug] — reset the role to its built-in defaults.
 * Super admin only (roles.manage); the super admin role itself can never be edited.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, parseJsonBody, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { CAPABILITY_KEYS, teamRole } from '@/lib/permissions/access'
import { ensureRole } from '@/lib/rbac/sync'
import { rolePolicySchema } from '@/lib/validations/admin'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

type Ctx = { params: Promise<{ slug: string }> }

const fail = (error: string, code: string, status: number) =>
  NextResponse.json({ success: false, error, code, requestId: uuidv4() }, { status })

async function editableRole(slug: string) {
  const role = teamRole(slug)
  if (!role) return { error: fail('Unknown role', 'NOT_FOUND', 404) }
  if (role.locked) return { error: fail('The super admin role always has full access and cannot be changed.', 'VALIDATION_ERROR', 400) }
  const row = await ensureRole(slug)
  if (!row) return { error: fail('Role not synced; run the seed first', 'SYSTEM_ERROR', 500) }
  return { role, row }
}

export const PUT = routeHandler(async (req: NextRequest, context: Ctx) => {
  const { slug } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ROLES_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const body = await parseJsonBody(req, rolePolicySchema)
  const unknown = body.capabilities.filter(k => !CAPABILITY_KEYS.has(k))
  if (unknown.length) return fail(`Unknown capability: ${unknown.join(', ')}`, 'VALIDATION_ERROR', 400)

  const found = await editableRole(slug)
  if (found.error) return found.error
  const capabilities = Array.from(new Set(body.capabilities)).sort()

  const before = await db.orgRolePolicy.findUnique({
    where: { organisationId_roleId: { organisationId, roleId: found.row.id } },
    select: { capabilities: true, recordScope: true },
  })
  const saved = await db.orgRolePolicy.upsert({
    where: { organisationId_roleId: { organisationId, roleId: found.row.id } },
    create: { organisationId, roleId: found.row.id, capabilities, recordScope: body.recordScope, updatedByUserId: user.id },
    update: { capabilities, recordScope: body.recordScope, updatedByUserId: user.id },
  })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'role.access_changed',
    resourceType: 'role',
    resourceId: found.row.id,
    ipHash,
    beforeJson: before ?? { defaults: true, capabilities: found.role.defaultCapabilities, recordScope: found.role.defaultScope },
    afterJson: { role: slug, capabilities, recordScope: body.recordScope },
  })

  return NextResponse.json({ success: true, data: saved, requestId: uuidv4() })
})

export const DELETE = routeHandler(async (req: NextRequest, context: Ctx) => {
  const { slug } = await context.params
  const guard = await guardedRoute(req, { permission: PERMISSIONS.ROLES_MANAGE, policy: 'apiWrite', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const found = await editableRole(slug)
  if (found.error) return found.error

  const { count } = await db.orgRolePolicy.deleteMany({ where: { organisationId, roleId: found.row.id } })
  if (count) {
    await createAuditLog({
      organisationId,
      actorUserId: user.id,
      action: 'role.access_reset',
      resourceType: 'role',
      resourceId: found.row.id,
      ipHash,
      afterJson: { role: slug, defaults: true },
    })
  }
  return NextResponse.json({ success: true, data: { reset: true }, requestId: uuidv4() })
})
