"use client"

import { useRef, useState, type DragEvent } from "react"
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore"
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage"
import { FileUp, Loader2, UploadCloud } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getDb, getStorageInstance } from "@/lib/firebase/config"
import { generateReadableId, type OrgProject } from "@/lib/organizations"

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".xlsx", ".csv", ".png", ".jpg", ".jpeg"]
const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",")

interface OrgFileUploadProps {
  orgId: string
  userUid: string
  projects: OrgProject[]
}

function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
}

function getExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.[^.]+$/)
  return match?.[0] ?? ""
}

export function OrgFileUpload({ orgId, userUid, projects }: OrgFileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [projectId, setProjectId] = useState("none")
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const uploadFile = async (file: File) => {
    const extension = getExtension(file.name)

    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setError("Unsupported file type.")
      return
    }

    setUploading(true)
    setProgress(0)
    setError(null)

    try {
      const fileId = generateReadableId("file")
      const filename = sanitizeFilename(file.name) || `upload${extension}`
      const projectSegment = projectId === "none" ? "general" : projectId
      const storagePath = `org-files/${orgId}/${projectSegment}/${Date.now()}-${filename}`
      const storageRef = ref(getStorageInstance(), storagePath)
      const task = uploadBytesResumable(storageRef, file, {
        contentType: file.type || undefined,
        customMetadata: {
          orgId,
          projectId: projectId === "none" ? "general" : projectId,
        },
      })

      await new Promise<void>((resolve, reject) => {
        task.on(
          "state_changed",
          (snapshot) => {
            const nextProgress = Math.round(
              (snapshot.bytesTransferred / snapshot.totalBytes) * 100
            )
            setProgress(nextProgress)
          },
          reject,
          () => resolve()
        )
      })

      const url = await getDownloadURL(task.snapshot.ref)
      const firestoreDb = getDb()

      await setDoc(doc(firestoreDb, "organizations", orgId, "files", fileId), {
        id: fileId,
        projectId: projectId === "none" ? null : projectId,
        name: file.name,
        type: "upload",
        url,
        mimeType: file.type || extension.replace(".", ""),
        size: file.size,
        storagePath,
        uploadedByUid: userUid,
        uploadedAt: serverTimestamp(),
        extractedTasks: [],
        taskExtractionStatus: null,
      })
      await updateDoc(doc(firestoreDb, "organizations", orgId), {
        lastActivityAt: serverTimestamp(),
      })

      setProjectId("none")
      if (inputRef.current) {
        inputRef.current.value = ""
      }
    } catch (uploadError) {
      console.error(uploadError)
      setError("Upload failed. Try again.")
    } finally {
      setUploading(false)
      setProgress(0)
      setDragging(false)
    }
  }

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0]
    if (file) {
      void uploadFile(file)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    handleFiles(event.dataTransfer.files)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-semibold text-slate-700">Project</label>
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="none">General files</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-[24px] border border-dashed p-6 text-center transition ${
          dragging ? "border-primary bg-primary/5" : "border-border/80 bg-white/80"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => handleFiles(event.target.files)}
        />
        <UploadCloud className="mx-auto h-10 w-10 text-slate-400" />
        <p className="mt-3 text-sm font-semibold text-slate-900">
          Drag a file here or browse
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          PDF, DOCX, TXT, MD, XLSX, CSV, PNG, or JPG
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileUp className="mr-2 h-4 w-4" />
          )}
          Browse Files
        </Button>
      </div>

      {uploading ? (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">{progress}% uploaded</p>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  )
}
