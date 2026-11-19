/**
 * GET /api/access/roles — the Roles & access matrix for the current organisation:
 * capability catalogue, every team role with its current capabilities and visibility
 * (customised or default) and how many active members hold it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS, hasPermission } from '@/lib/permissions'
import { CAPABILITY_GROUPS, TEAM_ROLES, roleCapabilities, type RecordScope } from '@/lib/permissions/access'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.USERS_VIEW, policy: 'apiRead', keyByUser: true })
  if (guard.response) return guard.response
  const { organisationId, ctx } = guard.context!

  const slugs = TEAM_ROLES.map(r => r.slug)
  const [policies, counts] = await Promise.all([
    db.orgRolePolicy.findMany({
      where: { organisationId, role: { slug: { in: slugs } } },
      select: { capabilities: true, recordScope: true, updatedAt: true, role: { select: { slug: true } } },
    }),
    db.membership.groupBy({
      by: ['roleId'],
      where: { organisationId, status: 'ACTIVE', role: { slug: { in: slugs } } },
      _count: true,
    }),
  ])
  const roleRows = await db.role.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } })
  const slugById = new Map(roleRows.map(r => [r.id, r.slug]))
  const countBySlug = new Map(counts.map(c => [slugById.get(c.roleId), c._count]))
  const policyBySlug = new Map(policies.map(p => [p.role.slug, p]))

  const roles = TEAM_ROLES.map(role => {
    const policy = role.locked ? undefined : policyBySlug.get(role.slug)
    return {
      slug: role.slug,
      name: role.name,
      description: role.description,
      locked: Boolean(role.locked),
      customised: Boolean(policy),
      updatedAt: policy?.updatedAt ?? null,
      recordScope: (policy?.recordScope as RecordScope | undefined) ?? role.defaultScope,
      capabilities: roleCapabilities(role.slug, policy ? { capabilities: policy.capabilities, recordScope: policy.recordScope as RecordScope } : null),
      defaultScope: role.defaultScope,
      defaultCapabilities: role.defaultCapabilities,
      memberCount: countBySlug.get(role.slug) ?? 0,
    }
  })

  return NextResponse.json(
    {
      success: true,
      data: {
        groups: CAPABILITY_GROUPS.map(g => ({
          id: g.id,
          label: g.label,
          capabilities: g.capabilities.map(({ key, label, description }) => ({ key, label, description })),
        })),
        roles,
        canEdit: hasPermission(ctx, PERMISSIONS.ROLES_MANAGE),
      },
      requestId: uuidv4(),
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
