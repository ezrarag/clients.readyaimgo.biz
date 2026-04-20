import type { ProjectStatus } from "@/lib/beam"
import { Badge } from "@/components/ui/badge"

const STATUS_VARIANTS: Record<ProjectStatus, "warning" | "accent" | "secondary" | "success"> = {
  scoping: "warning",
  active: "accent",
  review: "secondary",
  complete: "success",
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{status}</Badge>
}
