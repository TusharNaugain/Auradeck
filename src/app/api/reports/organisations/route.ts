import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { paginationSchema } from '@/lib/validations/common'
import { PERMISSIONS } from '@/lib/permissions'
import { v4 as uuidv4 } from 'uuid'

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, { permission: PERMISSIONS.BILLING_VIEW, policy: 'apiRead' })
  if (guard.response) return guard.response
  const { organisationId } = guard.context!

  const currentOrganisation = await db.organisation.findUnique({
    where: { id: organisationId },
    select: { type: true },
  })
  if (currentOrganisation?.type !== 'AURADESK_INTERNAL') {
    return NextResponse.json(
      { success: false, error: 'This report is only available to AuraDeck internal workspaces', code: 'PERMISSION_DENIED', requestId: uuidv4() },
      { status: 403 }
    )
  }

  const { searchParams } = new URL(req.url)
  const { page, pageSize } = paginationSchema.parse(Object.fromEntries(searchParams))
  const where = { type: 'CUSTOMER_PRACTICE' as const, status: 'ACTIVE' as const }

  const [items, total] = await Promise.all([
    db.organisation.findMany({
      where,
      orderBy: { displayName: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        displayName: true,
        status: true,
        city: true,
        state: true,
        createdAt: true,
      },
    }),
    db.organisation.count({ where }),
  ])

  return NextResponse.json(
    { success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }, requestId: uuidv4() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
