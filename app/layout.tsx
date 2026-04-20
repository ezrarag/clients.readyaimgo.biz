import type { Metadata } from "next"
import { Fraunces, Manrope } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/components/auth/AuthProvider"

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
})

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
})

export const metadata: Metadata = {
  title: {
    default: "Readyaimgo Client Hub",
    template: "%s | Readyaimgo Client Hub",
  },
  description:
    "A polished client workspace for subscriptions, BEAM Coin activity, housing wallet credits, and project feedback.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${fraunces.variable} antialiased`}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
