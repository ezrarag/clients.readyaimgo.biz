import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"

export const dynamic = "force-dynamic"

type MeetingProvider = {
  id: "google-meet" | "zoom" | "microsoft-teams" | "facebook-messenger"
  enabled: boolean
  label: string
  accountEmail: string | null
  calendarId: string | null
  webhookUrl: string | null
  meetingBaseUrl: string | null
  isDefault: boolean
  source: "google-login" | "workspace" | "profile" | "ra-command"
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function sanitizeMeetingProviders(value: unknown, defaultAccountEmail: string | null): MeetingProvider[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 8).flatMap((item) => {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {}
    const id = readString(entry.id)
    if (
      id !== "google-meet" &&
      id !== "zoom" &&
      id !== "microsoft-teams" &&
      id !== "facebook-messenger"
    ) {
      return []
    }
    const source =
      entry.source === "google-login" || entry.source === "profile" || entry.source === "ra-command"
        ? entry.source
        : "workspace"
    return [
      {
        id: id as MeetingProvider["id"],
        enabled: Boolean(entry.enabled),
        label: readString(entry.label) ?? id,
        accountEmail: readString(entry.accountEmail) ?? (id === "google-meet" ? defaultAccountEmail : null),
        calendarId: readString(entry.calendarId),
        webhookUrl: readString(entry.webhookUrl),
        meetingBaseUrl: readString(entry.meetingBaseUrl),
        isDefault: Boolean(entry.isDefault),
        source: source as MeetingProvider["source"],
      },
    ]
  })
}

function buildDefaultMeetingProviders(
  decoded: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
): MeetingProvider[] {
  const provider = typeof decoded.firebase?.sign_in_provider === "string" ? decoded.firebase.sign_in_provider : ""
  const email = typeof decoded.email === "string" ? decoded.email.toLowerCase() : null
  const googleDefault = provider.includes("google")
  return [
    {
      id: "google-meet" as const,
      enabled: googleDefault,
      label: "Google Meet",
      accountEmail: googleDefault ? email : null,
      calendarId: "primary",
      webhookUrl: null,
      meetingBaseUrl: "https://meet.google.com",
      isDefault: googleDefault,
      source: googleDefault ? "google-login" : "workspace",
    },
    {
      id: "zoom" as const,
      enabled: false,
      label: "Zoom",
      accountEmail: null,
      calendarId: null,
      webhookUrl: null,
      meetingBaseUrl: "https://zoom.us",
      isDefault: false,
      source: "workspace",
    },
    {
      id: "microsoft-teams" as const,
      enabled: false,
      label: "Microsoft Teams",
      accountEmail: null,
      calendarId: null,
      webhookUrl: null,
      meetingBaseUrl: "https://teams.microsoft.com",
      isDefault: false,
      source: "ra-command",
    },
    {
      id: "facebook-messenger" as const,
      enabled: false,
      label: "Facebook Messenger",
      accountEmail: null,
      calendarId: null,
      webhookUrl: null,
      meetingBaseUrl: "https://m.me",
      isDefault: false,
      source: "workspace",
    },
  ]
}

function serializeDoc(kind: "email" | "event", id: string, data: Record<string, unknown>) {
  return { id, kind, ...data }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    const role = await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")
    const wsSnap = await db.collection("workspaces").doc(params.workspaceId).get()
    const wsData = wsSnap.exists ? (wsSnap.data() as Record<string, unknown>) : {}
    const savedProviders = Array.isArray(wsData.meetingProviders) ? wsData.meetingProviders : []
    const defaultProviders = buildDefaultMeetingProviders(decoded)
    const providerMap = new Map(defaultProviders.map((provider) => [provider.id, provider]))
    for (const provider of sanitizeMeetingProviders(savedProviders, decoded.email ?? null)) {
      providerMap.set(provider.id, { ...providerMap.get(provider.id), ...provider })
    }
    const meetingProviders = Array.from(providerMap.values())
    const defaultMeetingProvider =
      meetingProviders.find((provider) => provider.enabled && provider.isDefault)?.id ??
      meetingProviders.find((provider) => provider.enabled)?.id ??
      null
    const clientId =
      typeof wsData.clientId === "string" && wsData.clientId.trim()
        ? wsData.clientId.trim().toLowerCase()
        : null

    if (!clientId) {
      return NextResponse.json({
        success: true,
        role,
        items: [],
        meetingProviders,
        defaultMeetingProvider,
      })
    }

    const [emailsSnap, eventsSnap] = await Promise.all([
      db.collection("clientComms").doc(clientId).collection("emails").limit(50).get(),
      db.collection("clientComms").doc(clientId).collection("events").limit(50).get(),
    ])

    const unsortedItems = [
      ...emailsSnap.docs.map((doc) => serializeDoc("email", doc.id, doc.data())),
      ...eventsSnap.docs.map((doc) => serializeDoc("event", doc.id, doc.data())),
    ] as Array<Record<string, unknown> & { id: string; kind: "email" | "event" }>

    const items = unsortedItems.sort((a, b) => {
      const aDate = String(a["date"] ?? a["start"] ?? a["syncedAt"] ?? "")
      const bDate = String(b["date"] ?? b["start"] ?? b["syncedAt"] ?? "")
      return bDate.localeCompare(aDate)
    })

    return NextResponse.json({
      success: true,
      role,
      items,
      meetingProviders,
      defaultMeetingProvider,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("GET /workspaces/[workspaceId]/correspondence error:", error)
    return NextResponse.json({ error: "Unable to load correspondence." }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(idToken)
    const db = getAdminDb()

    await assertWorkspaceRole(db, params.workspaceId, decoded.uid, "developer")

    const body = (await request.json()) as Record<string, unknown>
    const providers = sanitizeMeetingProviders(body.meetingProviders, decoded.email ?? null)
    const defaultId = readString(body.defaultMeetingProvider)
    const normalized = providers.map((provider) => ({
      ...provider,
      isDefault: defaultId ? provider.id === defaultId : provider.isDefault,
    }))

    await db.collection("workspaces").doc(params.workspaceId).set(
      {
        meetingProviders: normalized,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({
      success: true,
      meetingProviders: normalized,
      defaultMeetingProvider:
        normalized.find((provider) => provider.enabled && provider.isDefault)?.id ??
        normalized.find((provider) => provider.enabled)?.id ??
        null,
    })
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("POST /workspaces/[workspaceId]/correspondence error:", error)
    return NextResponse.json({ error: "Unable to save meeting providers." }, { status: 500 })
  }
}
