export interface Client {
  uid: string
  name: string
  email: string
  stripeCustomerId?: string
  planType?: string
  beamCoinBalance: number
  housingWalletBalance: number
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

