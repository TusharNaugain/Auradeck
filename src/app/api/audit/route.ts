/**
 * /api/audit — search audit logs (admin only). Append-only by design.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

const auditListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().max(100).optional(),
  resourceType: z.string().max(50).optional(),
  actorUserId: z.string().optional(),
  resourceId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.AUDIT_VIEW })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  const { searchParams } = new URL(req.url)
  const query = auditListSchema.parse(Object.fromEntries(searchParams))

  const where = {
    organisationId,
    ...(query.action ? { action: { contains: query.action.toLowerCase(), mode: 'insensitive' as const } } : {}),
    ...(query.resourceType ? { resourceType: { contains: query.resourceType.toLowerCase(), mode: 'insensitive' as const } } : {}),
    ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    ...(query.resourceId ? { resourceId: query.resourceId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  }

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { actor: { select: { id: true, fullName: true } } },
    }),
    db.auditLog.count({ where }),
  ])

  // Reading audit logs is itself audit-logged (who-read-what trace)
  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'audit.viewed',
    resourceType: 'audit_log',
    ipHash,
  })

  return NextResponse.json(
    { success: true, data: { items, total, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(total / query.pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
