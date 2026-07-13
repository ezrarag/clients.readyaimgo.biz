export type InvoiceStatus =
  | "draft"
  | "client_review"
  | "accepted"
  | "paid"
  | "cancelled"

export interface InvoiceLineItem {
  description: string
  period: string
  quantity: number
  rateCents: number
  amountCents: number
  notes?: string | null
}

export interface InvoiceParty {
  name: string
  company: string
  address: string
  email: string
}

export interface ClientInvoice {
  id: string
  clientId: string
  workspaceId?: string | null
  contractId?: string | null
  deliverableId?: string | null
  templateId: string
  invoiceNumber: string
  title: string
  status: InvoiceStatus
  issueDate: string
  dueDate: string
  billingPeriod: string
  from: InvoiceParty
  billTo: InvoiceParty
  lineItems: InvoiceLineItem[]
  subtotalCents: number
  taxLabel?: string | null
  taxCents?: number
  totalCents: number
  paymentLink?: string | null
  renderedHtml?: string | null
  editableByClientFields?: string[]
  acceptedAt?: string | null
  paidAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  installmentIndex?: number | null
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function toParty(value: unknown): InvoiceParty {
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  return {
    name: readString(obj.name),
    company: readString(obj.company),
    address: readString(obj.address),
    email: readString(obj.email),
  }
}

function toLineItem(value: unknown): InvoiceLineItem | null {
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const description = readString(obj.description)
  if (!description) return null
  return {
    description,
    period: readString(obj.period),
    quantity: typeof obj.quantity === "number" ? obj.quantity : 1,
    rateCents: typeof obj.rateCents === "number" ? obj.rateCents : 0,
    amountCents: typeof obj.amountCents === "number" ? obj.amountCents : 0,
    notes: typeof obj.notes === "string" ? obj.notes : null,
  }
}

export function normalizeInvoice(id: string, data: Record<string, unknown>): ClientInvoice {
  const lineItems = Array.isArray(data.lineItems)
    ? data.lineItems.map((entry) => toLineItem(entry)).filter((entry): entry is InvoiceLineItem => Boolean(entry))
    : []
  const subtotalCents = readNumber(data.subtotalCents) ?? lineItems.reduce((sum, item) => sum + item.amountCents, 0)
  const taxCents = readNumber(data.taxCents) ?? 0

  return {
    id,
    clientId: readString(data.clientId),
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : null,
    contractId: typeof data.contractId === "string" ? data.contractId : null,
    deliverableId: typeof data.deliverableId === "string" ? data.deliverableId : null,
    templateId: readString(data.templateId) || "nexus",
    invoiceNumber: readString(data.invoiceNumber) || id,
    title: readString(data.title) || "Invoice",
    status: (readString(data.status) as InvoiceStatus) || "draft",
    issueDate: readString(data.issueDate) || new Date().toISOString(),
    dueDate: readString(data.dueDate) || new Date().toISOString(),
    billingPeriod: readString(data.billingPeriod) || "",
    from: toParty(data.from),
    billTo: toParty(data.billTo),
    lineItems,
    subtotalCents,
    taxLabel: typeof data.taxLabel === "string" ? data.taxLabel : null,
    taxCents,
    totalCents: readNumber(data.totalCents) ?? subtotalCents + taxCents,
    paymentLink: typeof data.paymentLink === "string" ? data.paymentLink : null,
    renderedHtml: typeof data.renderedHtml === "string" ? data.renderedHtml : null,
    editableByClientFields: Array.isArray(data.editableByClientFields)
      ? data.editableByClientFields.filter((entry): entry is string => typeof entry === "string")
      : [],
    acceptedAt: typeof data.acceptedAt === "string" ? data.acceptedAt : null,
    paidAt: typeof data.paidAt === "string" ? data.paidAt : null,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    installmentIndex: typeof data.installmentIndex === "number" ? data.installmentIndex : null,
  }
}
