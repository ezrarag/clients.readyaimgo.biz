"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
  Chrome,
  Loader2,
  MessageSquareMore,
  Video,
} from "lucide-react"

import { BrandMark } from "@/components/site/brand"
import { PageBackdrop } from "@/components/site/page-backdrop"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

type Step = "choose" | "text" | "loom" | "extension" | "done"

const EXTENSION_ID = "your-extension-id-here"
const EXTENSION_STORE_URL = `https://chrome.google.com/webstore/detail/readyaimgo/${EXTENSION_ID}`

export default function ClientFeedbackPage() {
  const params = useParams()
  const projectId = params.projectId as string

  const [step, setStep] = useState<Step>("choose")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [text, setText] = useState("")
  const [loomUrl, setLoomUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [interpretation, setInterpretation] = useState<any>(null)

  const submit = async (payload: object) => {
    setSubmitting(true)
    setError("")

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clientName: name,
          clientEmail: email,
          ...payload,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error)
      }

      setInterpretation(data.interpretation)
      setStep("done")
    } catch (submitError: any) {
      setError(submitError.message || "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const resetFeedback = () => {
    setStep("choose")
    setText("")
    setLoomUrl("")
    setError("")
  }

  const stepLabel =
    step === "choose"
      ? "Choose a format"
      : step === "text"
        ? "Written feedback"
        : step === "loom"
          ? "Loom feedback"
          : step === "extension"
            ? "Browser extension"
            : "Submitted"

  if (step === "done") {
    return (
      <div className="relative isolate min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
        <PageBackdrop />
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-center justify-between gap-4">
            <BrandMark />
            <Badge variant="secondary">Project {projectId}</Badge>
          </div>

          <Card className="shadow-glow">
            <CardContent className="space-y-6 py-10 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <div className="space-y-3">
                <h1 className="font-display text-4xl font-semibold text-slate-950">Thank you.</h1>
                <p className="text-base leading-7 text-slate-600">
                  Your feedback has been received and routed to the Readyaimgo team.
                </p>
              </div>

              {interpretation ? (
                <div className="mx-auto max-w-xl rounded-[28px] border border-border/70 bg-muted/35 p-6 text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Interpretation
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    {interpretation.summary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge
                      variant={
                        interpretation.urgency === "high"
                          ? "danger"
                          : interpretation.urgency === "medium"
                            ? "warning"
                            : "success"
                      }
                    >
                      {interpretation.urgency} priority
                    </Badge>
                    <Badge variant="secondary">{interpretation.category}</Badge>
                  </div>
                  {interpretation.suggestedAction ? (
                    <p className="mt-4 text-sm text-slate-500">
                      Suggested next step: {interpretation.suggestedAction}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={resetFeedback}>
                  Leave More Feedback
                </Button>
                <Button asChild>
                  <Link href="/">Back to Readyaimgo</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden px-4 py-6 sm:px-6 lg:px-8">
      <PageBackdrop />
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <BrandMark />
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Project {projectId}</Badge>
            <Badge>{stepLabel}</Badge>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <section className="animate-fade-up space-y-5">
            <Badge variant="secondary" className="bg-white/85">
              Client feedback portal
            </Badge>
            <div className="space-y-4">
              <h1 className="font-display text-balance text-5xl font-semibold leading-tight text-slate-950 sm:text-6xl">
                Share feedback in the way that feels easiest.
              </h1>
              <p className="max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
                The redesigned feedback flow uses the same cards, fields, and button language as
                the rest of the site. That makes the experience feel trustworthy and familiar,
                whether someone writes a quick note or submits a Loom link.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>How this is structured</CardTitle>
                <CardDescription>
                  One intake form, three submission formats, one consistent visual system.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  "Choose the fastest format for the feedback.",
                  "Add optional contact details so the team can follow up.",
                  "Send the note, video, or extension-based context directly to the project.",
                ].map((item, index) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white/80 px-4 py-3 text-sm text-slate-700"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/12 font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="animate-fade-up space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Your details</CardTitle>
                <CardDescription>
                  These fields stay visible across every submission method.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Your name</label>
                  <Input
                    placeholder="Jane Smith"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Email (optional)
                  </label>
                  <Input
                    type="email"
                    placeholder="jane@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>

            {step === "choose" ? (
              <div className="grid gap-4">
                {[
                  {
                    icon: MessageSquareMore,
                    title: "Write a note",
                    copy: "Best for direct written feedback and quick prioritization.",
                    accent: "bg-primary/12 text-primary",
                    nextStep: "text" as Step,
                  },
                  {
                    icon: Video,
                    title: "Send a Loom video",
                    copy: "Best for showing context, walkthroughs, and visual issues.",
                    accent: "bg-sky-100 text-sky-700",
                    nextStep: "loom" as Step,
                  },
                  {
                    icon: Chrome,
                    title: "Use the browser extension",
                    copy: "Best for annotating live pages directly in context.",
                    accent: "bg-violet-100 text-violet-700",
                    nextStep: "extension" as Step,
                  },
                ].map((item) => (
                  <Card
                    key={item.title}
                    className="cursor-pointer transition-transform hover:-translate-y-1"
                    onClick={() => setStep(item.nextStep)}
                  >
                    <CardContent className="flex items-start gap-4 p-6">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-2xl ${item.accent}`}
                      >
                        <item.icon className="h-5 w-5" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-xl font-semibold text-slate-950">{item.title}</p>
                        <p className="text-sm leading-7 text-slate-600">{item.copy}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}

            {step === "text" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <MessageSquareMore className="h-5 w-5" />
                    </span>
                    Written feedback
                  </CardTitle>
                  <CardDescription>
                    Describe the issue, request, or observation in your own words.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Example: The contact form on the homepage does not submit on mobile, and the hero copy feels too tight on smaller screens."
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  {error ? (
                    <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      <AlertCircle className="h-4 w-4" />
                      <span>{error}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => setStep("choose")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => submit({ rawText: text })}
                      disabled={!text.trim() || submitting}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Send Feedback"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {step === "loom" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                      <Video className="h-5 w-5" />
                    </span>
                    Loom feedback
                  </CardTitle>
                  <CardDescription>
                    Paste a Loom URL and optionally add context about what the team should notice.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Loom URL</label>
                    <Input
                      placeholder="https://www.loom.com/share/..."
                      value={loomUrl}
                      onChange={(e) => setLoomUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">
                      Brief description (optional)
                    </label>
                    <Textarea
                      className="min-h-[120px]"
                      placeholder="What should the team focus on in the video?"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </div>
                  <p className="text-sm text-slate-500">
                    Need Loom first?{" "}
                    <a
                      href="https://loom.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary hover:opacity-80"
                    >
                      Open loom.com
                    </a>
                  </p>
                  {error ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => setStep("choose")}>
                      Back
                    </Button>
                    <Button
                      onClick={() => submit({ loomUrl, rawText: text || undefined })}
                      disabled={!loomUrl.includes("loom.com") || submitting}
                    >
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        "Submit Video"
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {step === "extension" ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                      <Chrome className="h-5 w-5" />
                    </span>
                    Browser extension
                  </CardTitle>
                  <CardDescription>
                    Install the extension to leave annotated feedback directly on the live site.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="rounded-[24px] border border-border/70 bg-muted/35 p-5">
                    <p className="text-sm leading-7 text-slate-600">
                      This path is ideal when the issue depends on page context or a specific UI
                      element. Install once, then annotate directly in the browser.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    {[
                      "Install the Readyaimgo Chrome extension.",
                      "Open the live page and launch the extension.",
                      "Click the area you want to annotate and leave your note in context.",
                    ].map((item, index) => (
                      <div
                        key={item}
                        className="flex items-center gap-3 rounded-2xl border border-border/70 bg-white/80 px-4 py-3 text-sm text-slate-700"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 font-semibold text-violet-700">
                          {index + 1}
                        </span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <a href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">
                        <Chrome className="mr-2 h-4 w-4" />
                        Add to Chrome
                      </a>
                    </Button>
                    <Button variant="outline" onClick={() => setStep("choose")}>
                      Back
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  )
}
