import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"
import Stripe from "stripe"

import { getAdminDb } from "@/lib/firebase-admin"
import {
  VALUE_PROFILE_COLLECTION,
  VALUE_PROFILE_PAYMENTS_COLLECTION,
  VALUE_PROFILE_STATE_DOC,
  computeNewlyUnlockedDeliverables,
  computeUnlockedDeliverables,
  getCurrentThreshold,
  normalizeValueProfile,
  uniqueStrings,
} from "@/lib/value-profile"

let stripeInstance: Stripe | null = null

function getStripe() {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY is not set.")
    }

    stripeInstance = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    })
  }

  return stripeInstance
}

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set.")
  }
  return secret
}

function getValueProfileRef(db: FirebaseFirestore.Firestore, clientId: string) {
  return db
    .collection("clients")
    .doc(clientId)
    .collection(VALUE_PROFILE_COLLECTION)
    .doc(VALUE_PROFILE_STATE_DOC)
}

async function writeProjectUnlocks({
  db,
  clientId,
  projectId,
  deliverables,
  totalPaid,
  currentThresholdId,
}: {
  db: FirebaseFirestore.Firestore
  clientId: string
  projectId?: string
  deliverables: string[]
  totalPaid: number
  currentThresholdId?: string
}) {
  const refs = new Map<string, FirebaseFirestore.DocumentReference>()

  if (projectId) {
    const projectRef = db.collection("projects").doc(projectId)
    const projectSnapshot = await projectRef.get()
    if (projectSnapshot.exists) refs.set(projectRef.path, projectRef)
  }

  const directProjectRef = db.collection("projects").doc(clientId)
  const directProjectSnapshot = await directProjectRef.get()
  if (directProjectSnapshot.exists) refs.set(directProjectRef.path, directProjectRef)

  const projectQuerySnapshot = await db
    .collection("projects")
    .where("clientId", "==", clientId)
    .get()

  for (const projectDoc of projectQuerySnapshot.docs) {
    refs.set(projectDoc.ref.path, projectDoc.ref)
  }

  if (refs.size === 0) return

  const batch = db.batch()
  for (const ref of refs.values()) {
    const update: Record<string, unknown> = {
      valueProfileTotalPaid: totalPaid,
      valueProfileCurrentThresholdId: currentThresholdId ?? null,
      valueProfileUpdatedAt: FieldValue.serverTimestamp(),
    }

    if (deliverables.length > 0) {
      update.deliverables = FieldValue.arrayUnion(...deliverables)
      update.unlockedDeliverables = FieldValue.arrayUnion(...deliverables)
    }

    batch.set(ref, update, { merge: true })
  }

  await batch.commit()
}

async function handleValueProfileCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return

  const clientId = session.metadata?.clientId?.trim().toLowerCase()
  if (!clientId) {
    console.warn("Value profile payment missing clientId metadata:", session.id)
    return
  }

  const db = getAdminDb()
  const profileRef = getValueProfileRef(db, clientId)
  const paymentRef = profileRef.collection(VALUE_PROFILE_PAYMENTS_COLLECTION).doc(session.id)
  const amount = (session.amount_total ?? 0) / 100
  const currency = session.currency || "usd"
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id

  const result = await db.runTransaction(async (transaction) => {
    const [profileSnapshot, paymentSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(paymentRef),
    ])

    const existingProfile = normalizeValueProfile(
      clientId,
      (profileSnapshot.data() ?? {}) as Record<string, unknown>
    )

    if (paymentSnapshot.exists) {
      return {
        duplicate: true,
        newlyUnlocked: [] as string[],
        totalPaid: existingProfile.totalPaid,
        currentThresholdId: existingProfile.currentThresholdId,
      }
    }

    const nextTotalPaid = existingProfile.totalPaid + amount
    const thresholdUnlocked = computeUnlockedDeliverables(
      existingProfile.thresholds,
      nextTotalPaid
    )
    const nextUnlocked = uniqueStrings([
      ...existingProfile.unlockedDeliverables,
      ...thresholdUnlocked,
    ])
    const newlyUnlocked = computeNewlyUnlockedDeliverables(
      existingProfile.unlockedDeliverables,
      nextUnlocked
    )
    const currentThreshold = getCurrentThreshold(
      existingProfile.thresholds,
      nextTotalPaid
    )

    transaction.set(
      profileRef,
      {
        clientId,
        totalPaid: nextTotalPaid,
        currency,
        unlockedDeliverables: nextUnlocked,
        currentThresholdId: currentThreshold?.id ?? null,
        stripeCustomerId: customerId ?? existingProfile.stripeCustomerId ?? null,
        lastPaymentAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: profileSnapshot.exists
          ? profileSnapshot.data()?.createdAt ?? FieldValue.serverTimestamp()
          : FieldValue.serverTimestamp(),
      },
      { merge: true }
    )

    transaction.set(paymentRef, {
      id: paymentRef.id,
      amount,
      currency,
      status: "succeeded",
      source: "stripe",
      description: `Value profile payment - ${session.id}`,
      clientEmail:
        session.customer_details?.email ||
        session.metadata?.clientEmail ||
        null,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null,
      createdAt: FieldValue.serverTimestamp(),
    })

    return {
      duplicate: false,
      newlyUnlocked,
      totalPaid: nextTotalPaid,
      currentThresholdId: currentThreshold?.id,
    }
  })

  if (!result.duplicate) {
    await writeProjectUnlocks({
      db,
      clientId,
      projectId: session.metadata?.projectId,
      deliverables: result.newlyUnlocked,
      totalPaid: result.totalPaid,
      currentThresholdId: result.currentThresholdId,
    })
  }
}

async function handleDeliverableCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.payment_status !== "paid") return

  const clientId = session.metadata?.clientId?.trim().toLowerCase()
  const deliverableId = session.metadata?.deliverableId?.trim()
  if (!clientId || !deliverableId) {
    console.warn("Deliverable payment missing metadata:", session.id)
    return
  }

  const db = getAdminDb()
  const deliverableRef = db
    .collection("clients")
    .doc(clientId)
    .collection("deliverables")
    .doc(deliverableId)
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id
  const amount = (session.amount_total ?? 0) / 100

  const result = await db.runTransaction(async (transaction) => {
    const deliverableSnapshot = await transaction.get(deliverableRef)
    if (!deliverableSnapshot.exists) {
      return { missing: true, duplicate: false }
    }

    const data = deliverableSnapshot.data() as Record<string, unknown>
    if (data.status === "paid") {
      return { missing: false, duplicate: true }
    }

    transaction.set(
      deliverableRef,
      {
        status: "paid",
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: paymentIntentId ?? null,
        paidByEmail:
          session.customer_details?.email ||
          session.metadata?.clientEmail ||
          null,
      },
      { merge: true }
    )

    return {
      missing: false,
      duplicate: false,
      title: typeof data.title === "string" ? data.title : "Deliverable",
    }
  })

  if (result.missing) {
    console.warn("Deliverable payment target not found:", {
      checkoutSessionId: session.id,
      clientId,
      deliverableId,
    })
    return
  }

  if (!result.duplicate) {
    await db.collection("transactions").add({
      clientId,
      type: "payment",
      amount,
      timestamp: FieldValue.serverTimestamp(),
      description: `Deliverable payment - ${result.title}`,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId ?? null,
      deliverableId,
    })
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  const db = getAdminDb()
  const snapshot = await db
    .collection("clients")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get()

  if (snapshot.empty) return

  const priceNickname = subscription.items.data[0]?.price?.nickname || "Standard"
  await snapshot.docs[0].ref.set(
    {
      planType: priceNickname,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  const db = getAdminDb()
  const snapshot = await db
    .collection("clients")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get()

  if (snapshot.empty) return

  await snapshot.docs[0].ref.set(
    {
      planType: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  if (!customerId) return

  const db = getAdminDb()
  const snapshot = await db
    .collection("clients")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get()

  if (snapshot.empty) return

  const clientDoc = snapshot.docs[0]
  await db.collection("transactions").add({
    clientId: clientDoc.id,
    type: "payment",
    amount: (invoice.amount_paid || 0) / 100,
    timestamp: FieldValue.serverTimestamp(),
    description: `Subscription payment - ${invoice.number || invoice.id}`,
  })
}

export async function handleStripeWebhook(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, getWebhookSecret())
  } catch (error) {
    console.error("Webhook signature verification failed:", error)
    return NextResponse.json({ error: "Webhook Error" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.metadata?.purpose === "value_profile_payment") {
          await handleValueProfileCheckoutCompleted(session)
        }
        if (session.metadata?.purpose === "deliverable_payment") {
          await handleDeliverableCheckoutCompleted(session)
        }
        break
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription)
        break
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing Stripe webhook:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
