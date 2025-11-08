import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { db } from "@/lib/firebase/config"
import { doc, updateDoc, collection, query, where, getDocs, addDoc } from "firebase/firestore"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-02-24.acacia",
  typescript: true,
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get("stripe-signature")!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message)
    return NextResponse.json({ error: "Webhook Error" }, { status: 400 })
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionUpdate(subscription)
        break

      case "customer.subscription.deleted":
        const deletedSubscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(deletedSubscription)
        break

      case "invoice.payment_succeeded":
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentSucceeded(invoice)
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("Error processing webhook:", error)
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  
  // Find client by stripeCustomerId
  const clientsRef = collection(db, "clients")
  const q = query(clientsRef, where("stripeCustomerId", "==", customerId))
  const snapshot = await getDocs(q)
  
  if (!snapshot.empty) {
    const clientDoc = snapshot.docs[0]
    const clientData = clientDoc.data()
    const newPlanType = subscription.items.data[0]?.price?.nickname || "Standard"
    
    await updateDoc(doc(db, "clients", clientDoc.id), {
      planType: newPlanType,
    })
    
    // Notify Slack about upgrade if plan changed
    if (clientData.planType === "free" && newPlanType !== "free") {
      try {
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/slack/notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "upgrade",
            email: clientData.email,
            name: clientData.name,
            planType: newPlanType,
          }),
        })
      } catch (error) {
        console.error("Error sending Slack notification:", error)
      }
    }
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string
  
  const clientsRef = collection(db, "clients")
  const q = query(clientsRef, where("stripeCustomerId", "==", customerId))
  const snapshot = await getDocs(q)
  
  if (!snapshot.empty) {
    const clientDoc = snapshot.docs[0]
    await updateDoc(doc(db, "clients", clientDoc.id), {
      planType: null,
    })
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string
  const amount = invoice.amount_paid / 100
  
  // Find client
  const clientsRef = collection(db, "clients")
  const q = query(clientsRef, where("stripeCustomerId", "==", customerId))
  const snapshot = await getDocs(q)
  
  if (!snapshot.empty) {
    const clientDoc = snapshot.docs[0]
    const clientData = clientDoc.data()
    const clientId = clientDoc.id
    
    // Create transaction record
    await addDoc(collection(db, "transactions"), {
      clientId,
      type: "payment",
      amount,
      timestamp: new Date(),
      description: `Subscription payment - ${invoice.number || ""}`,
    })
    
    // Notify Slack about payment
    try {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/slack/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "payment",
          email: clientData.email,
          amount: amount,
          description: `Subscription payment - ${invoice.number || ""}`,
        }),
      })
    } catch (error) {
      console.error("Error sending Slack notification:", error)
    }
  }
}

