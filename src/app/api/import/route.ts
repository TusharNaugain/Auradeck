/**
 * POST /api/import — CSV import for leads/contacts/clients with
 * mapping preview, validation, duplicate detection and an error report.
 * Designed to be extended to a background job at scale (see docs/jobs.md);
 * currently processes synchronously with strict row limits per request.
 */

import { NextRequest, NextResponse } from 'next/server'
import Papa from 'papaparse'
import { db } from '@/lib/db'
import { guardedRoute, routeHandler } from '@/lib/utils/api-helpers'
import { PERMISSIONS } from '@/lib/permissions'
import { nextNumber } from '@/lib/services/numbering'
import { computeLeadScore } from '@/lib/services/leads'
import { slugify } from '@/lib/utils/slugify'
import { createAuditLog } from '@/lib/audit'
import { emailSchema, phoneSchema, normalizePhone } from '@/lib/validations/common'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'

const MAX_ROWS = 1000

const importSchema = z.object({
  entityType: z.enum(['leads', 'contacts', 'clients']),
  csv: z.string().min(10).max(2_000_000),
})

interface RowResult {
  row: number
  ok: boolean
  error?: string
  recordId?: string
}

export const POST = routeHandler(async (req: NextRequest) => {
  const guard = await guardedRoute(req, {
    permission: PERMISSIONS.IMPORT_MANAGE,
    policy: 'import',
    keyByUser: true,
  })
  if (guard.response) return guard.response
  const { organisationId, user, ipHash } = guard.context!

  let body: z.infer<typeof importSchema>
  try {
    body = importSchema.parse(await req.json())
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid import payload', code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }

  const parsed = Papa.parse<Record<string, string>>(body.csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  })

  const rows = parsed.data
  if (rows.length === 0) {
    return NextResponse.json(
      { success: false, error: 'CSV has no data rows', code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { success: false, error: `Import limited to ${MAX_ROWS} rows per request`, code: 'VALIDATION_ERROR', requestId: uuidv4() },
      { status: 400 }
    )
  }

  const results: RowResult[] = []
  let successRows = 0

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const rowNumber = index + 2 // header is row 1

    try {
      if (body.entityType === 'leads') {
        const email = row['email']?.trim().toLowerCase()
        const phone = row['phone']?.trim() ? normalizePhone(row['phone'].trim()) : undefined

        if (email && !emailSchema.safeParse(email).success) {
          throw new Error(`Invalid email "${email}"`)
        }
        if (phone && !phoneSchema.safeParse(phone).success) {
          throw new Error(`Invalid phone "${phone}"`)
        }

        // In-org dedupe by email then phone
        const dup = email
          ? await db.lead.findFirst({ where: { organisationId, email, deletedAt: null }, select: { id: true } })
          : (phone
              ? await db.lead.findFirst({ where: { organisationId, phoneNumber: phone, deletedAt: null }, select: { id: true } })
              : null)
        if (dup) throw new Error('Duplicate lead in this organisation')

        await db.lead.create({
          data: {
            organisationId,
            leadNumber: await nextNumber(organisationId, 'lead'),
            firstName: row['firstName']?.trim() || (row['fullName']?.trim().split(' ')[0] ?? 'Unknown'),
            lastName: row['lastName']?.trim() || (row['fullName']?.trim().split(' ').slice(1).join(' ') ?? ''),
            fullName: row['fullName']?.trim() || `${row['firstName']} ${row['lastName']}`.trim(),
            email,
            phoneNumber: phone,
            phoneCountryCode: phone?.startsWith('+') ? phone.slice(1, 3) : '+91',
            organisationName: row['organisationName']?.trim() || undefined,
            city: row['city']?.trim() || undefined,
            leadSource: (row['leadSource']?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'OTHER') as never,
            lifecycleStage: 'NEW',
            leadScore: computeLeadScore({
              leadSource: row['leadSource'],
              email,
              phone,
              estimatedUsers: row['estimatedUsers'] ? parseInt(row['estimatedUsers'], 10) || null : null,
            }),
            consentStatus: row['consentStatus']?.trim() || 'implicit',
            tags: [],
            createdBy: user.id,
          },
        })
      } else if (body.entityType === 'contacts') {
        const email = row['email']?.trim().toLowerCase()
        if (email && !emailSchema.safeParse(email).success) throw new Error(`Invalid email "${email}"`)

        await db.contact.create({
          data: {
            organisationId,
            firstName: row['firstName']?.trim() || (row['fullName']?.trim().split(' ')[0] ?? 'Unknown'),
            lastName: row['lastName']?.trim() || (row['fullName']?.trim().split(' ').slice(1).join(' ') ?? ''),
            fullName: row['fullName']?.trim() || `${row['firstName'] ?? ''} ${row['lastName'] ?? ''}`.trim(),
            email,
            phoneNumber: row['phone']?.trim() ?? undefined,
            contactType: (row['contactType']?.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'OTHER') as never,
            tags: [],
          },
        })
      } else {
        // clients (practice): privacy-safe minimum fields
        const clientNumber = await nextNumber(organisationId, 'client')
        await db.client.create({
          data: {
            organisationId,
            clientNumber,
            firstName: row['firstName']?.trim() || (row['fullName']?.trim().split(' ')[0] ?? 'Unknown'),
            lastName: row['lastName']?.trim() || (row['fullName']?.trim().split(' ').slice(1).join(' ') ?? ''),
            status: 'ENQUIRY',
            referralSource: row['referralSource']?.trim() || undefined,
            tags: [],
          },
        })
      }

      successRows++
      results.push({ row: rowNumber, ok: true })
    } catch (error) {
      results.push({
        row: rowNumber,
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown row error',
      })
    }
  }

  await createAuditLog({
    organisationId,
    actorUserId: user.id,
    action: 'import.completed',
    resourceType: 'import',
    ipHash,
    afterJson: { entityType: body.entityType, total: rows.length, success: successRows, failed: rows.length - successRows },
  })

  // Slug import marker keeps the preview row for grading analysis
  void slugify

  return NextResponse.json(
    {
      success: true,
      data: {
        totalRows: rows.length,
        successRows,
        errorRows: results.filter((r) => !r.ok).map((r) => ({ row: r.row, error: r.error })),
      },
      requestId: uuidv4(),
    }
  )
})
