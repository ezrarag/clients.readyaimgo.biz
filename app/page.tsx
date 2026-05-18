"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  FolderKanban,
  Loader2,
  LogIn,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { BrandMark } from "@/components/site/brand"
import { PageBackdrop } from "@/components/site/page-backdrop"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const workspaceCards = [
  {
    icon: FolderKanban,
    title: "Projects",
    copy: "Review active work, requests, and shared project context.",
  },
  {
    icon: FileText,
    title: "Files",
    copy: "Keep documents, references, and project materials together.",
  },
  {
    icon: Clock3,
    title: "Activity",
    copy: "Track team notes, payments, and workspace updates.",
  },
]

export default function Home() {
  const { user, workspaceIds, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user) {
      router.push(workspaceIds.length > 0 ? "/dashboard" : "/claim-workspace")
    }
  }, [loading, router, user, workspaceIds.length])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (user) {
    return null
  }

  return (
    <div className="relative isolate min-h-screen overflow-hidden">
      <PageBackdrop />

      <header className="border-b border-white/70 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" asChild>
              <Link href="/signup">Create account</Link>
            </Button>
            <Button asChild>
              <Link href="/login">
                <LogIn className="mr-2 h-4 w-4" />
                Sign in
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-81px)] max-w-6xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.04fr_0.96fr] lg:px-8">
        <section className="animate-fade-up space-y-7">
          <Badge variant="secondary" className="bg-white/85">
            Client workspace
          </Badge>
          <div className="space-y-5">
            <h1 className="font-display text-balance text-5xl font-semibold leading-tight text-slate-950 sm:text-6xl">
              Your Readyaimgo client workspace.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">
              Sign in to manage projects, shared files, team notes, payments, and account details
              from one calm workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/login">
                Sign in
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/signup">Create account</Link>
            </Button>
          </div>
        </section>

        <section className="animate-fade-up">
          <Card className="bg-white/90">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Workspace Access</CardTitle>
                  <CardDescription>
                    A shared client area for active Readyaimgo relationships.
                  </CardDescription>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {workspaceCards.map((item) => (
                <div
                  key={item.title}
                  className="flex gap-4 rounded-2xl border border-border/70 bg-muted/35 p-4"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-white text-primary shadow-sm">
                    <item.icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.copy}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
