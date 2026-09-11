export type InvoiceTemplateDefinition = {
  id: "nexus" | "space" | "motion" | "cohort" | "contract_milestone" | "client_milestone"
  label: string
  productLabel: string
  fileName: string
  seedInvoiceNumber: string
  defaultDescription: string
}

export const INVOICE_TEMPLATES: InvoiceTemplateDefinition[] = [
  {
    id: "nexus",
    label: "Nexus",
    productLabel: "Nexus",
    fileName: "ReadyAimGo Invoice - Nexus.html",
    seedInvoiceNumber: "NEXUS-2026-0001",
    defaultDescription: "Nexus subscription",
  },
  {
    id: "space",
    label: "Space Network",
    productLabel: "Space",
    fileName: "ReadyAimGo Invoice - Space Network.html",
    seedInvoiceNumber: "SPACE-2026-0001",
    defaultDescription: "Space network subscription",
  },
  {
    id: "motion",
    label: "Motion Network",
    productLabel: "Motion",
    fileName: "ReadyAimGo Invoice - Motion Network.html",
    seedInvoiceNumber: "MOTION-2026-0001",
    defaultDescription: "Motion network subscription",
  },
  {
    id: "cohort",
    label: "Cohort Network",
    productLabel: "Cohort",
    fileName: "ReadyAimGo Invoice - Cohort Network.html",
    seedInvoiceNumber: "COHORT-2026-0001",
    defaultDescription: "Cohort network subscription",
  },
  {
    id: "contract_milestone",
    label: "Contract Milestone",
    productLabel: "Milestone",
    fileName: "ReadyAimGo Invoice - Contract Milestone.html",
    seedInvoiceNumber: "MILESTONE-2026-0001",
    defaultDescription: "Contract milestone",
  },
  {
    id: "client_milestone",
    label: "Client Milestone",
    productLabel: "Client Milestone",
    fileName: "ReadyAimGo Invoice - Client Milestone.html",
    seedInvoiceNumber: "RAG-2026-0001",
    defaultDescription: "Client project milestone",
  },
]

export function getInvoiceTemplate(templateId: string) {
  return INVOICE_TEMPLATES.find((template) => template.id === templateId) ?? null
}
