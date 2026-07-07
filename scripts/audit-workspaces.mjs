#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const DEFAULT_COLLECTIONS = ["workspaces", "projects", "contracts"]

function loadDotEnv(path = ".env.local") {
  const fullPath = resolve(process.cwd(), path)
  if (!existsSync(fullPath)) return

  const lines = readFileSync(fullPath, "utf8").split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const equalsIndex = line.indexOf("=")
    if (equalsIndex === -1) continue

    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && !value.endsWith(quote)) {
      const collected = [value]
      while (index + 1 < lines.length) {
        index += 1
        collected.push(lines[index])
        if (lines[index].trim().endsWith(quote)) break
      }
      value = collected.join("\n").trim()
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] ||= value
  }
}

function readArg(name) {
  const arg = process.argv.find((item) => item === name || item.startsWith(`${name}=`))
  if (!arg) return null
  if (arg === name) return "true"
  return arg.slice(name.length + 1)
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeClientId(value) {
  return normalizeString(value)?.toLowerCase() ?? null
}

function normalizeDomain(value) {
  const clean = normalizeString(value)
  if (!clean) return null
  return clean
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^www\./i, "")
    .trim()
    .toLowerCase() || null
}

function slug(value) {
  return normalizeString(value)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || null
}

function firstPresent(...values) {
  for (const value of values) {
    const clean = normalizeString(value)
    if (clean) return clean
  }
  return null
}

function clusterKey(id, data) {
  const workspaceId = normalizeString(data.workspaceId)
  if (workspaceId) return `workspace:${workspaceId}`

  const clientId = normalizeClientId(data.clientId)
  if (clientId) return `client-id:${clientId}`

  const email = normalizeClientId(
    firstPresent(data.clientEmail, data.email, data.businessEmail, data.registrationEmail)
  )
  if (email) return `email:${email}`

  const domain = normalizeDomain(
    firstPresent(data.primaryDomain, data.targetDomain, data.websiteUrl, data.liveUrl, data.domain)
  )
  if (domain) return `domain:${domain}`

  const name = slug(firstPresent(data.workspaceName, data.businessName, data.clientBusinessName, data.name, data.title))
  if (name) return `name:${name}`

  return `unclustered:${id}`
}

function displayName(id, data) {
  return firstPresent(
    data.workspaceName,
    data.businessName,
    data.clientBusinessName,
    data.companyName,
    data.name,
    data.title,
    id
  )
}

function initFirebase() {
  loadDotEnv()

  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").replace(/\\$/, "")

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
    )
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    })
  }

  return getFirestore()
}

async function readCollection(db, collectionName) {
  const snap = await db.collection(collectionName).get()
  return snap.docs.map((doc) => ({
    id: doc.id,
    refPath: doc.ref.path,
    collection: collectionName,
    data: doc.data() ?? {},
  }))
}

function addFinding(clusters, finding) {
  const key = clusterKey(finding.id, finding.data)
  const current = clusters.get(key) ?? {
    key,
    label: displayName(finding.id, finding.data),
    candidateClientIds: new Set(),
    docs: [],
  }

  const clientId = normalizeClientId(finding.data.clientId)
  if (clientId) current.candidateClientIds.add(clientId)

  current.docs.push({
    collection: finding.collection,
    id: finding.id,
    path: finding.refPath,
    clientId,
    workspaceId: normalizeString(finding.data.workspaceId),
    name: displayName(finding.id, finding.data),
    reason: finding.reason,
  })
  clusters.set(key, current)
}

async function main() {
  const db = initFirebase()
  const reportPath = readArg("--report")
  const failOnFindings = readArg("--fail-on-findings") === "true"

  const clientDocs = await readCollection(db, "clients")
  const validClientIds = new Set(clientDocs.map((doc) => normalizeClientId(doc.id)).filter(Boolean))
  const docs = (
    await Promise.all(DEFAULT_COLLECTIONS.map((collectionName) => readCollection(db, collectionName)))
  ).flat()

  const clusters = new Map()

  for (const doc of docs) {
    const clientId = normalizeClientId(doc.data.clientId)
    if (!clientId) {
      addFinding(clusters, { ...doc, reason: "missing-clientId" })
      continue
    }
    if (!validClientIds.has(clientId)) {
      addFinding(clusters, { ...doc, reason: "invalid-clientId-reference" })
    }
  }

  const serializableClusters = Array.from(clusters.values())
    .map((cluster) => ({
      ...cluster,
      candidateClientIds: Array.from(cluster.candidateClientIds),
      docs: cluster.docs.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => b.docs.length - a.docs.length || a.key.localeCompare(b.key))

  const report = {
    generatedAt: new Date().toISOString(),
    collectionsScanned: ["clients", ...DEFAULT_COLLECTIONS],
    counts: {
      clients: clientDocs.length,
      scannedDocs: docs.length,
      clustersWithFindings: serializableClusters.length,
      docsWithFindings: serializableClusters.reduce((sum, cluster) => sum + cluster.docs.length, 0),
    },
    clusters: serializableClusters,
  }

  const output = JSON.stringify(report, null, 2)
  if (reportPath) {
    writeFileSync(resolve(process.cwd(), reportPath), `${output}\n`)
  }
  console.log(output)

  if (failOnFindings && report.counts.docsWithFindings > 0) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
