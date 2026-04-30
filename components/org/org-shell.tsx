"use client"

import type { ReactNode } from "react"
import { LogOut } from "lucide-react"

import { AppShell } from "@/components/site/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { signOut } from "@/lib/firebase/auth"
import type { Organization, OrgMember } from "@/lib/organizations"

type OrgNavKey = "dashboard" | "projects" | "files" | "tasks" | "settings" | "members"

interface OrgShellProps {
  org: Organization
  member: OrgMember
  active: OrgNavKey
  title: string
  description: string
  intro?: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function OrgShell({
  org,
  member,
  active,
  title,
  description,
  intro,
  actions,
  children,
}: OrgShellProps) {
  const baseHref = `/org/${org.id}`

  const handleSignOut = async () => {
    await signOut()
    window.location.href = "/login"
  }

  return (
    <AppShell
      eyebrow={org.name}
      title={title}
      description={description}
      nav={[
        { href: `${baseHref}/dashboard`, label: "Dashboard", active: active === "dashboard" },
        { href: `${baseHref}/projects`, label: "Projects", active: active === "projects" },
        { href: `${baseHref}/files`, label: "Files", active: active === "files" },
        { href: `${baseHref}/tasks`, label: "Tasks", active: active === "tasks" },
        { href: `${baseHref}/settings`, label: "Settings", active: active === "settings" || active === "members" },
      ]}
      actions={
        <>
          <Badge variant="secondary">{member.role}</Badge>
          {actions}
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </>
      }
      intro={intro}
    >
      {children}
    </AppShell>
  )
}
