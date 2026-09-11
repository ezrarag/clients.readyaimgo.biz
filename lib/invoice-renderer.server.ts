import { readFile } from "node:fs/promises"
import path from "node:path"
import { getInvoiceTemplate } from "./invoice-templates"
import type { ClientInvoice } from "./invoices"
import { MANUAL_PAYMENT_METHODS } from "./payment-methods"
import { normalizeContract, type BeamContract } from "./contracts"
import { getAdminDb } from "./firebase-admin"

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatDate(value: string) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100)
}

function invoiceTemplatePath(fileName: string) {
  return path.join(process.cwd(), "docs", "invoices", fileName)
}

function buildMetaBlock(invoice: ClientInvoice) {
  const thirdFieldLabel = invoice.templateId === "client_milestone" ? "Project" : "Billing period"
  const thirdFieldValue = invoice.templateId === "client_milestone" ? (invoice.title || invoice.billingPeriod) : invoice.billingPeriod
  const dueDateDisplay = (invoice.dueDate && invoice.dueDate.toLowerCase().includes("receipt"))
    ? "Upon receipt"
    : formatDate(invoice.dueDate)

  return `<!-- meta row -->
  <div style="display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 24px; break-inside: avoid;">
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Issue date</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(formatDate(invoice.issueDate))}</div>
    </div>
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Due date</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(dueDateDisplay)}</div>
    </div>
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">${escapeHtml(thirdFieldLabel)}</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(thirdFieldValue)}</div>
    </div>
  </div>

  <!-- from / bill to -->`
}

function buildPartyBlock(invoice: ClientInvoice) {
  const fromLines = [invoice.from.name, invoice.from.company, invoice.from.address, invoice.from.email].filter(Boolean)
  const billToLines = [invoice.billTo.name, invoice.billTo.company, invoice.billTo.address, invoice.billTo.email].filter(Boolean)
  const nextMarker = invoice.templateId === "client_milestone" ? "<!-- contract summary -->" : "<!-- line items -->"

  return `<!-- from / bill to -->
  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 34px; break-inside: avoid;">
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">From</div>
      <div style="font-size: 15px; color: #111827; margin-top: 8px; line-height: 1.6;">
        ${fromLines.map((line) => escapeHtml(line)).join("<br>\n        ")}
      </div>
    </div>
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Bill to</div>
      <div style="font-size: 15px; color: #111827; margin-top: 8px; line-height: 1.6;">
        ${billToLines.map((line) => escapeHtml(line)).join("<br>\n        ")}
      </div>
    </div>
  </div>

  ${nextMarker}`
}

function buildStatsRowBlock(invoice: ClientInvoice) {
  const totalContractValueCents = invoice.totalContractValueCents ?? invoice.totalCents
  const paidToDateCents = invoice.paidToDateCents ?? 0
  const thisInvoiceCents = invoice.totalCents

  return `<!-- contract summary -->
  <div style="display: grid; grid-template-columns: repeat(3,1fr); gap: 1px; margin-top: 36px; background: #e5e5e5; border: 1px solid #e5e5e5; break-inside: avoid;">
    <div style="padding: 16px 18px; background: #fff;">
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Total contract value</div>
      <div style="font-size: 20px; color: #111827; font-weight: 700; margin-top: 6px;">${escapeHtml(formatCurrency(totalContractValueCents))}</div>
    </div>
    <div style="padding: 16px 18px; background: #fff;">
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Paid to date</div>
      <div style="font-size: 20px; color: #111827; font-weight: 700; margin-top: 6px;">${escapeHtml(formatCurrency(paidToDateCents))}</div>
    </div>
    <div style="padding: 16px 18px; background: #FBF3EA;">
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #a85f21;">This invoice</div>
      <div style="font-size: 20px; color: #F97316; font-weight: 700; margin-top: 6px;">${escapeHtml(formatCurrency(thisInvoiceCents))}</div>
    </div>
  </div>

  <!-- milestone table -->`
}

function buildMilestoneTableBlock(
  invoice: ClientInvoice,
  contract?: BeamContract | null,
  paidInstallmentIndexes: Set<number> = new Set()
) {
  const milestones = (contract?.paymentDates && contract.paymentDates.length > 0)
    ? contract.paymentDates
    : [invoice.milestoneLabel || invoice.title || "Milestone 1"]

  const milestoneAmounts = contract?.milestoneAmountsCents || []
  const currentIdx = invoice.installmentIndex ?? 0

  const rows = milestones.map((m, idx) => {
    const isCurrent = idx === currentIdx
    const isPaid = paidInstallmentIndexes.has(idx)

    let statusLabel = "Not yet due"
    let statusColor = "#999"
    let rowBg = ""
    let fontStyle = "color: #999;"
    let amountStyle = "color: #999; text-align: right;"

    if (isPaid) {
      statusLabel = "Paid"
      statusColor = "#1B7A46"
      fontStyle = "color: #111827;"
      amountStyle = "color: #111827; text-align: right;"
    } else if (isCurrent) {
      statusLabel = "Due — this invoice"
      statusColor = "#F97316"
      rowBg = " background: #FBF3EA;"
      fontStyle = "color: #111827; padding-left: 10px; font-weight: 600;"
      amountStyle = "color: #111827; text-align: right; padding-right: 10px; font-weight: 700;"
    }

    const amountCents = milestoneAmounts[idx] ?? (isCurrent ? invoice.totalCents : 0)

    return `      <sc-raw-tr style="border-bottom: 1px solid #e5e5e5;${rowBg}">
        <sc-raw-td style="padding: 14px 0; font-size: 15px; ${fontStyle}">${escapeHtml(`${idx + 1}. ${m}`)}</sc-raw-td>
        <sc-raw-td style="padding: 14px 0; font-size: 13px; color: ${statusColor};${isCurrent ? " font-weight: 600;" : ""}">${escapeHtml(statusLabel)}</sc-raw-td>
        <sc-raw-td style="padding: 14px 0; font-size: 15px; ${amountStyle}">${escapeHtml(formatCurrency(amountCents))}</sc-raw-td>
      </sc-raw-tr>`
  }).join("\n")

  return `<!-- milestone table -->
  <sc-raw-table style="margin-top: 32px;">
    <sc-raw-thead>
      <sc-raw-tr style="border-bottom: 2px solid #111827;">
        <sc-raw-th style="text-align: left; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Milestone</sc-raw-th>
        <sc-raw-th style="text-align: left; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Status</sc-raw-th>
        <sc-raw-th style="text-align: right; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Amount</sc-raw-th>
      </sc-raw-tr>
    </sc-raw-thead>
    <sc-raw-tbody>
${rows}
    </sc-raw-tbody>
  </sc-raw-table>

  <!-- totals -->`
}

function buildLineItemsBlock(invoice: ClientInvoice) {
  const rows = invoice.lineItems.map((item) => `      <sc-raw-tr style="border-bottom: 1px solid #e5e5e5;">
        <sc-raw-td style="padding: 16px 0; font-size: 15px; color: #111827; vertical-align: top;">
          <div style="font-weight: 600;">${escapeHtml(item.description)}</div>
          ${item.notes ? `<div style="color: #666; font-size: 13px; margin-top: 4px;">${escapeHtml(item.notes)}</div>` : ""}
        </sc-raw-td>
        <sc-raw-td style="padding: 16px 0; font-size: 14px; color: #555; vertical-align: top;">${escapeHtml(item.period)}</sc-raw-td>
        <sc-raw-td style="padding: 16px 0; font-size: 14px; color: #555; text-align: center; vertical-align: top;">${escapeHtml(String(item.quantity))}</sc-raw-td>
        <sc-raw-td style="padding: 16px 0; font-size: 14px; color: #555; text-align: right; vertical-align: top;">${escapeHtml(formatCurrency(item.rateCents))}</sc-raw-td>
        <sc-raw-td style="padding: 16px 0; font-size: 15px; color: #111827; text-align: right; font-weight: 600; vertical-align: top;">${escapeHtml(formatCurrency(item.amountCents))}</sc-raw-td>
      </sc-raw-tr>`).join("\n")

  return `<!-- line items -->
  <sc-raw-table style="margin-top: 40px;">
    <sc-raw-thead>
      <sc-raw-tr style="border-bottom: 2px solid #111827;">
        <sc-raw-th style="text-align: left; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Description</sc-raw-th>
        <sc-raw-th style="text-align: left; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Period</sc-raw-th>
        <sc-raw-th style="text-align: center; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Qty</sc-raw-th>
        <sc-raw-th style="text-align: right; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Rate</sc-raw-th>
        <sc-raw-th style="text-align: right; padding: 0 0 10px; font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8a8a8a; font-weight: 500;">Amount</sc-raw-th>
      </sc-raw-tr>
    </sc-raw-thead>
    <sc-raw-tbody>
${rows}
    </sc-raw-tbody>
  </sc-raw-table>

  <!-- totals -->`
}

function buildTotalsBlock(invoice: ClientInvoice) {
  const taxLabel = invoice.taxLabel || "Sales tax"
  const taxAmountText = invoice.taxCents ? formatCurrency(invoice.taxCents) : "Not applicable"
  return `<!-- totals -->
  <div style="display: flex; justify-content: flex-end; margin-top: 4px; break-inside: avoid;">
    <div style="width: 260px;">
      <div style="display: flex; justify-content: space-between; padding: 10px 0; font-size: 12px; color: #999; border-bottom: 1px solid #e5e5e5;">
        <span>${escapeHtml(taxLabel)}</span><span>${escapeHtml(taxAmountText)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 14px 0 0; font-size: 19px; color: #111827; font-weight: 700;">
        <span>Total due</span><span style="color: #F97316;">${escapeHtml(formatCurrency(invoice.totalCents))}</span>
      </div>
    </div>
  </div>

  <!-- payment -->`
}

function buildPaymentBlock(invoice: ClientInvoice) {
  const isClientMilestone = invoice.templateId === "client_milestone"
  const stripeEnabled = invoice.paymentMethods ? invoice.paymentMethods.stripe : true
  const manualEnabled = invoice.paymentMethods ? invoice.paymentMethods.manual : isClientMilestone

  const parts: string[] = []

  if (stripeEnabled) {
    if (invoice.paymentLink) {
      parts.push(
        `Pay securely by card via Stripe: <a href="${escapeHtml(invoice.paymentLink)}" style="font-weight: 600; text-decoration: underline;">${escapeHtml(invoice.paymentLink)}</a><br>` +
        `<span style="color: #666; font-size: 13px;">Link is generated per invoice at checkout.</span>`
      )
    } else {
      parts.push(
        `Payment link will appear once this invoice is accepted and checkout is generated.<br>` +
        `<span style="color: #666; font-size: 13px;">Admin and client can keep editing bill-to details until acceptance.</span>`
      )
    }
  }

  if (manualEnabled) {
    const zelle = MANUAL_PAYMENT_METHODS.zelle
    const applePay = MANUAL_PAYMENT_METHODS.applePay
    const ach = MANUAL_PAYMENT_METHODS.ach

    parts.push(
      `<div style="font-weight: 600; margin-top: ${stripeEnabled ? "14px" : "0"}; color: #111827;">Direct Payment Options (Zelle / Apple Cash / Bank Transfer):</div>` +
      `<div style="font-size: 13.5px; color: #374151; margin-top: 6px; line-height: 1.6;">` +
      `<strong>Zelle:</strong> ${escapeHtml(zelle.handle)} or ${escapeHtml(zelle.altHandle || "")} (${escapeHtml(zelle.recipientName)})<br>` +
      `<strong>Apple Cash:</strong> ${escapeHtml(applePay.number)}<br>` +
      `<strong>ACH / Bank Transfer:</strong> ${escapeHtml(ach.bankName)} | Routing: <code>${escapeHtml(ach.routingNumber)}</code> | Account: <code>${escapeHtml(ach.accountNumber)}</code> (${escapeHtml(ach.accountName)})` +
      `</div>`
    )
  }

  if (parts.length === 0) {
    parts.push(`Payment instructions to follow from ReadyAimGo.`)
  }

  return `<!-- payment -->
  <div style="margin-top: 44px; padding: 22px 24px; background: #FBF7F2; border: 1px solid #f0e2d2; break-inside: avoid;">
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Payment</div>
    <div style="font-size: 15px; color: #111827; margin-top: 8px; line-height: 1.6;">
      ${parts.join("\n      <br>\n      ")}
    </div>
  </div>

  <!-- footer -->`
}

function replaceSection(html: string, startMarker: string, endMarker: string, replacement: string) {
  const start = html.indexOf(startMarker)
  const end = html.indexOf(endMarker)
  if (start === -1 || end === -1 || end <= start) return html
  return `${html.slice(0, start)}${replacement}${html.slice(end)}`
}

export async function renderInvoiceHtml(
  invoice: ClientInvoice,
  contractInput?: BeamContract | null
) {
  const template = getInvoiceTemplate(invoice.templateId)
  if (!template) {
    throw new Error(`Unknown invoice template "${invoice.templateId}".`)
  }

  let contract: BeamContract | null = contractInput || null
  const paidInstallmentIndexes = new Set<number>()

  // If client_milestone template, ensure contract and paid installments are loaded if possible
  if (invoice.templateId === "client_milestone" && invoice.contractId) {
    try {
      const db = getAdminDb()
      if (!contract) {
        const cSnap = await db.collection("contracts").doc(invoice.contractId).get()
        if (cSnap.exists) {
          contract = normalizeContract(cSnap.id, cSnap.data() as Record<string, unknown>)
        }
      }

      if (invoice.clientId) {
        const invSnap = await db
          .collection("clients")
          .doc(invoice.clientId)
          .collection("invoices")
          .where("contractId", "==", invoice.contractId)
          .get()

        for (const doc of invSnap.docs) {
          const invData = doc.data()
          if (invData.status === "paid" && typeof invData.installmentIndex === "number") {
            paidInstallmentIndexes.add(invData.installmentIndex)
          }
        }
      }
    } catch (err) {
      console.warn("Could not load contract or paid invoices in renderInvoiceHtml:", err)
    }
  }

  let html = await readFile(invoiceTemplatePath(template.fileName), "utf8")
  html = html.replaceAll(template.seedInvoiceNumber, invoice.invoiceNumber)

  // JSON-escape block replacements
  const metaBlock = JSON.stringify(buildMetaBlock(invoice)).slice(1, -1)
  const partyBlock = JSON.stringify(buildPartyBlock(invoice)).slice(1, -1)

  if (invoice.templateId === "client_milestone") {
    const statsBlock = JSON.stringify(buildStatsRowBlock(invoice)).slice(1, -1)
    const milestoneBlock = JSON.stringify(
      buildMilestoneTableBlock(invoice, contract, paidInstallmentIndexes)
    ).slice(1, -1)
    const totalsBlock = JSON.stringify(buildTotalsBlock(invoice)).slice(1, -1)
    const paymentBlock = JSON.stringify(buildPaymentBlock(invoice)).slice(1, -1)

    html = replaceSection(html, "<!-- meta row -->", "<!-- from / bill to -->", metaBlock)
    html = replaceSection(html, "<!-- from / bill to -->", "<!-- contract summary -->", partyBlock)
    html = replaceSection(html, "<!-- contract summary -->", "<!-- milestone table -->", statsBlock)
    html = replaceSection(html, "<!-- milestone table -->", "<!-- totals -->", milestoneBlock)
    html = replaceSection(html, "<!-- totals -->", "<!-- payment -->", totalsBlock)
    html = replaceSection(html, "<!-- payment -->", "<!-- footer -->", paymentBlock)
  } else {
    const lineItemsBlock = JSON.stringify(buildLineItemsBlock(invoice)).slice(1, -1)
    const totalsBlock = JSON.stringify(buildTotalsBlock(invoice)).slice(1, -1)
    const paymentBlock = JSON.stringify(buildPaymentBlock(invoice)).slice(1, -1)

    html = replaceSection(html, "<!-- meta row -->", "<!-- from / bill to -->", metaBlock)
    html = replaceSection(html, "<!-- from / bill to -->", "<!-- line items -->", partyBlock)
    html = replaceSection(html, "<!-- line items -->", "<!-- totals -->", lineItemsBlock)
    html = replaceSection(html, "<!-- totals -->", "<!-- payment -->", totalsBlock)
    html = replaceSection(html, "<!-- payment -->", "<!-- footer -->", paymentBlock)
  }

  return html
}
