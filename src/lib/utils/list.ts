/**
 * Shared list query helpers for tenant-scoped paginated collections.
 * Enforces pagination caps and provides a normalized response envelope.
 */

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

export interface ListParams {
  page: number
  pageSize: number
  skip: number
  where: Prisma.LeadWhereInput | Prisma.ContactWhereInput | Prisma.OpportunityWhereInput | Prisma.AccountWhereInput | Prisma.SupportTicketWhereInput | Prisma.ClientWhereInput | Prisma.AppointmentWhereInput | Prisma.TaskWhereInput | Prisma.ActivityWhereInput | Prisma.OnboardingProjectWhereInput | Record<string, unknown>
  orderBy: Record<string, 'asc' | 'desc'>
}

export interface ListEnvelope {
  items: unknown[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function paginatedResponse(envelope: ListEnvelope, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data: envelope, requestId: uuidv4() },
    {
      status,
      headers: { 'Cache-Control': 'private, no-store' },
    }
  )
}

/** Convert search text into OR'd contains clauses (tenant-safe, on non-protected fields) */
export function searchTerm(search: string | undefined, fields: string[]): Record<string, unknown>[] | undefined {
  if (!search || search.trim().length === 0) return undefined
  const value = search.trim()
  return fields.map((field) => ({ [field]: { contains: value, mode: 'insensitive' as const } }))
}

/** Parse date param (ISO) tolerantly */
export function parseDateParam(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return isNaN(d.getTime()) ? undefined : d
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Multi-word search: every word must match at least one of the fields (so "heena gmail" or "heena yadav" both work).
 * Returns clauses to AND together.
 */
export function searchWords(search: string | undefined, fields: string[]): Record<string, unknown>[] {
  return (search ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => ({ OR: fields.map((field) => ({ [field]: { contains: word, mode: 'insensitive' as const } })) }))
}
