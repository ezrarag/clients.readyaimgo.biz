import { readFile } from "node:fs/promises"
import path from "node:path"
import { getInvoiceTemplate } from "./invoice-templates"
import type { ClientInvoice } from "./invoices"

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatDate(value: string) {
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
  return `<!-- meta row -->
  <div style="display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin-top: 24px; break-inside: avoid;">
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Issue date</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(formatDate(invoice.issueDate))}</div>
    </div>
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Due date</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(formatDate(invoice.dueDate))}</div>
    </div>
    <div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Billing period</div>
      <div style="font-size: 14px; color: #111827; margin-top: 4px;">${escapeHtml(invoice.billingPeriod)}</div>
    </div>
  </div>

  <!-- from / bill to -->`
}

function buildPartyBlock(invoice: ClientInvoice) {
  const fromLines = [invoice.from.name, invoice.from.company, invoice.from.address, invoice.from.email].filter(Boolean)
  const billToLines = [invoice.billTo.name, invoice.billTo.company, invoice.billTo.address, invoice.billTo.email].filter(Boolean)
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

  <!-- line items -->`
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
      <div style="display: flex; justify-content: space-between; padding: 10px 0; font-size: 14px; color: #555;">
        <span>Subtotal</span><span>${escapeHtml(formatCurrency(invoice.subtotalCents))}</span>
      </div>
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
  return `<!-- payment -->
  <div style="margin-top: 44px; padding: 22px 24px; background: #FBF7F2; border: 1px solid #f0e2d2; break-inside: avoid;">
    <div style="font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #8a8a8a;">Payment</div>
    <div style="font-size: 15px; color: #111827; margin-top: 8px; line-height: 1.6;">
      ${invoice.paymentLink
        ? `Pay securely by card via Stripe: <a href="${escapeHtml(invoice.paymentLink)}" style="font-weight: 600; text-decoration: underline;">${escapeHtml(invoice.paymentLink)}</a><br>
      <span style="color: #666; font-size: 13px;">Link is generated per invoice at checkout.</span>`
        : `Payment link will appear once this invoice is accepted and checkout is generated.<br>
      <span style="color: #666; font-size: 13px;">Admin and client can keep editing bill-to details until acceptance.</span>`}
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

export async function renderInvoiceHtml(invoice: ClientInvoice) {
  const template = getInvoiceTemplate(invoice.templateId)
  if (!template) {
    throw new Error(`Unknown invoice template "${invoice.templateId}".`)
  }

  let html = await readFile(invoiceTemplatePath(template.fileName), "utf8")
  html = html.replaceAll(template.seedInvoiceNumber, invoice.invoiceNumber)

  // JSON-escape the block replacements to avoid syntax errors inside the JSON template script tag
  const metaBlock = JSON.stringify(buildMetaBlock(invoice)).slice(1, -1)
  const partyBlock = JSON.stringify(buildPartyBlock(invoice)).slice(1, -1)
  const lineItemsBlock = JSON.stringify(buildLineItemsBlock(invoice)).slice(1, -1)
  const totalsBlock = JSON.stringify(buildTotalsBlock(invoice)).slice(1, -1)
  const paymentBlock = JSON.stringify(buildPaymentBlock(invoice)).slice(1, -1)

  html = replaceSection(html, "<!-- meta row -->", "<!-- from / bill to -->", metaBlock)
  html = replaceSection(html, "<!-- from / bill to -->", "<!-- line items -->", partyBlock)
  html = replaceSection(html, "<!-- line items -->", "<!-- totals -->", lineItemsBlock)
  html = replaceSection(html, "<!-- totals -->", "<!-- payment -->", totalsBlock)
  html = replaceSection(html, "<!-- payment -->", "<!-- footer -->", paymentBlock)
  return html
}

