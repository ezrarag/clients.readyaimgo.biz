/**
 * Seed endpoint — admin only.
 * POST /api/admin/seed-contracts
 *
 * Idempotent: Seeds RAG fleet contract and Together for Homes project contracts + invoices.
 */

import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { renderInvoiceHtml } from "@/lib/invoice-renderer.server"
import type { ClientInvoice } from "@/lib/invoices"
import { MANUAL_PAYMENT_METHODS } from "@/lib/payment-methods"

export const dynamic = "force-dynamic"

async function isAdmin(uid: string) {
  const db = getAdminDb()
  const snap = await db.collection("users").doc(uid).get()
  if (!snap.exists) return false
  const roles = (snap.data() as Record<string, unknown>).roles
  return Array.isArray(roles) && roles.includes("beam-admin")
}

export async function POST(req: NextRequest) {
  try {
    const h = req.headers.get("authorization") || ""
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null
    if (!token) return NextResponse.json({ error: "Unauthorized." }, { status: 401 })

    const decoded = await getAdminAuth().verifyIdToken(token)
    if (!(await isAdmin(decoded.uid))) {
      return NextResponse.json({ error: "Admin access required." }, { status: 403 })
    }

    const db = getAdminDb()
    const results: string[] = []

    // 1. Fleet contract
    const existingFleet = await db
      .collection("contracts")
      .where("clientEmail", "==", "ezra@readyaimgo.biz")
      .where("contractType", "==", "fleet_maintenance")
      .limit(1)
      .get()

    if (existingFleet.empty) {
      await db.collection("contracts").add({
        clientId: "readyaimgo",
        clientName: "ReadyAimGo",
        clientEmail: "ezra@readyaimgo.biz",
        contractType: "fleet_maintenance",
        status: "draft",
        title: "BEAM Transportation Fleet Maintenance — ReadyAimGo",
        summary:
          "Fleet maintenance services provided by BEAM Transportation cohort participants to ReadyAimGo client vehicles.",
        monthlyValue: 700,
        termMonths: 6,
        startDate: null,
        endDate: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: decoded.uid,
        documentUrl: null,
        beamNgos: ["transport", "finance", "law"],
        notes: "First fleet client.",
      })
      results.push("Seeded RAG Fleet contract.")
    }

    // 2. Together for Homes — Permit Dashboard Contract & Invoices
    const existingTfhPermit = await db
      .collection("contracts")
      .where("clientId", "==", "together-for-homes")
      .where("title", "==", "Together For Homes — Permit Dashboard")
      .limit(1)
      .get()

    let permitContractId = ""
    if (existingTfhPermit.empty) {
      const ref = await db.collection("contracts").add({
        clientId: "together-for-homes",
        workspaceId: "together-for-homes-permit-dashboard",
        clientName: "1000 Friends of Wisconsin / Together for Homes",
        clientEmail: "info@1kfriends.org",
        contractType: "client_project",
        status: "active",
        title: "Together For Homes — Permit Dashboard",
        summary:
          "Development and deployment of the commercial real estate permit tracking dashboard for municipal development.",
        monthlyValue: 0,
        totalContractValueCents: 300000,
        termMonths: 3,
        startDate: new Date().toISOString(),
        endDate: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: decoded.uid,
        documentUrl: null,
        beamNgos: [],
        notes: "Track A client project under fiscal sponsorship of 1000 Friends of Wisconsin.",
        paymentDates: ["Signing", "Permit Dashboard Delivery", "Final Handoff"],
        milestoneAmountsCents: [100000, 100000, 100000],
      })
      permitContractId = ref.id
      results.push("Seeded Together for Homes Permit Dashboard contract.")

      // Seed Milestone 1 (Paid) invoice RAG-TFH-MW1
      const inv1Data: Omit<ClientInvoice, "id"> = {
        clientId: "together-for-homes",
        workspaceId: "together-for-homes-permit-dashboard",
        contractId: permitContractId,
        templateId: "client_milestone",
        invoiceNumber: "RAG-TFH-MW1",
        title: "Milestone 1 — Signing (Together For Homes — Permit Dashboard)",
        status: "paid",
        issueDate: "2026-07-01",
        dueDate: "Upon Receipt",
        billingPeriod: "July 2026",
        from: {
          name: "ReadyAimGo",
          company: "ReadyAimGo LLC",
          address: "Milwaukee, WI",
          email: "support@readyaimgo.biz",
        },
        billTo: {
          name: "Together For Homes",
          company: "1000 Friends of Wisconsin",
          address: "Madison, WI",
          email: "info@1kfriends.org",
        },
        lineItems: [
          {
            description: "Milestone 1: Signing & Initial System Setup",
            period: "July 2026",
            quantity: 1,
            rateCents: 100000,
            amountCents: 100000,
          },
        ],
        subtotalCents: 100000,
        taxLabel: "Not applicable",
        taxCents: 0,
        totalCents: 100000,
        installmentIndex: 0,
        milestoneLabel: "Signing",
        totalContractValueCents: 300000,
        paidToDateCents: 0,
        paymentMethods: { stripe: false, manual: true },
        createdAt: new Date().toISOString(),
      }

      const inv1Contract = {
        paymentDates: ["Signing", "Permit Dashboard Delivery", "Final Handoff"],
        milestoneAmountsCents: [100000, 100000, 100000],
      }
      const renderedHtml1 = await renderInvoiceHtml(inv1Data as ClientInvoice, null)

      await db
        .collection("clients")
        .doc("together-for-homes")
        .collection("invoices")
        .doc("RAG-TFH-MW1")
        .set({
          ...inv1Data,
          renderedHtml: renderedHtml1,
          paidAt: new Date().toISOString(),
        })

      // Seed Milestone 2 (Sent for Review) invoice RAG-TFH-MW2
      const inv2Data: Omit<ClientInvoice, "id"> = {
        clientId: "together-for-homes",
        workspaceId: "together-for-homes-permit-dashboard",
        contractId: permitContractId,
        templateId: "client_milestone",
        invoiceNumber: "RAG-TFH-MW2",
        title: "Milestone 2 — Permit Dashboard Delivery (Together For Homes)",
        status: "client_review",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: "Upon Receipt",
        billingPeriod: "September 2026",
        from: {
          name: "ReadyAimGo",
          company: "ReadyAimGo LLC",
          address: "Milwaukee, WI",
          email: "support@readyaimgo.biz",
        },
        billTo: {
          name: "Together For Homes",
          company: "1000 Friends of Wisconsin",
          address: "Madison, WI",
          email: "info@1kfriends.org",
        },
        lineItems: [
          {
            description: "Milestone 2: Permit Dashboard Development & GIS Integration",
            period: "September 2026",
            quantity: 1,
            rateCents: 100000,
            amountCents: 100000,
          },
        ],
        subtotalCents: 100000,
        taxLabel: "Not applicable",
        taxCents: 0,
        totalCents: 100000,
        installmentIndex: 1,
        milestoneLabel: "Permit Dashboard Delivery",
        totalContractValueCents: 300000,
        paidToDateCents: 100000,
        paymentMethods: { stripe: false, manual: true },
        createdAt: new Date().toISOString(),
      }

      const renderedHtml2 = await renderInvoiceHtml(inv2Data as ClientInvoice, null)

      await db
        .collection("clients")
        .doc("together-for-homes")
        .collection("invoices")
        .doc("RAG-TFH-MW2")
        .set({
          ...inv2Data,
          renderedHtml: renderedHtml2,
        })

      results.push("Seeded RAG-TFH-MW1 (Paid) and RAG-TFH-MW2 (Sent to Client Review).")
    }

    // 3. Together for Homes — Full Website Build Contract & Invoice
    const existingTfhSite = await db
      .collection("contracts")
      .where("clientId", "==", "together-for-homes")
      .where("title", "==", "Together For Homes — Full Website Build")
      .limit(1)
      .get()

    if (existingTfhSite.empty) {
      const siteContractRef = await db.collection("contracts").add({
        clientId: "together-for-homes",
        workspaceId: "together-for-homes-site",
        clientName: "1000 Friends of Wisconsin / Together for Homes",
        clientEmail: "info@1kfriends.org",
        contractType: "client_project",
        status: "active",
        title: "Together For Homes — Full Website Build",
        summary:
          "Design, custom web engineering, CMS integration, and public launch of the full Together for Homes website.",
        monthlyValue: 0,
        totalContractValueCents: 450000,
        termMonths: 4,
        startDate: new Date().toISOString(),
        endDate: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: decoded.uid,
        documentUrl: null,
        beamNgos: [],
        notes: "Full website build project.",
        paymentDates: ["Signing & Architecture", "Interactive Prototype", "Final Launch"],
        milestoneAmountsCents: [150000, 150000, 150000],
      })

      const siteContractId = siteContractRef.id

      // Seed Milestone 1 (Sent for Review) invoice RAG-TFHS-MW1
      const siteInv1Data: Omit<ClientInvoice, "id"> = {
        clientId: "together-for-homes",
        workspaceId: "together-for-homes-site",
        contractId: siteContractId,
        templateId: "client_milestone",
        invoiceNumber: "RAG-TFHS-MW1",
        title: "Milestone 1 — Signing & Architecture (Together For Homes Website)",
        status: "client_review",
        issueDate: new Date().toISOString().slice(0, 10),
        dueDate: "Upon Receipt",
        billingPeriod: "September 2026",
        from: {
          name: "ReadyAimGo",
          company: "ReadyAimGo LLC",
          address: "Milwaukee, WI",
          email: "support@readyaimgo.biz",
        },
        billTo: {
          name: "Together For Homes",
          company: "1000 Friends of Wisconsin",
          address: "Madison, WI",
          email: "info@1kfriends.org",
        },
        lineItems: [
          {
            description: "Milestone 1: Information Architecture & Design Systems",
            period: "September 2026",
            quantity: 1,
            rateCents: 150000,
            amountCents: 150000,
          },
        ],
        subtotalCents: 150000,
        taxLabel: "Not applicable",
        taxCents: 0,
        totalCents: 150000,
        installmentIndex: 0,
        milestoneLabel: "Signing & Architecture",
        totalContractValueCents: 450000,
        paidToDateCents: 0,
        paymentMethods: { stripe: false, manual: true },
        createdAt: new Date().toISOString(),
      }

      const siteContractObj = {
        paymentDates: ["Signing & Architecture", "Interactive Prototype", "Final Launch"],
        milestoneAmountsCents: [150000, 150000, 150000],
      }

      const siteHtml = await renderInvoiceHtml(siteInv1Data as ClientInvoice, null)

      await db
        .collection("clients")
        .doc("together-for-homes")
        .collection("invoices")
        .doc("RAG-TFHS-MW1")
        .set({
          ...siteInv1Data,
          renderedHtml: siteHtml,
        })

      results.push("Seeded Together for Homes Website Build contract and RAG-TFHS-MW1 invoice.")
    }

    return NextResponse.json({
      success: true,
      messages: results.length > 0 ? results : ["All contracts & invoices already up to date."],
    })
  } catch (error) {
    console.error("POST /api/admin/seed-contracts error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to seed contracts." },
      { status: 500 }
    )
  }
}
