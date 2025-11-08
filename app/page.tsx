"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth/AuthProvider"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Menu, Home as HomeIcon, ExternalLink, Github, Star } from "lucide-react"
import Link from "next/link"

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
  const [showVideo, setShowVideo] = useState(false)

  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard")
    }
  }, [user, loading, router])

  const loadProjects = async () => {
    setProjectsLoading(true)
    try {
      const res = await fetch("/api/github/projects")
      if (res.ok) {
        const data = await res.json()
        setProjects(data.projects || [])
      }
    } catch (error) {
      console.error("Error loading projects:", error)
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

  const handleMenuClick = () => {
    setShowVideo(true)
  }

  const handleHomeClick = () => {
    setShowVideo(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (user) {
    return null // Will redirect to dashboard
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Video Background - Only visible when showVideo is true, behind CTA */}
      {showVideo && (
        <div className="fixed inset-0 z-0 pointer-events-none">
          <video
            key="logo-video"
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          >
            <source
              src="https://firebasestorage.googleapis.com/v0/b/readyaimgo-clients-temp.firebasestorage.app/o/readyaimgo%2Freadyaimgo.biz-logospin.mp4?alt=media&token=7414473f-7dbd-4f53-8908-9a2fbf0804ed"
              type="video/mp4"
            />
          </video>
          <div className="absolute inset-0 bg-black/20" />
        </div>
      )}

      {/* Navigation */}
      <nav className="relative z-10 bg-white/80 backdrop-blur-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <button
              onClick={handleHomeClick}
              className="flex items-center gap-2 text-xl font-bold bg-gradient-readyaimgo bg-clip-text text-transparent hover:opacity-80 transition-opacity"
            >
              <HomeIcon className="h-5 w-5" />
              Readyaimgo
            </button>
            <button
              onClick={handleMenuClick}
              className="p-2 rounded-md hover:bg-gray-100 transition-colors"
              aria-label="Menu"
            >
              <Menu className="h-6 w-6" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
        <div className="text-center max-w-4xl">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-readyaimgo bg-clip-text text-transparent">
            Readyaimgo Client Hub
          </h1>
          <p className="text-xl md:text-2xl text-gray-600 mb-8">
            Manage your subscription, BEAM Coin balance, and Housing Wallet
          </p>

          {/* CTA Section */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              size="lg"
              onClick={() => router.push("/signup")}
              className="text-lg px-8 py-6"
            >
              Get Started
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={handleViewProjects}
              className="text-lg px-8 py-6"
            >
              View Projects
            </Button>
            <Button
              size="lg"
              variant="ghost"
              onClick={() => router.push("/login")}
              className="text-lg px-8 py-6"
            >
              Sign In
            </Button>
          </div>
        </div>
      </div>

      {/* Projects Dialog */}
      <Dialog open={showProjects} onOpenChange={setShowProjects}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Our Projects</DialogTitle>
            <DialogDescription>
              Explore our GitHub repositories and live deployments
            </DialogDescription>
          </DialogHeader>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : projects.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="border rounded-lg p-4 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      <Github className="h-4 w-4" />
                      {project.name}
                    </h3>
                    {project.stars > 0 && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                        {project.stars}
                      </div>
                    )}
                  </div>
                  {project.description && (
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                  {project.language && (
                    <span className="inline-block text-xs px-2 py-1 bg-gray-100 rounded mb-3">
                      {project.language}
                    </span>
                  )}
                  <div className="flex gap-2 mt-4">
                    {project.deploymentUrl && (
                      <a
                        href={project.deploymentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1"
                      >
                        <Button variant="default" size="sm" className="w-full">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          View Live
                        </Button>
                      </a>
                    )}
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1"
                    >
                      <Button variant="outline" size="sm" className="w-full">
                        <Github className="h-4 w-4 mr-2" />
                        GitHub
                      </Button>
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <p>No projects found. Please configure GitHub API credentials.</p>
              <p className="text-sm mt-2">
                Add GITHUB_TOKEN and GITHUB_ORG to your environment variables.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
