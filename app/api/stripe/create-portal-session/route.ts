import { NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import { createStripeServer, getStripeAppUrl, stripeRouteError } from "@/lib/stripe-server"
import { WorkspaceAuthError, assertWorkspaceRole } from "@/lib/workspace-auth"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
} from "@/lib/value-profile"

// Lazy initialization to avoid build-time errors
let stripeInstance: ReturnType<typeof createStripeServer> | null = null

const getStripe = () => {
  if (!stripeInstance) {
    stripeInstance = createStripeServer()
  }
  return stripeInstance
}

async function authorizeWorkspaceBillingPortal({
  request,
  workspaceId,
  customerId,
}: {
  request: NextRequest
  workspaceId: string
  customerId: string
}) {
  const token = getBearerToken(request)
  if (!token) {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  let decoded: Awaited<ReturnType<ReturnType<typeof getAdminAuth>["verifyIdToken"]>>
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    return { error: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) }
  }

  const db = getAdminDb()
  try {
    await assertWorkspaceRole(db, workspaceId, decoded.uid, "beam-participant")
  } catch (error) {
    if (error instanceof WorkspaceAuthError) {
      return { error: NextResponse.json({ error: error.message }, { status: error.status }) }
    }
    throw error
  }

  const workspaceSnap = await db.collection("workspaces").doc(workspaceId).get()
  if (!workspaceSnap.exists) {
    return { error: NextResponse.json({ error: "Workspace not found." }, { status: 404 }) }
  }

  const workspace = workspaceSnap.data() as Record<string, unknown>
  const clientId =
    typeof workspace.clientId === "string" && workspace.clientId.trim()
      ? workspace.clientId.trim().toLowerCase()
      : ""
  const allowedCustomerIds = new Set<string>()

  if (typeof workspace.stripeCustomerId === "string" && workspace.stripeCustomerId.trim()) {
    allowedCustomerIds.add(workspace.stripeCustomerId.trim())
  }

  if (clientId) {
    const [clientSnap, valueProfileSnap] = await Promise.all([
      db.collection("clients").doc(clientId).get(),
      db
        .collection("clients")
        .doc(clientId)
        .collection(VALUE_PROFILE_COLLECTION)
        .doc(VALUE_PROFILE_STATE_DOC)
        .get(),
    ])

    const clientData = clientSnap.exists
      ? (clientSnap.data() as Record<string, unknown>)
      : null
    const valueProfileData = valueProfileSnap.exists
      ? (valueProfileSnap.data() as Record<string, unknown>)
      : null

    if (typeof clientData?.stripeCustomerId === "string" && clientData.stripeCustomerId.trim()) {
      allowedCustomerIds.add(clientData.stripeCustomerId.trim())
    }
    if (
      typeof valueProfileData?.stripeCustomerId === "string" &&
      valueProfileData.stripeCustomerId.trim()
    ) {
      allowedCustomerIds.add(valueProfileData.stripeCustomerId.trim())
    }
  }

  if (!allowedCustomerIds.has(customerId)) {
    return {
      error: NextResponse.json(
        { error: "Billing portal unavailable for this workspace." },
        { status: 403 }
      ),
    }
  }

  return { ok: true }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    const customerId = typeof body.customerId === "string" ? body.customerId.trim() : ""
    // Optional: if the caller supplies a workspaceId, return to the workspace
    // payments tab after the billing portal session ends.
    const workspaceId =
      typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""

    if (!customerId) {
      return NextResponse.json({ error: "Customer ID required" }, { status: 400 })
    }
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required." }, { status: 400 })
    }

    const authorization = await authorizeWorkspaceBillingPortal({
      request,
      workspaceId,
      customerId,
    })
    if ("error" in authorization) return authorization.error

    const appUrl = getStripeAppUrl(request)
    const returnPath = `/workspace/${encodeURIComponent(workspaceId)}?tab=payments`

    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}${returnPath}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: unknown) {
    console.error("Error creating portal session:", error)
    return stripeRouteError(error, "Failed to create billing portal session")
  }
}
