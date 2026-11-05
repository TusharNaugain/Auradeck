import { describe, expect, it } from 'vitest'
import { createGoogleCalendarLink } from '@/lib/client/calendar-link'

describe('createGoogleCalendarLink', () => {
  it('creates a prefilled event link with a 30-minute duration and attendee', () => {
    const link = new URL(createGoogleCalendarLink({
      title: 'Discovery call',
      startAt: new Date('2026-06-18T10:00:00.000Z'),
      description: 'Review onboarding needs',
      attendeeEmail: 'person@example.test',
    }))

    expect(link.origin).toBe('https://calendar.google.com')
    expect(link.searchParams.get('action')).toBe('TEMPLATE')
    expect(link.searchParams.get('text')).toBe('Discovery call')
    expect(link.searchParams.get('dates')).toBe('20260618T100000Z/20260618T103000Z')
    expect(link.searchParams.get('details')).toBe('Review onboarding needs')
    expect(link.searchParams.get('add')).toBe('person@example.test')
  })

  it('rejects invalid dates, empty titles, and invalid durations', () => {
    expect(() => createGoogleCalendarLink({ title: 'Call', startAt: new Date(Number.NaN) })).toThrow('valid meeting date')
    expect(() => createGoogleCalendarLink({ title: ' ', startAt: new Date() })).toThrow('title')
    expect(() => createGoogleCalendarLink({ title: 'Call', startAt: new Date(), durationMinutes: 0 })).toThrow('duration')
  })

  it('rejects a calendar draft URL that is too long to open reliably', () => {
    expect(() => createGoogleCalendarLink({
      title: 'Call',
      startAt: new Date('2026-06-18T10:00:00.000Z'),
      description: 'Meeting notes '.repeat(200),
    })).toThrow('too long to open reliably')
  })
})
