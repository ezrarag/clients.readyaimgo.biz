export interface ManualPaymentMethods {
  zelle: {
    handle: string
    altHandle?: string
    recipientName: string
  }
  applePay: {
    number: string
  }
  ach: {
    bankName: string
    routingNumber: string
    accountNumber: string
    accountName: string
  }
}

export const MANUAL_PAYMENT_METHODS: ManualPaymentMethods = {
  zelle: {
    handle: "haugabr2@uwm.edu",
    altHandle: "(404) 973-9860",
    recipientName: "Ezra Haugabrooks / ReadyAimGo",
  },
  applePay: {
    number: "404-973-9860",
  },
  ach: {
    bankName: "UW Credit Union",
    routingNumber: "275978474",
    accountNumber: "2300054321",
    accountName: "ReadyAimGo / Ezra Haugabrooks",
  },
}
