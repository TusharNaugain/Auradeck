/**
 * Shared Validation Helpers for Indian CRM conventions
 * Date format: DD/MM/YYYY | Currency: INR | Phone: +91 conventions
 */

import { z } from 'zod'

/** Validate string against known enum list */
export const stringEnum = <T extends readonly string[]>(values: T) =>
  z.string().refine(val => (values as readonly string[]).includes(val))

/** Indian mobile/international phone: digits, 8-15 chars, optionally with +country prefix */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, 'Phone must be a valid number (8-15 digits, optional +country code)')

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254)

/** Normalize phone: strip spaces, hyphens, leading zeros */
export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[\s()\-.]/g, '')
  // Convert 00XX international prefix to +XX
  if (cleaned.startsWith('00') && cleaned.length > 10) {
    return `+${cleaned.slice(2)}`
  }
  return cleaned
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase()
}

/** Localized date representation (Indian format) */
export function formatDateIST(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

export function formatDateTimeIST(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

/** INR currency */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '—'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num)
}

/**
 * Cursor-aware pagination params. Uses page-based pagination for lists
 * (bounded max page size) matching the API spec.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type PaginationParams = z.infer<typeof paginationSchema>

/** Sort order helper */
export const sortOrder = z.enum(['asc', 'desc']).optional().default('desc')

/** Date range filter */
export const dateRangeSchema = z
  .object({
    from: z.string().datetime().or(z.string().date()).optional(),
    to: z.string().datetime().or(z.string().date()).optional(),
  })
  .optional()

export const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(50).optional().default([])
export const customFieldsSchema = z.record(z.any()).optional()

/**
 * Safe string helpers: trim + length cap. Pure ZodString chains keep TS
 * inference cheap on the 30+-field entity schemas.
 * (Control-character stripping happens in sanitizeTextFormat at runtime.)
 */
export const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g
export function sanitizeTextFormat(input: string): string {
  return input.replace(CONTROL_CHARS, '')
}

export const safeText = (max = 255) => z.string().trim().max(max)

export const safeTextOptional = (max = 255) =>
  safeText(max).nullable().optional()

export const longText = (max = 10_000) => safeText(max)
export const longTextOptional = (max = 10_000) => longText(max).nullable().optional()

/** URL field with SSRF-safe host validation (https only in production assets; internal URLs) */
export const urlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (val) => {
      if (val === '') return true
      try {
        const parsed = new URL(val)
        // Block obvious SSRF schemes/hosts
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
        if (/^(localhost|127\.|0\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.)/.test(parsed.hostname)) {
          return false
        }
        if (parsed.hostname.endsWith('.internal') || parsed.hostname.endsWith('.local')) return false
        return true
      } catch {
        return false
      }
    },
    'URL must be a valid public http(s) URL'
  )
  .optional()

export const isoIdSchema = z.string().min(1).max(64)
export const isoIdOptional = z.string().min(1).max(64).optional().nullable()
