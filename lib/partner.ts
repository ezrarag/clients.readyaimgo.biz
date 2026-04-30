import type { Client } from "@/types"

export interface PartnerReferralLink {
  handoffId: string
  label: string
  businessType: string
  serviceInterests: string[]
  notes: string
  createdAt: string
  url: string
  converted: boolean
  convertedAt: string | null
}

export interface PartnerSubClient {
  email: string
  companyName: string
  organizationType: string
  serviceInterests: string[]
  onboardingStatus: string
  createdAt: string | null
  handoffId: string
}

export interface PartnerRecord {
  email: string
  companyName: string
  partnerTier: "agency"
  commissionPct: number
  totalReferrals: number
  totalConvertedReferrals: number
  referralLinks: PartnerReferralLink[]
  subClients: PartnerSubClient[]
  createdAt: string | null
  updatedAt: string | null
}

export function isAgencyPartner(client: Client | null): boolean {
  return client?.partnerTier === "agency"
}

export function conversionRate(record: PartnerRecord): number {
  if (!record.totalReferrals) return 0
  return Math.round((record.totalConvertedReferrals / record.totalReferrals) * 100)
}

export function normalizePartnerRecord(
  email: string,
  data: Record<string, unknown>
): PartnerRecord {
  return {
    email,
    companyName: typeof data.companyName === "string" ? data.companyName : "",
    partnerTier: "agency",
    commissionPct: typeof data.commissionPct === "number" ? data.commissionPct : 10,
    totalReferrals: typeof data.totalReferrals === "number" ? data.totalReferrals : 0,
    totalConvertedReferrals:
      typeof data.totalConvertedReferrals === "number"
        ? data.totalConvertedReferrals
        : 0,
    referralLinks: Array.isArray(data.referralLinks)
      ? (data.referralLinks as PartnerReferralLink[])
      : [],
    subClients: [],
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  }
}
