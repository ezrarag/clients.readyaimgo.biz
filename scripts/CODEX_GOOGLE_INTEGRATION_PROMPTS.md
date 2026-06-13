================================================================================
GOOGLE CALENDAR + VIDEO UPDATES INTEGRATION
clients.readyaimgo.biz (ezrarag)
3-prompt sequence — run in order, verify build passes between each
================================================================================

CONTEXT FOR ALL PROMPTS
─────────────────────────────────────────────────────────────────────────────
- Framework: Next.js 14 App Router, TypeScript strict
- Auth: Firebase Auth + Admin SDK (lib/firebase-admin.ts)
- DB: Firestore via getAdminDb() server-side, getDb() client-side
- Workspace type: lib/workspaces.ts — WorkspaceMeetingProvider already has
  calendarId and accountEmail fields per provider
- Slack notify: app/api/slack/notify/route.ts — POST {event, email, ...}
- Existing Firestore rules gate everything on isWorkspaceMember(workspaceId)
  or isAdmin()
- DO NOT touch firestore.rules in these prompts — rules are updated separately
- Run `npx tsc --noEmit` and `npm run build` after each prompt
- Commit message format: "feat(GI-N): <description>"
================================================================================


================================================================================
PROMPT GI-1 — Firestore Schema + Admin UI: Video Updates & Calendar Config
Priority: HIGH — foundation for GI-2 and GI-3
================================================================================

## Goal
Add two Firestore-backed features:
1. A `videoUpdates` subcollection on each workspace that Ezra (beam-admin)
   can post to from the admin panel, and clients see with unread badges.
2. A `calendarId` field surfaced in the workspace admin settings so Ezra can
   store the Google Calendar ID per client without needing to edit Firestore
   directly.

## 1. New Firestore collections / subcollections

### workspaces/{workspaceId}/updates/{updateId}
This already has a `statusVideos` concept on clients/{clientId} — mirror the
pattern here on workspaces so it is workspace-first.

Fields:
```
{
  id: string,
  type: "video" | "note" | "loom",
  title: string,
  description: string | null,
  url: string,                    // YouTube, Loom, or Drive link
  thumbnailUrl: string | null,
  postedByUid: string,
  postedAt: Timestamp,
  seenBy: string[],               // array of UIDs who have opened it
  workspaceId: string,
  pinned: boolean,                // pinned updates show first
}
```

### workspaces/{workspaceId} (top-level doc update only)
Add one new optional field to the workspace doc:
```
googleCalendarId: string | null   // e.g. "abc123@group.calendar.google.com"
```
This is set by beam-admin via the admin panel (see step 3 below).
Add `googleCalendarId` to the `Workspace` interface in lib/workspaces.ts
and to `normalizeWorkspace()` with a fallback of null.

## 2. New lib/workspace-updates.ts

Create this file. Export:

```ts
export interface WorkspaceUpdate {
  id: string
  type: "video" | "note" | "loom"
  title: string
  description: string | null
  url: string
  thumbnailUrl: string | null
  postedByUid: string
  postedAt: string           // ISO string (normalized from Timestamp)
  seenBy: string[]
  workspaceId: string
  pinned: boolean
}

export function normalizeWorkspaceUpdate(
  id: string,
  data: Record<string, unknown>
): WorkspaceUpdate { ... }

// Returns YouTube embed URL from a regular YouTube watch URL.
// Returns null if url is not a recognized YouTube URL.
export function toYouTubeEmbed(url: string): string | null { ... }

// Returns true if the given uid has NOT seen this update.
export function isUnread(update: WorkspaceUpdate, uid: string): boolean {
  return !update.seenBy.includes(uid)
}
```

## 3. New API routes

### POST /api/workspaces/[workspaceId]/updates
- Requires beam-admin role (verify via getAdminDb users/{uid} roles array)
- Body: { type, title, description?, url, thumbnailUrl?, pinned? }
- Validates url is non-empty
- Writes to workspaces/{workspaceId}/updates/{auto-id}
- Sets postedByUid, postedAt: FieldValue.serverTimestamp(), seenBy: []
- Returns { success: true, id }

### PATCH /api/workspaces/[workspaceId]/updates/[updateId]/seen
- Requires any workspace member (verify via members subcollection)
- Adds the caller's uid to the seenBy array using FieldValue.arrayUnion
- Returns { success: true }

### DELETE /api/workspaces/[workspaceId]/updates/[updateId]
- Requires beam-admin
- Deletes the doc
- Returns { success: true }

### PATCH /api/workspaces/[workspaceId]/calendar-id
- Requires beam-admin
- Body: { googleCalendarId: string | null }
- Updates workspaces/{workspaceId} with { googleCalendarId }
- Returns { success: true }

## 4. Admin panel additions (app/admin/page.tsx or a new admin sub-page)

In the existing admin workspace list, add per-workspace:
- A text input labeled "Google Calendar ID" bound to workspace.googleCalendarId
  with a Save button that calls PATCH /api/workspaces/[id]/calendar-id
- A "Post Update" button that opens a dialog with fields:
  type (select: video/loom/note), title (text), url (text),
  description (textarea, optional), thumbnailUrl (text, optional),
  pinned (checkbox)
  On submit: POST /api/workspaces/[id]/updates
- Existing updates for that workspace listed in a small table with a Delete
  button per row

## 5. Firestore rules addition (append to firestore.rules manually after)

Add the following comment block at the bottom of the rules file — do NOT edit
the rules file in code, just leave this comment in a TODO.md entry:

```
# TODO: Add to firestore.rules after GI-1 is deployed:
#
# match /workspaces/{workspaceId}/updates/{updateId} {
#   allow read: if isWorkspaceMember(workspaceId) || isAdmin();
#   allow create: if isAdmin();
#   allow update: if isWorkspaceMember(workspaceId) || isAdmin();
#   allow delete: if isAdmin();
# }
```

## Acceptance criteria
- `npx tsc --noEmit` passes
- `npm run build` passes
- Admin can post a video update and see it in the admin list
- Admin can set/clear googleCalendarId per workspace


================================================================================
PROMPT GI-2 — Client Dashboard: Updates Tab (Video Feed + Unread Badges)
Priority: HIGH — depends on GI-1 completing
================================================================================

## Goal
Wire the "Updates" tab in the workspace page
(app/workspace/[workspaceId]/page.tsx) to the real Firestore
workspaces/{workspaceId}/updates subcollection built in GI-1.
Replace any placeholder/empty state with a live feed.

## Context
- The workspace page is large — search for the "Updates" tab trigger string
  in the TabsList and its corresponding TabsContent. If it does not exist yet,
  add it after the last existing tab.
- useAuth() gives the current user's uid
- The page already uses onSnapshot for other subcollections — follow that
  pattern exactly
- WorkspaceUpdate type and normalizeWorkspaceUpdate are in
  lib/workspace-updates.ts (created in GI-1)

## Changes required

### app/workspace/[workspaceId]/page.tsx

1. Add import for WorkspaceUpdate, normalizeWorkspaceUpdate, isUnread,
   toYouTubeEmbed from lib/workspace-updates.ts

2. Add state:
   ```ts
   const [workspaceUpdates, setWorkspaceUpdates] = useState<WorkspaceUpdate[]>([])
   const [updatesLoading, setUpdatesLoading] = useState(true)
   ```

3. Add a useEffect that subscribes to
   collection(db, "workspaces", workspaceId, "updates")
   ordered by pinned desc, postedAt desc, limit 20.
   On each snapshot: normalize docs, setWorkspaceUpdates, setUpdatesLoading(false).
   Cleanup: unsubscribe on unmount.

4. Compute unread count:
   ```ts
   const unreadCount = workspaceUpdates.filter(u => isUnread(u, user.uid)).length
   ```

5. In the TabsList, add or update the Updates tab trigger to show an unread
   badge when unreadCount > 0:
   ```tsx
   <TabsTrigger value="updates">
     Updates
     {unreadCount > 0 && (
       <span className="ml-1.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px]
                        font-bold text-white leading-none">
         {unreadCount}
       </span>
     )}
   </TabsTrigger>
   ```

6. In the TabsContent for "updates":
   - Show updatesLoading skeleton (2 cards, same pattern as other tabs)
   - Empty state: "No updates yet. Ezra will post project updates here."
   - For each update, render an UpdateCard (inline component in this file):

   ```tsx
   function UpdateCard({
     update,
     uid,
     workspaceId,
   }: {
     update: WorkspaceUpdate
     uid: string
     workspaceId: string
   }) {
     const embedUrl = toYouTubeEmbed(update.url)
     const unread = isUnread(update, uid)

     // Mark as seen when the card mounts if currently unread
     useEffect(() => {
       if (!unread) return
       fetch(`/api/workspaces/${workspaceId}/updates/${update.id}/seen`, {
         method: "PATCH",
         headers: { Authorization: `Bearer ${/* idToken from useAuth */}` },
       }).catch(console.error)
     }, []) // run once on mount

     return (
       <Card className={cn("border", unread && "border-blue-400 bg-blue-50/30")}>
         <CardHeader>
           <div className="flex items-start justify-between gap-2">
             <div>
               {unread && (
                 <Badge className="mb-1 bg-blue-500 text-white text-[10px]">New</Badge>
               )}
               {update.pinned && (
                 <Badge variant="outline" className="mb-1 ml-1 text-[10px]">📌 Pinned</Badge>
               )}
               <CardTitle className="text-base">{update.title}</CardTitle>
               {update.description && (
                 <CardDescription>{update.description}</CardDescription>
               )}
             </div>
             <span className="text-xs text-muted-foreground whitespace-nowrap">
               {new Date(update.postedAt).toLocaleDateString()}
             </span>
           </div>
         </CardHeader>
         <CardContent>
           {embedUrl ? (
             <div className="aspect-video w-full overflow-hidden rounded-xl">
               <iframe
                 src={embedUrl}
                 className="h-full w-full"
                 allow="accelerometer; autoplay; clipboard-write;
                        encrypted-media; gyroscope; picture-in-picture"
                 allowFullScreen
               />
             </div>
           ) : (
             <a
               href={update.url}
               target="_blank"
               rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 text-sm font-medium
                          text-blue-600 hover:underline"
             >
               <ExternalLink className="h-3.5 w-3.5" />
               Watch / View Update
             </a>
           )}
         </CardContent>
       </Card>
     )
   }
   ```

   Render pinned updates first (already sorted by the query), then the rest.

7. The PATCH /seen call needs the Firebase ID token. The page already has
   auth context — extract idToken with `await user.getIdToken()` inside the
   useEffect, or use a helper consistent with how other API calls in this file
   get the bearer token.

## Acceptance criteria
- `npx tsc --noEmit` passes
- `npm run build` passes
- Updates tab shows "No updates yet" when subcollection is empty
- After admin posts a video, the client sees it with a "New" badge
- Opening the card calls /seen and the badge disappears on next render
- Pinned updates always appear first


================================================================================
PROMPT GI-3 — Google Calendar Events in Client Dashboard + Slack Notifications
Priority: MEDIUM — depends on GI-1 completing (GI-2 can run in parallel)
================================================================================

## Goal
1. Add a server-side API route that reads upcoming Google Calendar events for
   a workspace using a Google service account (no OAuth flow required for the
   client — Ezra controls the calendar and shares it with the service account).
2. Render an "Upcoming Meetings" section inside the workspace dashboard
   (above or inside the Overview tab — not a new tab).
3. Extend the Slack notify route to support a "meeting_scheduled" event type,
   so when Ezra creates a calendar event it can fire a Slack alert.

## Prerequisites (document in env comments, do not hard-fail if missing)
Add to .env.local (and document in README.md env section):
```
GOOGLE_SERVICE_ACCOUNT_EMAIL=   # e.g. rag-calendar@beam-home.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY=     # full private key JSON string (escaped \n)
```
These are obtained from GCP → IAM → Service Accounts → beam-home project.
The service account needs "Calendar → See all event details" permission on
each shared calendar (Ezra shares each client calendar with the SA email).

If either env var is missing, the API route returns
{ events: [], configured: false } — the UI shows a soft "Calendar not
connected" placeholder instead of crashing.

## 1. New lib/google-calendar-server.ts

```ts
// Server-only — import only in API routes, never in client components

import { google } from "googleapis"

export interface CalendarEvent {
  id: string
  summary: string
  description: string | null
  startAt: string   // ISO datetime
  endAt: string     // ISO datetime
  meetLink: string | null   // hangoutLink or conferenceData entryPoints
  htmlLink: string
  attendees: { email: string; displayName: string | null }[]
}

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

// Fetches events from now to 30 days out, max 10 results
export async function getUpcomingEvents(
  calendarId: string
): Promise<CalendarEvent[]> {
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
      ev.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")
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
      attendees: (ev.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        displayName: a.displayName ?? null,
      })),
    }
  })
}
```

Install googleapis:
```bash
npm install googleapis
```

## 2. New API route: GET /api/workspaces/[workspaceId]/calendar-events

- Verify Firebase ID token (Bearer header) — same pattern as other routes
- Verify caller is a workspace member OR beam-admin
- Fetch workspace doc from Firestore, read googleCalendarId
- If googleCalendarId is null/empty, return { events: [], configured: false }
- Call getUpcomingEvents(googleCalendarId)
- Return { events: CalendarEvent[], configured: true }
- On any googleapis error: log, return { events: [], configured: true,
  error: "calendar_fetch_failed" }

## 3. Client-side: Upcoming Meetings section in workspace page

In app/workspace/[workspaceId]/page.tsx:

Add state:
```ts
const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([])
const [calendarConfigured, setCalendarConfigured] = useState(true)
const [calendarLoading, setCalendarLoading] = useState(true)
```

Add a useEffect (runs once after workspace loads) that:
- Gets idToken from current user
- Calls GET /api/workspaces/${workspaceId}/calendar-events with Bearer token
- On success: setCalendarEvents, setCalendarConfigured from response
- On error: console.error, setCalendarLoading(false)
- Always: setCalendarLoading(false)

Place the Upcoming Meetings section at the TOP of the Overview tab content
(value="overview"), before the existing cards. Render:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      <CalendarDays className="h-4 w-4" /> Upcoming Meetings
    </CardTitle>
  </CardHeader>
  <CardContent>
    {calendarLoading && <Skeleton />}
    {!calendarLoading && !calendarConfigured && (
      <p className="text-sm text-muted-foreground">
        No calendar connected yet. Ezra will add upcoming meetings here.
      </p>
    )}
    {!calendarLoading && calendarConfigured && calendarEvents.length === 0 && (
      <p className="text-sm text-muted-foreground">No upcoming meetings in the next 30 days.</p>
    )}
    {calendarEvents.map((ev) => (
      <div key={ev.id} className="flex items-start justify-between gap-4 py-3
                                  border-b last:border-0">
        <div>
          <p className="text-sm font-medium">{ev.summary}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(ev.startAt).toLocaleString()}
          </p>
          {ev.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {ev.description}
            </p>
          )}
        </div>
        {ev.meetLink && (
          <a
            href={ev.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0"
          >
            <Button size="sm" variant="outline" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" /> Join
            </Button>
          </a>
        )}
      </div>
    ))}
  </CardContent>
</Card>
```

CalendarDays is already imported in the workspace page — verify before adding.

## 4. Extend Slack notify route (app/api/slack/notify/route.ts)

Add "meeting_scheduled" to the SlackNotification event union:
```ts
event: "signup" | "payment" | "upgrade" | "meeting_scheduled"
```

Add to the switch in the handler:
```ts
case "meeting_scheduled":
  emoji = "📅"
  message = `${emoji} *Meeting Scheduled*\n*Client:* ${name || email}\n` +
    `*Title:* ${description || "Meeting"}\n` +
    `*Time:* ${planType || "TBD"}`  // planType reused as timeString here
  break
```

Document in a comment above the switch:
```
// For meeting_scheduled: pass name=clientName, description=eventTitle,
// planType=formattedStartTime, email=clientEmail
```

## 5. npm install

Add to package.json dependencies:
```
"googleapis": "^144.0.0"
```
Run `npm install googleapis` before building.

## Acceptance criteria
- `npx tsc --noEmit` passes
- `npm run build` passes
- If GOOGLE_SERVICE_ACCOUNT_EMAIL is not set, the section shows the soft
  placeholder message without throwing
- If calendarId is set on a workspace, upcoming events render in the Overview tab
- Join button links to the Google Meet URL when hangoutLink is present
- POST to /api/slack/notify with event="meeting_scheduled" returns 200


================================================================================
DEPLOYMENT CHECKLIST (run after all 3 prompts pass build)
================================================================================

□ Firestore rules — manually add the updates subcollection rules from the
  TODO.md note left by GI-1
□ GCP — enable Google Calendar API on beam-home project
□ GCP — create service account, download JSON key, add email + key to .env.local
□ For each active workspace in Firestore — set googleCalendarId to that
  client's Google Calendar ID (share the calendar with the SA email first)
□ Test: post a video update from admin panel → verify client sees "New" badge
□ Test: add a calendar event to a client's calendar → verify it shows in
  their workspace Overview within 30s (events are fetched fresh on page load)
□ Test: call /api/slack/notify with meeting_scheduled → verify Slack message
□ Deploy to Vercel — add GOOGLE_SERVICE_ACCOUNT_EMAIL and
  GOOGLE_SERVICE_ACCOUNT_KEY to Vercel environment variables
  (Key must use literal \n — Vercel stores it correctly if pasted as-is)
