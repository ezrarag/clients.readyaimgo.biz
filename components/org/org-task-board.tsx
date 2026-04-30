"use client"

import { useMemo, useState } from "react"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { CheckCircle2, Circle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { getDb } from "@/lib/firebase/config"
import type { OrgFile, OrgMember, OrgProject, OrgTask } from "@/lib/organizations"

type TaskFilter = "all" | "incomplete" | "complete" | "assigned-to-me" | "high"
type TaskSort = "due-date" | "priority" | "file"

interface AggregatedTask {
  task: OrgTask
  sourceType: "file" | "project"
  sourceId: string
  sourceName: string
  projectId: string | null
  projectName: string | null
}

interface OrgTaskBoardProps {
  orgId: string
  currentUid: string
  projects: OrgProject[]
  files: OrgFile[]
  members: OrgMember[]
  projectId?: string
  canEdit: boolean
  showProjectBadge?: boolean
}

function priorityWeight(priority: OrgTask["priority"]) {
  if (priority === "high") return 0
  if (priority === "medium") return 1
  if (priority === "low") return 2
  return 3
}

function priorityVariant(priority: OrgTask["priority"]) {
  if (priority === "high") return "danger"
  if (priority === "medium") return "warning"
  return "secondary"
}

function buildTasks({
  projects,
  files,
  projectId,
}: {
  projects: OrgProject[]
  files: OrgFile[]
  projectId?: string
}) {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const tasks: AggregatedTask[] = []

  projects
    .filter((project) => !projectId || project.id === projectId)
    .forEach((project) => {
      project.tasks.forEach((task) => {
        tasks.push({
          task,
          sourceType: "project",
          sourceId: project.id,
          sourceName: "Manual project task",
          projectId: project.id,
          projectName: project.name,
        })
      })
    })

  files
    .filter((file) => !projectId || file.projectId === projectId)
    .forEach((file) => {
      const project = file.projectId ? projectById.get(file.projectId) ?? null : null

      file.extractedTasks.forEach((task) => {
        tasks.push({
          task,
          sourceType: "file",
          sourceId: file.id,
          sourceName: file.name,
          projectId: file.projectId,
          projectName: project?.name ?? null,
        })
      })
    })

  return tasks
}

export function OrgTaskBoard({
  orgId,
  currentUid,
  projects,
  files,
  members,
  projectId,
  canEdit,
  showProjectBadge = false,
}: OrgTaskBoardProps) {
  const [filter, setFilter] = useState<TaskFilter>("all")
  const [sort, setSort] = useState<TaskSort>("due-date")

  const allTasks = useMemo(
    () => buildTasks({ projects, files, projectId }),
    [files, projectId, projects]
  )

  const visibleTasks = useMemo(() => {
    const filtered = allTasks.filter(({ task }) => {
      if (filter === "incomplete") return !task.done
      if (filter === "complete") return task.done
      if (filter === "assigned-to-me") return task.assignedTo === currentUid
      if (filter === "high") return task.priority === "high"
      return true
    })

    return [...filtered].sort((first, second) => {
      if (sort === "priority") {
        return priorityWeight(first.task.priority) - priorityWeight(second.task.priority)
      }

      if (sort === "file") {
        return first.sourceName.localeCompare(second.sourceName)
      }

      const firstTime = first.task.dueDate
        ? new Date(`${first.task.dueDate}T00:00:00`).getTime()
        : Number.POSITIVE_INFINITY
      const secondTime = second.task.dueDate
        ? new Date(`${second.task.dueDate}T00:00:00`).getTime()
        : Number.POSITIVE_INFINITY

      return firstTime - secondTime
    })
  }, [allTasks, currentUid, filter, sort])

  const completedCount = allTasks.filter(({ task }) => task.done).length
  const progressPct = allTasks.length
    ? Math.round((completedCount / allTasks.length) * 100)
    : 0

  const updateTask = async (item: AggregatedTask, nextTask: OrgTask) => {
    if (!canEdit) return

    if (item.sourceType === "file") {
      const sourceFile = files.find((file) => file.id === item.sourceId)
      if (!sourceFile) return

      await updateDoc(doc(getDb(), "organizations", orgId, "files", sourceFile.id), {
        extractedTasks: sourceFile.extractedTasks.map((task) =>
          task.id === item.task.id ? nextTask : task
        ),
      })
    } else {
      const sourceProject = projects.find((project) => project.id === item.sourceId)
      if (!sourceProject) return

      await updateDoc(doc(getDb(), "organizations", orgId, "projects", sourceProject.id), {
        tasks: sourceProject.tasks.map((task) =>
          task.id === item.task.id ? nextTask : task
        ),
      })
    }

    await updateDoc(doc(getDb(), "organizations", orgId), {
      lastActivityAt: serverTimestamp(),
    })
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] border border-border/70 bg-white/80 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Task progress</p>
            <p className="mt-1 text-sm text-slate-500">
              {completedCount} of {allTasks.length} complete
            </p>
          </div>
          <p className="text-2xl font-semibold text-slate-950">{progressPct}%</p>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {[
            ["all", "All"],
            ["incomplete", "Incomplete"],
            ["complete", "Complete"],
            ["assigned-to-me", "My tasks"],
            ["high", "High priority"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value as TaskFilter)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                filter === value
                  ? "bg-slate-950 text-white"
                  : "bg-white/80 text-slate-600 hover:text-slate-950"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as TaskSort)}
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 lg:w-48"
        >
          <option value="due-date">By due date</option>
          <option value="priority">By priority</option>
          <option value="file">By file</option>
        </select>
      </div>

      {visibleTasks.length > 0 ? (
        <div className="space-y-3">
          {visibleTasks.map((item) => {
            const assignee = item.task.assignedTo
              ? members.find((member) => member.uid === item.task.assignedTo)
              : null

            return (
              <div
                key={`${item.sourceType}-${item.sourceId}-${item.task.id}`}
                className="rounded-2xl border border-border/70 bg-white/85 p-4"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => void updateTask(item, { ...item.task, done: !item.task.done })}
                    className="mt-0.5 text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {item.task.done ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    ) : (
                      <Circle className="h-5 w-5" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${item.task.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                      {item.task.text}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{item.sourceName}</Badge>
                      {showProjectBadge && item.projectName ? (
                        <Badge variant="accent">{item.projectName}</Badge>
                      ) : null}
                      {item.task.priority ? (
                        <Badge variant={priorityVariant(item.task.priority)}>
                          {item.task.priority}
                        </Badge>
                      ) : null}
                      {item.task.dueDate ? (
                        <Badge variant="secondary">Due {item.task.dueDate}</Badge>
                      ) : null}
                      <Badge variant={assignee ? "success" : "secondary"}>
                        {assignee?.name || assignee?.email || "Unassigned"}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-slate-500">No tasks match this view.</p>
      )}
    </div>
  )
}
