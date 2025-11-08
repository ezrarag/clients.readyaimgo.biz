import { NextRequest, NextResponse } from "next/server"

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL

export interface SlackNotification {
  event: "signup" | "payment" | "upgrade"
  email: string
  name?: string
  planType?: string
  amount?: number
  description?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: SlackNotification = await request.json()
    const { event, email, name, planType, amount, description } = body

    if (!SLACK_WEBHOOK_URL) {
      console.warn("SLACK_WEBHOOK_URL not configured, skipping notification")
      return NextResponse.json({ success: true, skipped: true })
    }

    if (!event || !email) {
      return NextResponse.json(
        { error: "event and email are required" },
        { status: 400 }
      )
    }

    // Format message based on event type
    let message = ""
    let emoji = ""

    switch (event) {
      case "signup":
        emoji = "🎉"
        message = `${emoji} *New Client Signup*\n*Name:* ${name || "N/A"}\n*Email:* ${email}\n*Plan:* ${planType || "free"}`
        break

      case "payment":
        emoji = "💳"
        message = `${emoji} *Payment Received*\n*Email:* ${email}\n*Amount:* $${amount?.toFixed(2) || "0.00"}\n*Description:* ${description || "Subscription payment"}`
        break

      case "upgrade":
        emoji = "⬆️"
        message = `${emoji} *Plan Upgrade*\n*Email:* ${email}\n*Name:* ${name || "N/A"}\n*New Plan:* ${planType || "N/A"}`
        break

      default:
        return NextResponse.json(
          { error: "Invalid event type" },
          { status: 400 }
        )
    }

    // Send to Slack webhook
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: message,
        channel: "#announcements",
      }),
    })

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.statusText}`)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error sending Slack notification:", error)
    // Don't fail the request if Slack notification fails
    return NextResponse.json(
      { error: error.message || "Failed to send notification", success: false },
      { status: 500 }
    )
  }
}

