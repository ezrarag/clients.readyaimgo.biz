import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_PAYMENTS_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
  computeInfrastructureCostAttribution,
  normalizeValuePaymentRecord,
  normalizeValueProfile,
} from "@/lib/value-profile"

export const dynamic = "force-dynamic"

type ServiceLike = {
  id: string
  name: string
  vendor: string
  category: string
  monthlyCost: number
  dependentProjects: string[]
  clientIds: string[]
  clientCostAllocations: Record<string, number>
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []

function asNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, rawValue]) => [key.trim(), asNumber(rawValue)] as const)
      .filter(([key, rawValue]) => key.length > 0 && rawValue >= 0)
  )
}

function normalizeService(id: string, raw: Record<string, unknown>): ServiceLike {
  return {
    id,
    name: asString(raw.name),
    vendor: asString(raw.vendor),
    category: asString(raw.category, "Hosting & Delivery"),
    monthlyCost: Math.max(0, asNumber(raw.monthlyCost)),
    dependentProjects: asStringArray(raw.dependentProjects),
    clientIds: asStringArray(raw.clientIds),
    clientCostAllocations: asNumberMap(raw.clientCostAllocations),
  }
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || ""
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : null
}

async function getAuthorizedClientContext(request: NextRequest, clientId: string) {
  const token = getBearerToken(request)
  if (!token) {
    return { error: NextResponse.json({ error: "Missing authorization token." }, { status: 401 }) }
  }

  const decoded = await getAdminAuth().verifyIdToken(token)
  const email = decoded.email?.toLowerCase().trim()
  if (!email) {
    return { error: NextResponse.json({ error: "Authenticated email required." }, { status: 403 }) }
  }

  const normalizedClientId = clientId.trim().toLowerCase()
  const db = getAdminDb()
  const projectSnapshot = await db
    .collection("projects")
    .where("clientId", "==", normalizedClientId)
    .where("clientPortalEmail", "==", email)
    .limit(1)
    .get()

  if (projectSnapshot.empty) {
    return { error: NextResponse.json({ error: "Project not available for this account." }, { status: 403 }) }
  }

  return {
    db,
    email,
    clientId: normalizedClientId,
    project: projectSnapshot.docs[0].data() as Record<string, unknown>,
  }
}

function getValueProfileRef(db: FirebaseFirestore.Firestore, clientId: string) {
  return db
    .collection("clients")
    .doc(clientId)
    .collection(VALUE_PROFILE_COLLECTION)
    .doc(VALUE_PROFILE_STATE_DOC)
}

export async function GET(
  request: NextRequest,
  context: { params: { clientId: string } }
) {
  try {
    const authContext = await getAuthorizedClientContext(request, context.params.clientId)
    if ("error" in authContext) return authContext.error

    const { db, clientId, project } = authContext
    const clientSnapshot = await db.collection("clients").doc(clientId).get()
    const clientData = (clientSnapshot.data() ?? {}) as Record<string, unknown>
    const profileRef = getValueProfileRef(db, clientId)
    const profileSnapshot = await profileRef.get()

    if (!profileSnapshot.exists) {
      await profileRef.set({
        clientId,
        totalPaid: 0,
        currency: "usd",
        thresholds: [],
        unlockedDeliverables: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    const nextProfileSnapshot = profileSnapshot.exists ? profileSnapshot : await profileRef.get()
    const profile = normalizeValueProfile(
      clientId,
      (nextProfileSnapshot.data() ?? {}) as Record<string, unknown>
    )

    const servicesSnapshot = await db.collection("services").get()
    const services = servicesSnapshot.docs.map((doc) =>
      normalizeService(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
    )
    const clientName = asString(clientData.name) || asString(project.clientName) || clientId
    const brands = asStringArray(clientData.brands)
    const infrastructureCosts = computeInfrastructureCostAttribution(services, {
      id: clientId,
      storyId: asString(clientData.storyId),
      name: clientName,
      brands,
    })
    const paymentsSnapshot = await profileRef
      .collection(VALUE_PROFILE_PAYMENTS_COLLECTION)
      .orderBy("createdAt", "desc")
      .limit(20)
      .get()
    const payments = paymentsSnapshot.docs.map((doc) =>
      normalizeValuePaymentRecord(doc.id, (doc.data() ?? {}) as Record<string, unknown>)
    )

    return NextResponse.json({
      success: true,
      client: {
        id: clientId,
        storyId: asString(clientData.storyId) || undefined,
        name: clientName,
        brands,
      },
      profile,
      infrastructureCosts,
      infrastructureMonthlyTotal: infrastructureCosts.reduce(
        (total, item) => total + item.attributedMonthlyCost,
        0
      ),
      payments,
    })
  } catch (error) {
    console.error("Value profile GET error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load value profile." },
      { status: 500 }
    )
  }
}
