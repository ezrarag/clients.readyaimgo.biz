import { google } from "googleapis"

import type { CalendarEvent } from "./calendar-types"

export function getCalendarClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.replace(/\\n/g, "\n")
  if (!email || !key) return null

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  })

  return google.calendar({ version: "v3", auth })
}

export async function getUpcomingEvents(calendarId: string): Promise<CalendarEvent[]> {
  const client = getCalendarClient()
  if (!client) return []

  const now = new Date()
  const until = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

  const res = await client.events.list({
    calendarId,
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: "startTime",
  })

  return (res.data.items ?? []).map((ev): CalendarEvent => {
    const meetLink =
      ev.hangoutLink ??
      ev.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === "video")
        ?.uri ??
      null

    return {
      id: ev.id ?? crypto.randomUUID(),
      summary: ev.summary ?? "Meeting",
      description: ev.description ?? null,
      startAt: ev.start?.dateTime ?? ev.start?.date ?? now.toISOString(),
      endAt: ev.end?.dateTime ?? ev.end?.date ?? now.toISOString(),
      meetLink,
      htmlLink: ev.htmlLink ?? "",
      attendees: (ev.attendees ?? []).map((attendee) => ({
        email: attendee.email ?? "",
        displayName: attendee.displayName ?? null,
      })),
    }
  })
}
