/**
 * GET /api/export?entity=leads — CSV export of permitted entity data.
 * Blocked for callers without export.manage, audit-logged, and capped per request.
 * Clients/patients are deliberately NOT exportable — too privacy-sensitive at the
 * list level; a dedicated workflow is defined in the security documentation.
 */

import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { createAuditLog } from '@/lib/audit'
import { v4 as uuidv4 } from 'uuid'

const MAX_EXPORT_ROWS = 5000

export const GET = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.EXPORT_MANAGE,
    policy: 'export',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, ctx, user, ipHash } = guard.context!

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity')
  if (!entity) {
    return NextResponse.json(
      { success: false, error: 'entity parameter required', code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }

  // Entity-level read permission from the role catalogue
  const entityPermissions: Record<string, { isAllowed: () => boolean; selector: object }> = {
    leads: { isAllowed: () => ctx.permissions.has(PERMISSIONS.LEADS_VIEW), selector: {} },
    contacts: { isAllowed: () => ctx.permissions.has(PERMISSIONS.CONTACTS_VIEW), selector: {} },
    accounts: { isAllowed: () => ctx.permissions.has(PERMISSIONS.ACCOUNTS_VIEW), selector: {} },
    opportunities: { isAllowed: () => ctx.permissions.has(PERMISSIONS.OPPORTUNITIES_VIEW), selector: {} },
  }

  const target = entityPermissions[entity]
  if (!target) {
    // Clients deliberately excluded: privacy-sensitive; see docs/security.md
    return NextResponse.json(
      { success: false, error: 'Unknown or non-exportable entity', code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }

  if (!target.isAllowed() && !ctx.permissions.has(PERMISSIONS.SUPER_ADMIN)) {
    return NextResponse.json(
      { success: false, error: `You don't have permission to export ${entity}`, code: 'PERMISSION_DENIED', requestId: uuidv4() },
      { status: 403 }
    )
  }

  const rows = await fetchExportRows(entity, organisationId)
  const csv = Papa.unparse(rows, { header: true })

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'export.completed',
    resourceType: 'export',
    ipHash,
    afterJson: { entity, rowCount: rows.length },
  })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entity}-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
})

async function fetchExportRows(entity: string, organisationId: string): Promise<Record<string, unknown>[]> {
  switch (entity) {
    case 'leads':
      return db.lead.findMany({
        where: { organisationId, deletedAt: null },
        select: {
          leadNumber: true, fullName: true, email: true, city: true, leadSource: true,
          lifecycleStage: true, leadScore: true, createdAt: true,
        },
        take: MAX_EXPORT_ROWS,
      }) as unknown as Promise<Record<string, unknown>[]>
    case 'contacts':
      return db.contact.findMany({
        where: { organisationId, deletedAt: null },
        select: {
          fullName: true, jobTitle: true, contactType: true, isPrimary: true, createdAt: true,
        },
        take: MAX_EXPORT_ROWS,
      }) as unknown as Promise<Record<string, unknown>[]>
    case 'accounts':
      return db.account.findMany({
        where: { organisationId },
        select: {
          customerAccountCode: true, accountName: true, accountType: true, segment: true,
          healthStatus: true, healthScore: true, mrr: true, renewalDate: true,
        },
        take: MAX_EXPORT_ROWS,
      }) as unknown as Promise<Record<string, unknown>[]>
    case 'opportunities':
      return db.opportunity.findMany({
        where: { organisationId, deletedAt: null },
        select: {
          opportunityNumber: true, name: true, type: true, stage: true, amount: true,
          probability: true, expectedCloseDate: true, forecastCategory: true, createdAt: true,
        },
        take: MAX_EXPORT_ROWS,
      }) as unknown as Promise<Record<string, unknown>[]>
    default:
      return []
  }
}
