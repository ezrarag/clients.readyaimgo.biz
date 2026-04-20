"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Coins,
  ExternalLink,
  Github,
  LayoutPanelLeft,
  Loader2,
  MessageSquareMore,
  ShieldCheck,
  Star,
  Wallet,
} from "lucide-react"

import { useAuth } from "@/components/auth/AuthProvider"
import { BrandMark } from "@/components/site/brand"
import { PageBackdrop } from "@/components/site/page-backdrop"
import { SectionHeading } from "@/components/site/section-heading"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface Project {
  id: number
  name: string
  description: string | null
  url: string
  homepage: string | null
  language: string | null
  stars: number
  updatedAt: string
  deploymentUrl: string | null
}

export default function Home() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [showProjects, setShowProjects] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsWarning, setProjectsWarning] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard")
    }
  }, [loading, router, user])

  const loadProjects = async () => {
    setProjectsLoading(true)
    setProjectsError(null)
    setProjectsWarning(null)
    try {
      const res = await fetch("/api/github/projects")
      const data = await res.json().catch(() => null)

      if (res.ok) {
        setProjects(data?.projects || [])
        setProjectsWarning(data?.warning || null)
      } else {
        setProjects([])
        setProjectsError(data?.error || "Failed to load GitHub projects.")
      }
    } catch (error) {
      console.error("Error loading projects:", error)
      setProjects([])
      setProjectsError("Failed to load GitHub projects.")
    } finally {
      setProjectsLoading(false)
    }
  }

  const handleViewProjects = () => {
    setShowProjects(true)
    if (projects.length === 0) {
      loadProjects()
    }
  }

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
    <div className="relative isolate overflow-hidden">
      <PageBackdrop />

      <header className="sticky top-0 z-20 border-b border-white/70 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <BrandMark />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" onClick={handleViewProjects}>
              View Projects
            </Button>
            <Button variant="outline" asChild>
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="animate-fade-up space-y-7">
            <Badge variant="secondary" className="bg-white/85">
              One shared system for billing, credits, and client communication
            </Badge>
            <div className="space-y-5">
              <h1 className="font-display text-balance text-5xl font-semibold leading-[0.95] text-slate-950 sm:text-6xl lg:text-7xl">
                Simple, elegant client operations without the visual noise.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                Readyaimgo Client Hub gives every client-facing page the same design language:
                clear hierarchy, calm surfaces, stronger calls to action, and consistent
                components from the landing page through the dashboard.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/signup">
                  Open Your Workspace
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" onClick={handleViewProjects}>
                Explore Current Projects
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                {
                  label: "Subscriptions",
                  value: "Stripe-ready",
                  detail: "Current plan status and renewal clarity.",
                },
                {
                  label: "Community Credits",
                  value: "BEAM-first",
                  detail: "Balances, activity, and housing wallet value.",
                },
                {
                  label: "Feedback",
                  value: "Fast intake",
                  detail: "Text, video, and extension-based reporting.",
                },
              ].map((item) => (
                <Card key={item.label} className="bg-white/80">
                  <CardContent className="space-y-2 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
                      {item.label}
                    </p>
                    <p className="text-xl font-semibold text-slate-950">{item.value}</p>
                    <p className="text-sm leading-6 text-slate-600">{item.detail}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="animate-fade-up grid gap-4 lg:pl-8">
            <Card className="shadow-glow">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <LayoutPanelLeft className="h-5 w-5" />
                  </span>
                  Consistent page scaffolding
                </CardTitle>
                <CardDescription>
                  Every page now shares the same header rhythm, card language, and spacing system.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {[
                  "Unified shells for marketing, auth, and app pages",
                  "Shared cards, inputs, dialogs, badges, and tabs",
                  "Warm neutral palette with one strong accent",
                  "Clear CTA hierarchy across all routes",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-3 text-sm text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="bg-slate-950 text-white">
                <CardContent className="space-y-4 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
                    <Coins className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm uppercase tracking-[0.28em] text-white/60">
                      Dashboard cadence
                    </p>
                    <p className="text-3xl font-semibold">1 clean source</p>
                    <p className="text-sm leading-6 text-white/70">
                      Subscriptions, wallet status, and transaction history inside one polished
                      workspace.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/90">
                <CardContent className="space-y-4 p-6">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-slate-800">
                    <MessageSquareMore className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm uppercase tracking-[0.28em] text-slate-500">
                      Feedback loop
                    </p>
                    <p className="text-3xl font-semibold text-slate-950">3 input paths</p>
                    <p className="text-sm leading-6 text-slate-600">
                      Notes, Loom links, and browser-based annotation all use the same component
                      vocabulary.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="mt-20 space-y-8">
          <SectionHeading
            eyebrow="Design direction"
            title="A conventional approach that still feels considered."
            description="The visual strategy is a restrained SaaS layout with better taste: softer backgrounds, stronger typography, generous spacing, and components that feel related instead of improvised."
          />

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: "Clear hierarchy",
                copy: "Large display headings, compact labels, and a single dominant action keep decision-making obvious.",
              },
              {
                icon: Wallet,
                title: "Reusable surfaces",
                copy: "Every key action lives inside the same rounded card system, which makes auth, billing, feedback, and reporting feel connected.",
              },
              {
                icon: MessageSquareMore,
                title: "Consistent interactions",
                copy: "Inputs, tabs, dialogs, and badges share the same radius, border, and motion language across the entire site.",
              },
            ].map((item) => (
              <Card key={item.title} className="h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                      <item.icon className="h-5 w-5" />
                    </span>
                    {item.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-slate-600">{item.copy}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-20">
          <Card className="overflow-hidden bg-slate-950 text-white">
            <CardContent className="grid gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-[0.32em] text-white/55">
                  Shared component set
                </p>
                <h2 className="text-balance text-4xl font-semibold leading-tight">
                  Landing, auth, dashboard, admin, settings, and feedback now follow one system.
                </h2>
                <p className="max-w-3xl text-base leading-7 text-white/72">
                  That means fewer one-off layouts, cleaner maintenance, and a product that feels
                  trustworthy from the first screen to the last.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" asChild>
                  <Link href="/signup">Create Account</Link>
                </Button>
                <Button variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10" asChild>
                  <Link href="/login">Sign In</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>

      <Dialog open={showProjects} onOpenChange={setShowProjects}>
        <DialogContent className="max-w-5xl grid-rows-[auto,minmax(0,1fr)] overflow-hidden gap-0 p-0">
          <DialogHeader className="border-b border-border/70 px-6 py-6 pr-14 sm:px-7 sm:py-7">
            <DialogTitle className="pr-12">Selected Readyaimgo Projects</DialogTitle>
            <DialogDescription className="pr-12">
              Reference implementations and live properties connected to the client platform.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-6 py-6 sm:px-7 sm:py-7">
            {projectsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : projects.length > 0 ? (
              <div className="space-y-4">
                {projectsWarning ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {projectsWarning}
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {projects.map((project) => (
                    <Card key={project.id} className="h-full">
                      <CardHeader className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-2">
                            <CardTitle className="flex items-center gap-2 text-2xl">
                              <Github className="h-5 w-5 text-slate-500" />
                              {project.name}
                            </CardTitle>
                            {project.description ? (
                              <CardDescription>{project.description}</CardDescription>
                            ) : null}
                          </div>
                          {project.stars > 0 ? (
                            <Badge variant="secondary" className="shrink-0">
                              <Star className="mr-1 h-3.5 w-3.5" />
                              {project.stars}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {project.language ? <Badge>{project.language}</Badge> : null}
                          <Badge variant="secondary">
                            Updated {new Date(project.updatedAt).toLocaleDateString()}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="mt-auto flex flex-wrap gap-3">
                        {project.deploymentUrl ? (
                          <Button asChild>
                            <a href={project.deploymentUrl} rel="noreferrer" target="_blank">
                              <ExternalLink className="mr-2 h-4 w-4" />
                              View Live
                            </a>
                          </Button>
                        ) : null}
                        <Button variant="outline" asChild>
                          <a href={project.url} rel="noreferrer" target="_blank">
                            <Github className="mr-2 h-4 w-4" />
                            Open GitHub
                          </a>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ) : (
              <Card>
                <CardContent className="space-y-2 py-12 text-center">
                  <p className="text-lg font-semibold text-slate-950">No projects available yet.</p>
                  <p className="text-sm text-slate-600">
                    {projectsError || "Configure `GITHUB_TOKEN` and `GITHUB_ORG` to populate this list."}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
