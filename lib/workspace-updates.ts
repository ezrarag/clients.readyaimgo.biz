/**
 * workspace-updates.ts
 *
 * Normalized schema for workspace video/note updates.
 * Records live in `workspaces/{workspaceId}/updates/{updateId}` and are
 * posted by beam-admin, then surfaced to clients with unread badges.
 */

export const WORKSPACE_UPDATE_TYPES = ["video", "note", "loom"] as const
export type WorkspaceUpdateType = (typeof WORKSPACE_UPDATE_TYPES)[number]

export interface WorkspaceUpdate {
  id: string
  type: WorkspaceUpdateType
  title: string
  description: string | null
  url: string
  thumbnailUrl: string | null
  postedByUid: string
  /** ISO string (normalized from Firestore Timestamp). */
  postedAt: string
  /** UIDs of members who have opened this update. */
  seenBy: string[]
  workspaceId: string
  /** Pinned updates show first. */
  pinned: boolean
}

// ─── Serialization helpers ────────────────────────────────────────────────────

function serializeTimestamp(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  if (
    value !== null &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString()
  }
  if (
    value !== null &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds: unknown }).seconds === "number"
  ) {
    const date = new Date((value as { seconds: number }).seconds * 1000)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return new Date().toISOString()
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeWorkspaceUpdate(
  id: string,
  data: Record<string, unknown>
): WorkspaceUpdate {
  return {
    id,
    type: WORKSPACE_UPDATE_TYPES.includes(data.type as WorkspaceUpdateType)
      ? (data.type as WorkspaceUpdateType)
      : "note",
    title: typeof data.title === "string" ? data.title.trim() : "",
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description.trim()
        : null,
    url: typeof data.url === "string" ? data.url.trim() : "",
    thumbnailUrl:
      typeof data.thumbnailUrl === "string" && data.thumbnailUrl.trim()
        ? data.thumbnailUrl.trim()
        : null,
    postedByUid: typeof data.postedByUid === "string" ? data.postedByUid : "",
    postedAt: serializeTimestamp(data.postedAt),
    seenBy: Array.isArray(data.seenBy)
      ? (data.seenBy as unknown[]).filter((uid): uid is string => typeof uid === "string")
      : [],
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : "",
    pinned: data.pinned === true,
  }
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Returns a YouTube embed URL from a regular YouTube watch/share URL.
 * Returns null if the url is not a recognized YouTube URL.
 *
 * Supported forms:
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID (passed through)
 */
export function toYouTubeEmbed(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.replace(/^www\./, "")
  let videoId: string | null = null

  if (host === "youtube.com" || host === "m.youtube.com") {
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v")
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.slice("/shorts/".length).split("/")[0] || null
    } else if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.slice("/embed/".length).split("/")[0] || null
    }
  } else if (host === "youtu.be") {
    videoId = parsed.pathname.slice(1).split("/")[0] || null
  }

  if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null
  return `https://www.youtube.com/embed/${videoId}`
}

/** Returns true if the given uid has NOT seen this update. */
export function isUnread(update: WorkspaceUpdate, uid: string): boolean {
  return !update.seenBy.includes(uid)
}
