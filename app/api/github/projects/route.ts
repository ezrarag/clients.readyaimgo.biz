import { NextResponse } from "next/server"

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
  fullName: string
  description: string | null
  url: string
  homepage: string | null
  language: string | null
  stars: number
  updatedAt: string
  deploymentUrl: string | null
}

function buildGitHubReposUrl(account: string) {
  const params = new URLSearchParams({
    sort: "updated",
    per_page: "100",
    type: "owner",
  })

  return `https://api.github.com/users/${encodeURIComponent(account)}/repos?${params.toString()}`
}

async function fetchGitHubRepos(url: string, githubToken?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`
  }

  return fetch(url, {
    headers,
    cache: "no-store",
  })
}

export async function GET() {
  try {
    const githubToken = process.env.GITHUB_TOKEN?.trim()
    const githubAccount = process.env.GITHUB_ORG?.trim() || "ezrarag"
    const reposUrl = buildGitHubReposUrl(githubAccount)
    let warning: string | null = null

    let response = await fetchGitHubRepos(reposUrl, githubToken)

    if (githubToken && response.status === 401) {
      console.warn("GitHub token rejected; retrying public repo listing")
      response = await fetchGitHubRepos(reposUrl)
      warning = "GitHub token rejected. Showing public repositories only."
    }

    if (!response.ok) {
      const error = await response.text()
      console.error("GitHub API error:", response.status, error)

      const message =
        response.status === 404
          ? `GitHub account "${githubAccount}" was not found`
          : "Failed to fetch repositories from GitHub"

      return NextResponse.json(
        { error: message },
        { status: response.status }
      )
    }

    const repos: GitHubRepo[] = await response.json()

    const projects: Project[] = repos
      .filter((repo) => !repo.name.includes("clients.readyaimgo.biz"))
      .map((repo) => {
        const deploymentUrl =
          repo.homepage ||
          `https://${repo.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}.vercel.app`

        return {
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          description: repo.description,
          url: repo.html_url,
          homepage: repo.homepage,
          language: repo.language,
          stars: repo.stargazers_count,
          updatedAt: repo.updated_at,
          deploymentUrl,
        }
      })

    return NextResponse.json({ projects, warning })
  } catch (error: any) {
    console.error("Error fetching GitHub projects:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
