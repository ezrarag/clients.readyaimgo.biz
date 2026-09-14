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
    bankName: "UWM Credit Union",
    routingNumber: "275979076",
    accountNumber: "1095919301",
    accountName: "ReadyAimGo / Ezra Haugabrooks",
  },
}
