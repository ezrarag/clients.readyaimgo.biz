"use client"

import { useState, type FormEvent } from "react"
import { Check, Copy, Loader2, Plus } from "lucide-react"

import { CLIENT_SERVICE_OPTIONS } from "@/lib/client-onboarding"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const ORGANIZATION_TYPES = [
  "Dispensary",
  "Transportation",
  "Property operations",
  "Retail",
  "Hospitality",
  "Professional services",
  "Community organization",
  "Real estate",
  "Construction",
  "Other",
]

interface Props {
  partnerEmail: string
  onLinkGenerated?: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function ReferralLinkGenerator({ partnerEmail, onLinkGenerated }: Props) {
  const [label, setLabel] = useState("")
  const [businessType, setBusinessType] = useState("")
  const [notes, setNotes] = useState("")
  const [serviceInterests, setServiceInterests] = useState<string[]>([])
  const [generatedUrl, setGeneratedUrl] = useState("")
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const toggleServiceInterest = (serviceId: string, checked: boolean) => {
    setServiceInterests((current) =>
      checked
        ? Array.from(new Set([...current, serviceId]))
        : current.filter((value) => value !== serviceId)
    )
  }

  const copyGeneratedUrl = async () => {
    if (!generatedUrl) {
      return
    }

    await navigator.clipboard.writeText(generatedUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError("")
    setCopied(false)
    setLoading(true)

    try {
      const response = await fetch("/api/partner/generate-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerEmail: partnerEmail,
          label,
          businessType,
          serviceInterests,
          notes,
        }),
      })
      const payload: unknown = await response.json()

      if (!response.ok) {
        const message =
          isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Unable to generate referral link."
        throw new Error(message)
      }

      if (!isRecord(payload) || typeof payload.url !== "string") {
        throw new Error("Referral link response was missing a URL.")
      }

      setGeneratedUrl(payload.url)
      setLabel("")
      setBusinessType("")
      setNotes("")
      setServiceInterests([])
      onLinkGenerated?.()
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Unable to generate referral link."
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate Referral Link</CardTitle>
        <CardDescription>
          Create a pre-filled signup handoff for a business you manage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Business</label>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Green Leaf Dispensary"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Type</label>
              <select
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">Select one</option>
                {ORGANIZATION_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold text-slate-700">Service interests</p>
            <div className="grid gap-3 md:grid-cols-2">
              {CLIENT_SERVICE_OPTIONS.map((option) => {
                const checked = serviceInterests.includes(option.id)

                return (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-center gap-3 rounded-2xl border border-border/70 bg-white/75 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        toggleServiceInterest(option.id, event.target.checked)
                      }
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                    />
                    <span className="text-sm font-semibold text-slate-800">
                      {option.label}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-700">Notes</label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Context for the RAG team"
              rows={4}
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={loading || !partnerEmail}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Generate Link
            </Button>

            {generatedUrl ? (
              <Button type="button" variant="outline" onClick={copyGeneratedUrl}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy New Link
              </Button>
            ) : null}
          </div>

          {generatedUrl ? (
            <div className="break-all rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {generatedUrl}
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  )
}
