"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import {
  Bot,
  Cloud,
  Download,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
} from "lucide-react"

import { OrgTaskList } from "@/components/org/org-task-list"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { OrgFile, OrgMember, OrgProject } from "@/lib/organizations"

interface OrgFileCardProps {
  orgId: string
  file: OrgFile
  members: OrgMember[]
  projects: OrgProject[]
  canEdit: boolean
}

function formatBytes(value: number | null) {
  if (!value) {
    return "Unknown size"
  }

  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return "N/A"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "N/A"
  }

  return format(date, "MMM d, yyyy")
}

function fileExtension(file: OrgFile) {
  const nameExtension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""
  if (nameExtension) {
    return nameExtension
  }

  if (file.mimeType.includes("pdf")) return ".pdf"
  if (file.mimeType.includes("word")) return ".docx"
  if (file.mimeType.includes("text")) return ".txt"
  return ""
}

function canExtractTasks(file: OrgFile) {
  return [".pdf", ".docx", ".txt", ".md"].includes(fileExtension(file))
}

function FileIcon({ file }: { file: OrgFile }) {
  const extension = fileExtension(file)

  if (file.type === "google_drive") {
    return <Cloud className="h-5 w-5" />
  }

  if ([".png", ".jpg", ".jpeg"].includes(extension) || file.mimeType.startsWith("image/")) {
    return <ImageIcon className="h-5 w-5" />
  }

  if ([".xlsx", ".csv"].includes(extension) || file.mimeType.includes("sheet")) {
    return <FileSpreadsheet className="h-5 w-5" />
  }

  if ([".pdf", ".docx", ".txt", ".md"].includes(extension)) {
    return <FileText className="h-5 w-5" />
  }

  return <File className="h-5 w-5" />
}

export function OrgFileCard({
  orgId,
  file,
  members,
  projects,
  canEdit,
}: OrgFileCardProps) {
  const [extracting, setExtracting] = useState(false)
  const [extractMessage, setExtractMessage] = useState("Reading document...")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!extracting) {
      return
    }

    const timeout = window.setTimeout(() => {
      setExtractMessage("Extracting tasks...")
    }, 1200)

    return () => window.clearTimeout(timeout)
  }, [extracting])

  const project = useMemo(
    () => projects.find((item) => item.id === file.projectId) ?? null,
    [file.projectId, projects]
  )
  const uploader = useMemo(
    () => members.find((member) => member.uid === file.uploadedByUid) ?? null,
    [file.uploadedByUid, members]
  )
  const completedTasks = file.extractedTasks.filter((task) => task.done).length
  const hasExtractedTasks = file.taskExtractionStatus === "done" || file.extractedTasks.length > 0

  const extractTasks = async () => {
    setExtracting(true)
    setExtractMessage("Reading document...")
    setError(null)

    try {
      const response = await fetch("/api/org/extract-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, fileId: file.id }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Extraction failed. Try again."
        throw new Error(message)
      }
    } catch (extractError) {
      setError(
        extractError instanceof Error
          ? extractError.message
          : "Extraction failed. Try again."
      )
    } finally {
      setExtracting(false)
    }
  }

  return (
    <div className="rounded-[24px] border border-border/70 bg-white/85 p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileIcon file={file} />
          </div>
          <div className="min-w-0">
            <p className="break-words text-lg font-semibold text-slate-950">{file.name}</p>
            <p className="mt-1 text-sm text-slate-500">
              {formatBytes(file.size)} · {uploader?.name || uploader?.email || "Unknown"} · {formatOptionalDate(file.uploadedAt)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={file.type === "google_drive" ? "accent" : "secondary"}>
                {file.type === "google_drive" ? "Google Drive" : file.type}
              </Badge>
              {project ? <Badge variant="secondary">{project.name}</Badge> : null}
              {hasExtractedTasks ? (
                <Badge variant="success">
                  {completedTasks}/{file.extractedTasks.length} tasks
                </Badge>
              ) : null}
              {file.taskExtractionStatus === "failed" ? (
                <Badge variant="danger">Extraction failed</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 md:justify-end">
          {canExtractTasks(file) ? (
            <Button
              type="button"
              variant={file.taskExtractionStatus === "failed" ? "outline" : "default"}
              disabled={extracting || file.taskExtractionStatus === "processing"}
              onClick={() => void extractTasks()}
            >
              {extracting || file.taskExtractionStatus === "processing" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : file.taskExtractionStatus === "failed" ? (
                <RefreshCw className="mr-2 h-4 w-4" />
              ) : (
                <Bot className="mr-2 h-4 w-4" />
              )}
              {extracting || file.taskExtractionStatus === "processing"
                ? extractMessage
                : file.taskExtractionStatus === "failed"
                  ? "Retry extraction"
                  : "Extract tasks"}
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <a href={file.url} target="_blank" rel="noreferrer">
              {file.type === "google_drive" ? (
                <ExternalLink className="mr-2 h-4 w-4" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {file.type === "google_drive" ? "Open in Drive" : "Download"}
            </a>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <OrgTaskList orgId={orgId} file={file} members={members} canEdit={canEdit} />
    </div>
  )
}
