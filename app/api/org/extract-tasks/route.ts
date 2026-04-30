import { type NextRequest, NextResponse } from "next/server"
import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore, FieldValue } from "firebase-admin/firestore"
import pdfParse from "pdf-parse/lib/pdf-parse.js"
import mammoth from "mammoth"

import { generateReadableId, type OrgTask } from "@/lib/organizations"

export const runtime = "nodejs"

function getAdminDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    })
  }

  return getFirestore()
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function getExtension(name: string, mimeType: string) {
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ""
  if (extension) return extension
  if (mimeType.includes("pdf")) return ".pdf"
  if (mimeType.includes("word")) return ".docx"
  if (mimeType.includes("markdown")) return ".md"
  if (mimeType.includes("text")) return ".txt"
  return ""
}

function getGoogleDriveFetchUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.includes("drive.google.com") && !parsed.hostname.includes("docs.google.com")) {
      return url
    }

    const docMatch = parsed.pathname.match(/\/document\/d\/([^/]+)/)
    if (docMatch?.[1]) {
      return `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`
    }

    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/)
    const id = fileMatch?.[1] || parsed.searchParams.get("id")
    if (id) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`
    }
  } catch {
    return url
  }

  return url
}

async function fetchFileBuffer(url: string) {
  const response = await fetch(getGoogleDriveFetchUrl(url), { cache: "no-store" })

  if (!response.ok) {
    throw new Error("Unable to fetch file contents.")
  }

  return Buffer.from(await response.arrayBuffer())
}

async function extractDocumentText({
  buffer,
  extension,
}: {
  buffer: Buffer
  extension: string
}) {
  if (extension === ".pdf") {
    const parsed = await pdfParse(buffer)
    return parsed.text || ""
  }

  if (extension === ".docx") {
    const parsed = await mammoth.extractRawText({ buffer })
    return parsed.value || ""
  }

  if (extension === ".txt" || extension === ".md") {
    return buffer.toString("utf8")
  }

  throw new Error("Task extraction only supports PDF, DOCX, TXT, and MD files.")
}

function getAnthropicText(payload: unknown) {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("content" in payload) ||
    !Array.isArray(payload.content)
  ) {
    return ""
  }

  return payload.content
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "text" in part &&
      typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("\n")
    .trim()
}

function parseTaskJson(value: string): Array<{
  text: string
  priority: "high" | "medium" | "low" | null
  dueDate: string | null
}> {
  const cleaned = value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  const parsed: unknown = JSON.parse(cleaned)

  if (!Array.isArray(parsed)) {
    throw new Error("Claude returned a non-array task payload.")
  }

  return parsed
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null
      }

      const text = "text" in item && typeof item.text === "string" ? item.text.trim() : ""
      if (!text) {
        return null
      }

      const priority =
        "priority" in item &&
        (item.priority === "high" || item.priority === "medium" || item.priority === "low")
          ? item.priority
          : null
      const dueDate =
        "dueDate" in item &&
        typeof item.dueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
          ? item.dueDate
          : null

      return { text, priority, dueDate }
    })
    .filter(
      (
        item
      ): item is {
        text: string
        priority: "high" | "medium" | "low" | null
        dueDate: string | null
      } => item !== null
    )
}

async function extractTasksWithClaude(documentText: string): Promise<OrgTask[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not configured.")
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `Extract all action items, tasks, and to-dos from this document.
Return ONLY a JSON array of task objects. No preamble, no markdown fences.
Each task: { "text": string, "priority": "high"|"medium"|"low"|null, "dueDate": "YYYY-MM-DD"|null }
Infer priority from urgency language. Infer due dates from any date mentions.

Document:
${documentText.slice(0, 8000)}`,
        },
      ],
    }),
  })

  const payload: unknown = await response.json()

  if (!response.ok) {
    throw new Error("Claude task extraction failed.")
  }

  const rawText = getAnthropicText(payload)
  const parsedTasks = parseTaskJson(rawText)
  const now = new Date().toISOString()

  return parsedTasks.map((task) => ({
    id: generateReadableId("task"),
    text: task.text,
    done: false,
    assignedTo: null,
    dueDate: task.dueDate,
    priority: task.priority,
    source: "ai_extracted",
    createdAt: now,
  }))
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>
  const orgId = readString(body.orgId)
  const fileId = readString(body.fileId)

  if (!orgId || !fileId) {
    return NextResponse.json({ error: "orgId and fileId are required." }, { status: 400 })
  }

  const db = getAdminDb()
  const fileRef = db.collection("organizations").doc(orgId).collection("files").doc(fileId)

  try {
    const fileSnap = await fileRef.get()

    if (!fileSnap.exists) {
      return NextResponse.json({ error: "File not found." }, { status: 404 })
    }

    const fileData = fileSnap.data() as Record<string, unknown>
    const fileName = readString(fileData.name)
    const mimeType = readString(fileData.mimeType)
    const url = readString(fileData.url)
    const extension = getExtension(fileName, mimeType)

    if (!url) {
      return NextResponse.json({ error: "File URL is missing." }, { status: 400 })
    }

    await fileRef.set(
      {
        taskExtractionStatus: "processing",
      },
      { merge: true }
    )

    const buffer = await fetchFileBuffer(url)
    const documentText = await extractDocumentText({ buffer, extension })

    if (!documentText.trim()) {
      throw new Error("No readable text was found in this document.")
    }

    const tasks = await extractTasksWithClaude(documentText)

    await fileRef.set(
      {
        extractedTasks: tasks,
        taskExtractionStatus: "done",
        taskExtractedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )
    await db.collection("organizations").doc(orgId).set(
      {
        lastActivityAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    return NextResponse.json({ ok: true, tasks })
  } catch (error) {
    await fileRef.set(
      {
        taskExtractionStatus: "failed",
      },
      { merge: true }
    )

    const message = error instanceof Error ? error.message : "Task extraction failed."
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
