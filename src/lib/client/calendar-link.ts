type CalendarEventInput = {
  title: string
  startAt: Date
  durationMinutes?: number
  description?: string
  attendeeEmail?: string | null
}

function calendarDate(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    throw new Error('A valid meeting date and time are required.')
  }
  return value.toISOString().replace(/[-:]|\.\d{3}/g, '')
}

export function createGoogleCalendarLink({
  title,
  startAt,
  durationMinutes = 30,
  description,
  attendeeEmail,
}: CalendarEventInput): string {
  if (!title.trim()) {
    throw new Error('A meeting title is required.')
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    throw new Error('Meeting duration must be between 1 minute and 24 hours.')
  }

  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000)
  const url = new URL('https://calendar.google.com/calendar/render')
  url.searchParams.set('action', 'TEMPLATE')
  url.searchParams.set('text', title.trim())
  url.searchParams.set('dates', `${calendarDate(startAt)}/${calendarDate(endAt)}`)
  if (description?.trim()) url.searchParams.set('details', description.trim())
  if (attendeeEmail?.trim()) url.searchParams.set('add', attendeeEmail.trim())
  const link = url.toString()
  if (link.length > 2000) {
    throw new Error('The calendar invitation is too long to open reliably. Shorten the meeting notes and try again.')
  }
  return link
}
