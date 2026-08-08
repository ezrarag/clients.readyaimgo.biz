"use client"

import React, { useState, useRef, useEffect } from "react"
import { AlertCircle, CheckCircle2, Camera, Loader2, Send, X, RefreshCw } from "lucide-react"

// Import Firebase config - when reused in other repos, swap these imports
import { getStorageInstance } from "@/lib/firebase/config"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"

interface FeedbackWidgetProps {
  projectId: string
  floating?: boolean
}

export default function FeedbackWidget({ projectId, floating = false }: FeedbackWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [step, setStep] = useState<"form" | "submitting" | "done">("form")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [text, setText] = useState("")
  const [screenshot, setScreenshot] = useState<string | null>(null) // Base64 data URL
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState("")
  const [interpretation, setInterpretation] = useState<any>(null)
  
  const widgetRef = useRef<HTMLDivElement>(null)

  // Dynamically load html2canvas to avoid build-time SSR issues
  const [html2canvas, setHtml2canvas] = useState<any>(null)
  useEffect(() => {
    import("html2canvas").then((mod) => {
      setHtml2canvas(() => mod.default)
    })
  }, [])

  const captureScreen = async () => {
    if (!html2canvas) {
      setError("Screen capture library is loading, please try again.")
      return
    }

    setCapturing(true)
    setError("")

    // Hide the widget so it doesn't appear in the screenshot
    if (widgetRef.current) {
      widgetRef.current.style.visibility = "hidden"
    }

    // Wait a brief moment for the DOM to hide the widget
    await new Promise((resolve) => setTimeout(resolve, 150))

    try {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
      })

      const dataUrl = canvas.toDataURL("image/png")
      setScreenshot(dataUrl)
    } catch (e) {
      console.error("Screenshot capture failed:", e)
      setError("Could not capture screenshot. You can still submit written feedback.")
    } finally {
      // Restore widget visibility
      if (widgetRef.current) {
        widgetRef.current.style.visibility = "visible"
      }
      setCapturing(false)
    }
  }

  const submit = async () => {
    if (!text.trim()) {
      setError("Please describe your feedback.")
      return
    }

    setStep("submitting")
    setError("")

    try {
      let screenshotUrl = ""

      // Upload screenshot to Firebase Storage if captured
      if (screenshot) {
        try {
          const storage = getStorageInstance()
          const feedbackId = Math.random().toString(36).substring(2, 15)
          const storageRef = ref(storage, `feedback-screenshots/${feedbackId}.png`)
          
          // Convert base64 dataUrl to blob
          const resBlob = await fetch(screenshot)
          const blob = await resBlob.blob()
          
          // Upload to storage
          await uploadBytes(storageRef, blob, { contentType: "image/png" })
          
          // Obtain public download URL
          screenshotUrl = await getDownloadURL(storageRef)
        } catch (uploadError) {
          console.error("Storage upload failed:", uploadError)
          // Don't block submission if upload fails, just log and continue
        }
      }

      // Submit feedback to API
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clientName: name || "Anonymous",
          clientEmail: email || null,
          rawText: text,
          screenshotUrl: screenshotUrl || null,
          pageUrl: typeof window !== "undefined" ? window.location.href : null,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || "Failed to submit feedback")
      }

      setInterpretation(data.interpretation)
      setStep("done")
    } catch (submitError: any) {
      setError(submitError.message || "Something went wrong. Please try again.")
      setStep("form")
    }
  }

  const resetForm = () => {
    setText("")
    setScreenshot(null)
    setError("")
    setInterpretation(null)
    setStep("form")
    if (floating) setIsOpen(false)
  }

  const widgetContent = (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {step === "form" && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Name</label>
              <input
                type="text"
                placeholder="Jane Smith"
                className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-white text-slate-900"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Email</label>
              <input
                type="email"
                placeholder="jane@example.com"
                className="w-full rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-white text-slate-900"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Feedback Note</label>
            <textarea
              placeholder="Describe the issue, request, or observation..."
              className="w-full rounded-lg border px-3 py-1.5 text-xs min-h-[90px] focus:outline-none focus:ring-1 focus:ring-primary bg-white text-slate-900"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            {screenshot ? (
              <div className="relative rounded-lg border overflow-hidden group max-h-[140px] bg-slate-50">
                <img
                  src={screenshot}
                  alt="Captured view"
                  className="w-full h-full object-contain max-h-[140px]"
                />
                <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    onClick={captureScreen}
                    disabled={capturing}
                    className="p-1.5 rounded-full bg-white text-slate-900 hover:bg-slate-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setScreenshot(null)}
                    className="p-1.5 rounded-full bg-white text-slate-900 hover:bg-slate-100"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={captureScreen}
                disabled={capturing}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed py-3 text-xs font-medium text-slate-600 hover:bg-slate-50 transition bg-white"
              >
                {capturing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    Capturing screen...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 text-slate-500" />
                    Snapshot Current View
                  </>
                )}
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            {floating && (
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 bg-white"
              >
                Cancel
              </button>
            )}
            <button
              onClick={submit}
              disabled={!text.trim() || capturing}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              Send Feedback
            </button>
          </div>
        </div>
      )}

      {step === "submitting" && (
        <div className="py-8 text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-xs font-medium text-slate-600">Uploading context and saving feedback...</p>
        </div>
      )}

      {step === "done" && (
        <div className="py-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="font-semibold text-slate-900">Feedback Saved!</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              Routed to the engineering pipeline.
            </p>
          </div>

          {interpretation && (
            <div className="rounded-xl border bg-slate-50 p-3.5 text-left text-xs space-y-2">
              <p className="font-semibold text-slate-800">AI Interpretation:</p>
              <p className="text-slate-600 leading-relaxed">{interpretation.summary}</p>
              <div className="flex gap-2.5 pt-1">
                <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-medium">
                  {interpretation.category}
                </span>
                <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded font-medium">
                  {interpretation.urgency} urgency
                </span>
              </div>
            </div>
          )}

          <button
            onClick={resetForm}
            className="w-full rounded-lg bg-slate-900 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Leave More Feedback
          </button>
        </div>
      )}
    </div>
  )

  if (floating) {
    return (
      <div ref={widgetRef} className="fixed bottom-5 right-5 z-[9999] font-sans">
        {isOpen ? (
          <div className="w-[320px] rounded-2xl border bg-white p-4 shadow-xl border-slate-200 animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className="flex items-center justify-between border-b pb-2 mb-3">
              <span className="text-xs font-bold text-slate-800">Submit In-Page Feedback</span>
              <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            {widgetContent}
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:bg-indigo-700 transition hover:scale-105"
          >
            <Camera className="h-4 w-4" />
            Feedback
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={widgetRef} className="w-full font-sans">
      {widgetContent}
    </div>
  )
}
