import { NextRequest, NextResponse } from "next/server"

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  html_url: string
  homepage: string | null
  language: string | null
  stargazers_count: number
  updated_at: string
  default_branch: string
}

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

export async function GET(request: NextRequest) {
  try {
    const githubToken = process.env.GITHUB_TOKEN
    const githubOrg = process.env.GITHUB_ORG || "readyaimgo"
    
    if (!githubToken) {
      return NextResponse.json(
        { error: "GitHub token not configured" },
        { status: 500 }
      )
    }

    // Fetch repositories from GitHub organization
    const response = await fetch(
      `https://api.github.com/orgs/${githubOrg}/repos?sort=updated&per_page=20`,
      {
        headers: {
          Authorization: `token ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error("GitHub API error:", error)
      return NextResponse.json(
        { error: "Failed to fetch repositories from GitHub" },
        { status: response.status }
      )
    }

    const repos: GitHubRepo[] = await response.json()

    // Transform GitHub repos to project format
    const projects: Project[] = repos
      .filter((repo) => !repo.name.includes("clients.readyaimgo.biz")) // Exclude this repo
      .map((repo) => {
        // Try to infer Vercel deployment URL from repo name
        // Format: https://{repo-name}.vercel.app or https://{repo-name}-{org}.vercel.app
        const deploymentUrl = repo.homepage || 
          `https://${repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.vercel.app`

        return {
          id: repo.id,
          name: repo.name,
          description: repo.description,
          url: repo.html_url,
          homepage: repo.homepage,
          language: repo.language,
          stars: repo.stargazers_count,
          updatedAt: repo.updated_at,
          deploymentUrl: deploymentUrl,
        }
      })

    return NextResponse.json({ projects })
  } catch (error: any) {
    console.error("Error fetching GitHub projects:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

