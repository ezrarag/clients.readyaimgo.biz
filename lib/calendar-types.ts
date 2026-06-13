export interface CalendarEvent {
  id: string
  summary: string
  description: string | null
  startAt: string
  endAt: string
  meetLink: string | null
  htmlLink: string
  attendees: { email: string; displayName: string | null }[]
}
