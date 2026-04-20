import { type NextRequest, NextResponse } from "next/server"

const DEFAULT_MARKETING_SITE_URL = "https://readyaimgo.biz"

export async function GET(request: NextRequest) {
  const handoffId = request.nextUrl.searchParams.get("handoff")?.trim()
  if (!handoffId) {
    return NextResponse.json(
      {
        success: false,
        error: "A handoff id is required.",
      },
      { status: 400 }
    )
  }

  const marketingSiteUrl =
    process.env.MARKETING_SITE_URL ||
    process.env.NEXT_PUBLIC_MARKETING_SITE_URL ||
    DEFAULT_MARKETING_SITE_URL

  try {
    const response = await fetch(
      `${marketingSiteUrl.replace(/\/$/, "")}/api/client-handoff/${encodeURIComponent(handoffId)}`,
      {
        cache: "no-store",
      }
    )

    const payload = await response.json()
    return NextResponse.json(payload, { status: response.status })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to fetch onboarding handoff.",
      },
      { status: 500 }
    )
  }
}
