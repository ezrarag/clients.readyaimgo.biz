import { type NextRequest, NextResponse } from "next/server"

import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin"
import { getBearerToken } from "@/lib/portal-auth"
import type { GitHubRepo } from "@/lib/workspaces"

export const dynamic = "force-dynamic"

interface GitHubApiRepo {
  id: number
  full_name: string
  html_url: string
  description: string | null
  language: string | null
  homepage: string | null
  stargazers_count: number
  private: boolean
  updated_at: string | null
}

type GitHubFetchResult =
  | { ok: true; repos: GitHubApiRepo[]; status: number; source: "org" | "user" | "authed-user" }
  | { ok: false; repos: []; status: number; body: string; source: "org" | "user" | "authed-user" }

async function isAdmin(uid: string) {
  if (process.env.NEXT_PUBLIC_ADMIN_UID && uid === process.env.NEXT_PUBLIC_ADMIN_UID) {
    return true
  }
  const snap = await getAdminDb().collection("users").doc(uid).get()
  const roles = snap.exists ? (snap.data() as Record<string, unknown>).roles : null
  return Array.isArray(roles) && roles.includes("beam-admin")
}

async function assertWorkspaceAccess(uid: string, workspaceId: string) {
  if (await isAdmin(uid)) return

  const memberSnap = await getAdminDb()
    .collection("workspaces")
    .doc(workspaceId)
    .collection("members")
    .doc(uid)
    .get()

  if (!memberSnap.exists) {
    throw Object.assign(new Error("Not a member of this workspace."), { status: 403 })
  }
}

async function resolveWorkspaceOwner(uid: string, workspaceId: string) {
  if (!workspaceId) return null
  await assertWorkspaceAccess(uid, workspaceId)
  const snap = await getAdminDb().collection("workspaces").doc(workspaceId).get()
  if (!snap.exists) return null
  const data = snap.data() as Record<string, unknown>
  return typeof data.githubOrg === "string" && data.githubOrg.trim()
    ? data.githubOrg.trim()
    : null
}

async function fetchGitHubRepos(
  url: string,
  source: GitHubFetchResult["source"],
  token?: string
): Promise<GitHubFetchResult> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(url, { headers, cache: "no-store" })
  if (!response.ok) {
    return {
      ok: false,
      repos: [],
      status: response.status,
      body: await response.text().catch(() => ""),
      source,
    }
  }
  return {
    ok: true,
    repos: (await response.json()) as GitHubApiRepo[],
    status: response.status,
    source,
  }
}

async function fetchOwnerRepos(
  owner: string,
  page: number,
  token?: string
): Promise<GitHubFetchResult> {
  const orgUrl = `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=updated&type=all`
  const orgResult = await fetchGitHubRepos(orgUrl, "org", token)
  if (orgResult.ok || orgResult.status !== 404) return orgResult

  const userUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100&page=${page}&sort=updated&type=owner`
  return fetchGitHubRepos(userUrl, "user", token)
}

async function fetchAuthenticatedUserRepos(
  token: string,
  page: number
): Promise<GitHubFetchResult> {
  return fetchGitHubRepos(
    `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator`,
    "authed-user",
    token
  )
}

function normalizeRepo(raw: GitHubApiRepo): GitHubRepo {
  return {
    id: raw.id,
    fullName: raw.full_name,
    url: raw.html_url,
    description: raw.description,
    language: raw.language,
    homepage: raw.homepage,
    stars: raw.stargazers_count,
    isPrivate: raw.private,
    updatedAt: raw.updated_at ?? new Date().toISOString(),
  }
}

export async function GET(request: NextRequest) {
  try {
    const idToken = getBearerToken(request)
    if (!idToken) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    }

    const decodedToken = await getAdminAuth().verifyIdToken(idToken)

    const githubToken =
      process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN || process.env.GITHUB_PAT
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim() || ""
    const requestedOwner = request.nextUrl.searchParams.get("owner")?.trim() || ""
    const workspaceOwner = workspaceId
      ? await resolveWorkspaceOwner(decodedToken.uid, workspaceId)
      : null
    const githubOwner = requestedOwner || workspaceOwner || process.env.GITHUB_ORG || ""

    if (!githubToken && !githubOwner) {
      return NextResponse.json({
        success: true,
        repos: [],
        meta: {
          configured: false,
          owner: null,
          warning: "GitHub token and GitHub owner are not configured.",
        },
      })
    }

    const q = (request.nextUrl.searchParams.get("q") ?? "").toLowerCase().trim()

    const results: GitHubFetchResult[] = []

    if (githubOwner) {
      results.push(
        await fetchOwnerRepos(githubOwner, 1, githubToken),
        await fetchOwnerRepos(githubOwner, 2, githubToken)
      )
    }

    if (githubToken) {
      results.push(await fetchAuthenticatedUserRepos(githubToken, 1))
    }

    const tokenRejected = results.some((result) => result.status === 401)
    if (tokenRejected && githubOwner) {
      results.push(
        await fetchOwnerRepos(githubOwner, 1),
        await fetchOwnerRepos(githubOwner, 2)
      )
    }

    const seen = new Set<number>()
    const merged: GitHubRepo[] = []

    for (const result of results) {
      if (!result.ok) continue
      for (const raw of result.repos) {
        if (seen.has(raw.id)) continue
        seen.add(raw.id)
        merged.push(normalizeRepo(raw))
      }
    }

    const repos = q
      ? merged.filter(
          (repo) =>
            repo.fullName.toLowerCase().includes(q) ||
            (repo.description ?? "").toLowerCase().includes(q) ||
            (repo.language ?? "").toLowerCase().includes(q)
        )
      : merged

    const warning =
      tokenRejected && repos.length > 0
        ? "GitHub token was rejected. Showing public repositories for the configured owner."
        : tokenRejected
          ? "GitHub token was rejected. Check GITHUB_TOKEN scope or replace it."
          : results.some((result) => !result.ok && result.status !== 404)
            ? "One or more GitHub repository sources could not be loaded."
            : null

    return NextResponse.json({
      success: true,
      repos,
      meta: {
        configured: Boolean(githubToken || githubOwner),
        owner: githubOwner || null,
        tokenEnv: process.env.GITHUB_TOKEN
          ? "GITHUB_TOKEN"
          : process.env.GITHUB_ACCESS_TOKEN
            ? "GITHUB_ACCESS_TOKEN"
            : process.env.GITHUB_PAT
              ? "GITHUB_PAT"
              : null,
        warning,
      },
    })
  } catch (error) {
    console.error("GitHub repos error:", error)
    const status = (error as Error & { status?: number }).status ?? 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load repos." },
      { status }
    )
  }
}
