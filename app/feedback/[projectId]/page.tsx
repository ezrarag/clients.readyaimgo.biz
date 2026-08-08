"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  AlertCircle,
  CheckCircle2,
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
import FeedbackWidget from "@/components/FeedbackWidget"

type Step = "choose" | "widget" | "loom" | "done"

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

  const submitLoom = async () => {
    if (!loomUrl.includes("loom.com")) {
      setError("Please enter a valid Loom URL")
      return
    }

    setSubmitting(true)
    setError("")

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clientName: name || "Anonymous",
          clientEmail: email || null,
          loomUrl,
          rawText: text || undefined,
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
      : step === "widget"
        ? "Written & Screenshot"
        : step === "loom"
          ? "Loom feedback"
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

              {interpretation && (
                <div className="mx-auto max-w-xl rounded-[28px] border border-border/70 bg-muted/35 p-6 text-left">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                    Interpretation
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    {interpretation.summary}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="secondary">{interpretation.category}</Badge>
                  </div>
                  {interpretation.suggestedAction && (
                    <p className="mt-4 text-sm text-slate-500">
                      Suggested next step: {interpretation.suggestedAction}
                    </p>
                  )}
                </div>
              )}

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
                Submit screenshot annotations directly from the page or link a Loom video walkthrough for visual issues.
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>How this is structured</CardTitle>
                <CardDescription>
                  One intake form, two submission formats, one consistent visual system.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  "Choose the fastest format for your feedback.",
                  "Optionally snapshot your current screen view or link a Loom video.",
                  "Send the note directly to the engineering dashboard.",
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
            {step === "choose" && (
              <div className="grid gap-4">
                {[
                  {
                    icon: MessageSquareMore,
                    title: "Write a note & snapshot view",
                    copy: "Capture your screen view and describe what needs attention.",
                    accent: "bg-primary/12 text-primary",
                    nextStep: "widget" as Step,
                  },
                  {
                    icon: Video,
                    title: "Send a Loom video",
                    copy: "Best for showing context, walkthroughs, and visual issues.",
                    accent: "bg-sky-100 text-sky-700",
                    nextStep: "loom" as Step,
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
            )}

            {step === "widget" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <MessageSquareMore className="h-5 w-5" />
                    </span>
                    In-Page Feedback & Capture
                  </CardTitle>
                  <CardDescription>
                    Describe your observation and snapshot the current viewport.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FeedbackWidget projectId={projectId} floating={false} />
                  <div className="flex justify-start">
                    <Button variant="outline" onClick={() => setStep("choose")}>
                      Back to Choose
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === "loom" && (
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
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-700">Your name</label>
                      <Input
                        placeholder="Jane Smith"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-700">Email (optional)</label>
                      <Input
                        type="email"
                        placeholder="jane@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-700">Loom URL</label>
                      <Input
                        placeholder="https://www.loom.com/share/..."
                        value={loomUrl}
                        onChange={(e) => setLoomUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-slate-700">
                        Description (optional)
                      </label>
                      <Textarea
                        className="min-h-[100px]"
                        placeholder="What should the team focus on in the video?"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    <Button variant="outline" onClick={() => setStep("choose")}>
                      Back
                    </Button>
                    <Button
                      onClick={submitLoom}
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
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
