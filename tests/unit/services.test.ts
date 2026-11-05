import { describe, expect, it } from 'vitest'
import { maskPhone, maskTaxNumber } from '@/lib/services/effects'
import { computeLeadScore } from '@/lib/services/leads'
import { statusForScore } from '@/lib/services/health'
import { normalisePayload, type FieldSpec } from '@/components/shared/schema-form'
import { enumLabel, formatCurrency, formatNumber, initials, isOverdue, toNumber } from '@/lib/client/format'

describe('response masking', () => {
  it('keeps only the tail of a GSTIN-like tax number', () => {
    expect(maskTaxNumber('07AAPGU1234A')).toBe('XXXXXXX234A')
    expect(maskTaxNumber(null)).toBeNull()
    expect(maskTaxNumber('')).toBeNull()
  })

  it('masks the middle of a phone number', () => {
    expect(maskPhone('9876543210')).toBe('987XXXX210')
    expect(maskPhone(undefined)).toBeNull()
  })
})

describe('lead scoring', () => {
  it('scores zero when nothing is known', () => {
    expect(computeLeadScore({})).toBe(0)
  })

  it('adds contact, size and source signals', () => {
    // email only (10) + 3 users (10) + referral source (15)
    expect(computeLeadScore({ email: 'a@b.com', estimatedUsers: 3, leadSource: 'referral' })).toBe(35)
  })

  it('scores fully qualified leads and caps at 100', () => {
    const lead = {
      email: 'a@b.com',
      phone: '+919876543210',
      estimatedUsers: 25,
      budgetRange: '50k-1L',
      leadSource: 'website',
      qualificationStatus: 'qualified',
      currentSoftware: 'Sheets',
      useCase: 'Group therapy sessions for a multi-city clinic chain',
    }
    expect(computeLeadScore(lead)).toBe(95)
    expect(computeLeadScore({ ...lead, leadSource: 'referral' })).toBe(100)
  })

  it('prefers referral over website and both over an unknown source', () => {
    expect(computeLeadScore({ leadSource: 'partner' })).toBe(15)
    expect(computeLeadScore({ leadSource: 'campaign' })).toBe(10)
    expect(computeLeadScore({ leadSource: 'other' })).toBe(0)
  })
})

describe('health thresholds', () => {
  it('maps scores to statuses at the documented boundaries', () => {
    expect(statusForScore(100)).toBe('healthy')
    expect(statusForScore(80)).toBe('healthy')
    expect(statusForScore(79)).toBe('watch')
    expect(statusForScore(60)).toBe('watch')
    expect(statusForScore(59)).toBe('at_risk')
    expect(statusForScore(35)).toBe('at_risk')
    expect(statusForScore(34)).toBe('critical')
  })
})

const specs: FieldSpec[] = [
  { name: 'name', label: 'Name', kind: 'text' },
  { name: 'startAt', label: 'Start', kind: 'datetime' },
  { name: 'day', label: 'Day', kind: 'date' },
  { name: 'tags', label: 'Tags', kind: 'tags' },
  { name: 'conditions', label: 'Conditions', kind: 'json' },
  { name: 'amount', label: 'Amount', kind: 'number' },
]

describe('form payload normalisation', () => {
  it('drops blanks so optional server fields stay untouched', () => {
    expect(normalisePayload({ name: '   ', tags: ' , ' }, specs)).toEqual({})
  })

  it('reads date-only input as local start of day and datetimes as local wall clock', () => {
    const out = normalisePayload({ startAt: '2026-11-05T09:00', day: '2026-11-05' }, specs)
    expect(out.startAt).toBe(new Date('2026-11-05T09:00').toISOString())
    expect(out.day).toBe(new Date('2026-11-05T00:00:00').toISOString())
  })

  it('splits comma-separated tags into a trimmed list', () => {
    expect(normalisePayload({ tags: ' physio,  back pain ,' }, specs)).toEqual({ tags: ['physio', 'back pain'] })
  })

  it('parses JSON fields and leaves invalid JSON as text so zod reports it', () => {
    expect(normalisePayload({ conditions: '[{"field":"stage","operator":"equals"}]' }, specs)).toEqual({
      conditions: [{ field: 'stage', operator: 'equals' }],
    })
    expect(normalisePayload({ conditions: '{oops' }, specs)).toEqual({ conditions: '{oops' })
  })

  it('passes through numbers and skips fields absent from the spec', () => {
    const out = normalisePayload({ amount: 25, notASpecField: 'x' }, specs)
    expect(out).toEqual({ amount: 25 })
  })
})

describe('Indian formatting helpers', () => {
  it('coerces Prisma Decimal strings and junk alike', () => {
    expect(toNumber('1234.5')).toBe(1234.5)
    expect(toNumber(null)).toBe(0)
    expect(toNumber('abc')).toBe(0)
  })

  it('uses lakh grouping for rupees', () => {
    expect(formatCurrency(100000)).toContain('1,00,000')
    expect(formatCurrency('75000.50')).toContain('75,000')
    expect(formatCurrency(null)).toBe('—')
  })

  it('formats counts and labels', () => {
    expect(formatNumber(1234567)).toBe('12,34,567')
    expect(enumLabel('PENDING_INTERNAL')).toBe('Pending internal')
    expect(enumLabel(null)).toBe('—')
    expect(enumLabel('x', 'Unknown')).toBe('X')
    expect(initials('Rajesh Kumar Sharma')).toBe('RK')
  })

  it('flags overdue dates only in the past', () => {
    expect(isOverdue('2020-01-01T00:00:00.000Z')).toBe(true)
    expect(isOverdue('2999-01-01T00:00:00.000Z')).toBe(false)
    expect(isOverdue(null)).toBe(false)
    expect(isOverdue('nonsense')).toBe(false)
  })
})
