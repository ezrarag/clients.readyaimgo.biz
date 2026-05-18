// ─── Types ───────────────────────────────────────────────────────────────────

export type WorkspaceFileCategory = "contract" | "general"

export interface WorkspaceFile {
  id: string
  workspaceId: string
  uploadedByUid: string
  uploadedByEmail: string
  name: string
  contentType: string
  size: number
  storagePath: string
  downloadUrl: string
  category: WorkspaceFileCategory
  createdAt: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Storage path prefix — kept here so client upload and server validation agree. */
export const WORKSPACE_FILES_STORAGE_PREFIX = "workspace-files"

/** Maximum upload size in bytes (50 MB). */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

/**
 * MIME types accepted for upload.
 * Checked client-side before upload and server-side before writing metadata.
 */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",                                                          // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",    // .docx
  "application/vnd.ms-excel",                                                    // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",          // .xlsx
  "application/vnd.ms-powerpoint",                                               // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",  // .pptx
  "application/vnd.oasis.opendocument.text",                                     // .odt
  "application/vnd.oasis.opendocument.spreadsheet",                              // .ods
  "text/plain",
  "text/csv",
])

/** HTML `accept` attribute value derived from ALLOWED_MIME_TYPES. */
export const FILE_INPUT_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv"

// ─── Normalizer ───────────────────────────────────────────────────────────────

function toIso(v: unknown): string {
  if (typeof v === "string") return v
  if (v && typeof (v as { toDate?: () => Date }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate().toISOString()
  }
  return new Date().toISOString()
}

export function normalizeWorkspaceFile(
  id: string,
  data: Record<string, unknown>
): WorkspaceFile {
  return {
    id,
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : "",
    uploadedByUid: typeof data.uploadedByUid === "string" ? data.uploadedByUid : "",
    uploadedByEmail: typeof data.uploadedByEmail === "string" ? data.uploadedByEmail : "",
    name: typeof data.name === "string" ? data.name : "Unnamed file",
    contentType: typeof data.contentType === "string" ? data.contentType : "",
    size: typeof data.size === "number" ? data.size : 0,
    storagePath: typeof data.storagePath === "string" ? data.storagePath : "",
    downloadUrl: typeof data.downloadUrl === "string" ? data.downloadUrl : "",
    category: data.category === "general" ? "general" : "contract",
    createdAt: toIso(data.createdAt),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable file size. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Derive a safe, unique storage filename from the original. */
export function buildStorageFileName(originalName: string, uid: string): string {
  const ext = originalName.includes(".")
    ? originalName.split(".").pop()!.toLowerCase()
    : "bin"
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 7)
  // prefix with uid shard so files are naturally grouped per user in Storage
  return `${uid.slice(0, 8)}-${ts}-${rand}.${ext}`
}
