import { describe, expect, it } from 'vitest'
import {
  emailSchema,
  normalizeEmail,
  normalizePhone,
  paginationSchema,
  phoneSchema,
  sanitizeTextFormat,
  urlSchema,
} from '@/lib/validations/common'
import { computeWeightedAmount, leadCreateSchema, leadListSchema, leadUpdateSchema } from '@/lib/validations/crm'
import { appointmentCreateSchema } from '@/lib/validations/practice'
import { computeSlaDueDates, computeSlaStatus, SLA_HOURS } from '@/lib/validations/support'
import { articleSlugSchema, knowledgeCreateSchema } from '@/lib/validations/knowledge'

describe('common validators', () => {
  it('accepts supported lead-stage updates while conversion remains a separate operation', () => {
    expect(leadUpdateSchema.safeParse({ lifecycleStage: 'demo_booked' }).success).toBe(true)
    expect(leadUpdateSchema.safeParse({ lifecycleStage: 'not_a_stage' }).success).toBe(false)
  })

  it('lower-cases and trims emails', () => {
    expect(emailSchema.parse('  Raj@Clinic.CO.IN ')).toBe('raj@clinic.co.in')
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
  })

  it('accepts Indian numbers with or without a country code, rejects short ones', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true)
    expect(phoneSchema.safeParse('9876543210').success).toBe(true)
    expect(phoneSchema.safeParse('12345').success).toBe(false)
    expect(phoneSchema.safeParse('09876543210').success).toBe(false)
  })

  it('normalises phone separators and 00 international prefixes', () => {
    expect(normalizePhone('+91 98765-43210')).toBe('+919876543210')
    expect(normalizePhone('00919876543210')).toBe('+919876543210')
    expect(normalizeEmail('  A@B.com ')).toBe('a@b.com')
  })

  it('applies pagination defaults and the page-size ceiling', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 })
    expect(paginationSchema.safeParse({ pageSize: 500 }).success).toBe(false)
    expect(paginationSchema.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 })
  })

  it('strips control characters without touching newlines and tabs', () => {
    expect(sanitizeTextFormat('a\x00b\x1fc')).toBe('abc')
    expect(sanitizeTextFormat('line\n\ttab')).toBe('line\n\ttab')
  })

  it('rejects loopback and private-range URLs (SSRF guard)', () => {
    expect(urlSchema.safeParse('https://clinic.example.com/logo.png').success).toBe(true)
    expect(urlSchema.safeParse('http://localhost:3000').success).toBe(false)
    expect(urlSchema.safeParse('https://192.168.1.10').success).toBe(false)
    expect(urlSchema.safeParse('file:///etc/passwd').success).toBe(false)
    expect(urlSchema.safeParse('https://meta.internal').success).toBe(false)
  })
})

describe('lead schema', () => {
  it('requires at least one contact channel', () => {
    const result = leadCreateSchema.safeParse({ firstName: 'Asha', lastName: 'Rao' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['email'])
    }
  })

  it('defaults the source and tags a bare valid lead', () => {
    const parsed = leadCreateSchema.parse({ firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' })
    expect(parsed.leadSource).toBe('other')
    expect(parsed.tags).toEqual([])
  })

  it('coerces list query params and rejects unknown stages', () => {
    const query = leadListSchema.parse({ page: '2', sort: 'asc' })
    expect(query.page).toBe(2)
    expect(query.sortBy).toBe('createdAt')
    expect(leadListSchema.safeParse({ stage: 'not_a_stage' }).success).toBe(false)
  })
})

describe('weighted pipeline amount', () => {
  it('rounds to paise', () => {
    expect(computeWeightedAmount(100000, 30)).toBe(30000)
    expect(computeWeightedAmount(12345, 33)).toBe(4073.85)
    expect(computeWeightedAmount(0, 100)).toBe(0)
  })
})

describe('appointments', () => {
  const base = {
    clientId: 'cli_1',
    appointmentType: 'Initial assessment',
    startAt: '2026-11-05T09:00:00.000Z',
    timezone: 'Asia/Kolkata',
  }

  it('requires the end to be after the start', () => {
    const result = appointmentCreateSchema.safeParse({ ...base, endAt: '2026-11-05T09:00:00.000Z' })
    expect(result.success).toBe(false)
  })

  it('rejects sessions longer than 12 hours', () => {
    const result = appointmentCreateSchema.safeParse({ ...base, endAt: '2026-11-06T09:00:00.000Z' })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['endAt'])
  })

  it('accepts a normal one-hour slot', () => {
    expect(appointmentCreateSchema.safeParse({ ...base, endAt: '2026-11-05T10:00:00.000Z' }).success).toBe(true)
  })
})

describe('support SLA', () => {
  it('derives both due dates from the priority window', () => {
    const from = new Date('2026-11-05T00:00:00.000Z')
    const due = computeSlaDueDates('urgent', from)
    expect(due.firstResponseDueAt.toISOString()).toBe('2026-11-05T01:00:00.000Z')
    expect(due.resolutionDueAt.toISOString()).toBe('2026-11-05T08:00:00.000Z')
    expect(SLA_HOURS.normal.firstResponse).toBe(8)
  })

  it('falls back to the normal window for an unknown priority', () => {
    const from = new Date('2026-11-05T00:00:00.000Z')
    expect(computeSlaDueDates('mystery', from).firstResponseDueAt.getTime() - from.getTime()).toBe(
      SLA_HOURS.normal.firstResponse * 3600 * 1000
    )
  })

  it('is breached only while the ticket is still open', () => {
    const past = new Date('2026-11-01T00:00:00.000Z')
    const open = { firstResponseDueAt: past, resolutionDueAt: past }
    expect(computeSlaStatus(open, past)).toBe('at_risk')
    expect(computeSlaStatus(open, new Date('2026-11-02T00:00:00.000Z'))).toBe('breached')
    expect(
      computeSlaStatus({ ...open, resolvedAt: new Date('2026-11-01T12:00:00.000Z') }, new Date('2026-11-02T00:00:00.000Z'))
    ).toBe('on_time')
    expect(computeSlaStatus({}, new Date())).toBe('on_time')
  })
})

describe('knowledge base', () => {
  it('accepts kebab-case slugs and rejects anything else', () => {
    expect(articleSlugSchema.safeParse('breathing-exercises-101').success).toBe(true)
    expect(articleSlugSchema.safeParse('Breathing Exercises').success).toBe(false)
    expect(articleSlugSchema.safeParse('-leading').success).toBe(false)
  })

  it('defaults articles to internal and derives nothing else', () => {
    const parsed = knowledgeCreateSchema.parse({ title: 'Intake form', content: 'Body copy' })
    expect(parsed.isPublic).toBe(false)
    expect(parsed.tags).toEqual([])
    expect(parsed.slug).toBeUndefined()
  })
})
