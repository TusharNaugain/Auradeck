/**
 * Indian formatting conventions (en-IN, INR, dd/MM/yyyy) shared by all screens.
 * Prisma Decimal columns serialise to strings, so every numeric helper accepts both.
 */

import { formatDistanceToNowStrict } from 'date-fns'

export type Numeric = string | number | null | undefined

export function toNumber(value: Numeric): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatCurrency(value: Numeric, opts: { compact?: boolean; decimals?: number } = {}): string {
  // A missing amount is not ₹0: lists show an em dash, like every other formatter here.
  if (value === null || value === undefined || value === '') return '—'
  const amount = toNumber(value)
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: opts.decimals ?? (opts.compact ? 2 : amount % 1 === 0 ? 0 : 2),
    minimumFractionDigits: opts.compact ? 0 : 0,
  }).format(amount)
}

export function formatNumber(value: Numeric, opts: { compact?: boolean } = {}): string {
  return new Intl.NumberFormat('en-IN', {
    notation: opts.compact ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(toNumber(value))
}

export function formatPercent(value: Numeric, decimals = 0): string {
  return `${toNumber(value).toFixed(decimals)}%`
}

export function formatDate(value: Numeric, timeZone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date)
}

export function formatDateTime(value: Numeric, timeZone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${formatDate(value, timeZone)}, ${new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(date)}`
}

export function formatRelative(value: Numeric): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const relative = formatDistanceToNowStrict(date, { addSuffix: true })
  return date.getTime() < Date.now() ? relative.replace('ago', 'ago') : relative
}

/** `AT_RISK` / `at_risk` -> `At risk` for human-readable labels. */
export function enumLabel(value: Numeric, fallback = '—'): string {
  if (!value) return fallback
  const normalised = String(value).toLowerCase().replace(/_/g, ' ').trim()
  return normalised.charAt(0).toUpperCase() + normalised.slice(1)
}

export function initials(fullName: Numeric): string {
  if (!fullName) return '—'
  return String(fullName)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function isOverdue(value: Numeric): boolean {
  if (!value) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}
