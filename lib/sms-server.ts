interface SmsResult {
  sent: boolean
  skipped?: boolean
  reason?: string
}

function twilioAuthHeader(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
}

export async function sendSms({
  to,
  body,
}: {
  to: string
  body: string
}): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim()
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim()
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim()
  const from = process.env.TWILIO_FROM_PHONE_NUMBER?.trim()

  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    return { sent: false, skipped: true, reason: "Twilio is not configured." }
  }

  const params = new URLSearchParams()
  params.set("To", to)
  params.set("Body", body)
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid)
  } else if (from) {
    params.set("From", from)
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: twilioAuthHeader(accountSid, authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  )

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Twilio SMS failed (${response.status}): ${text.slice(0, 240)}`)
  }

  return { sent: true }
}
