export interface Client {
  uid: string
  name: string
  email: string
  stripeCustomerId?: string
  planType?: string
  beamCoinBalance: number
  housingWalletBalance: number
  companyName?: string
  contactTitle?: string
  phone?: string
  organizationType?: string
  serviceInterests?: string[]
  onboardingNotes?: string
  onboardingStatus?: string
  onboardingSource?: string
  onboardingHandoffId?: string
  claimedClientId?: string
  claimedStoryId?: string
  claimedClientName?: string
  partnerTier?: "agency" | null
  partnerSince?: Date | null
  partnerCommissionPct?: number
  partnerReferralCount?: number
  orgId?: string
  createdAt?: Date
}

export interface Transaction {
  id?: string
  clientId: string
  type: "payment" | "redemption" | "credit"
  amount: number
  timestamp: Date | string
  description: string
}

export interface Subscription {
  planName: string
  renewalDate: string
  amount: number
  status: string
  stripeCustomerId: string
}

export interface HousingWallet {
  credits: number
  value: number
  description: string
}
