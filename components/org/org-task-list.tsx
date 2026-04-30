"use client"

import { useState, type FormEvent } from "react"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { CheckCircle2, Circle, Loader2, Plus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getDb } from "@/lib/firebase/config"
import {
  generateReadableId,
  type OrgFile,
  type OrgMember,
  type OrgTask,
} from "@/lib/organizations"

interface OrgTaskListProps {
  orgId: string
  file: OrgFile
  members: OrgMember[]
  canEdit: boolean
}

function priorityVariant(priority: OrgTask["priority"]) {
  if (priority === "high") {
    return "danger"
  }

  if (priority === "medium") {
    return "warning"
  }

  return "secondary"
}

export function OrgTaskList({ orgId, file, members, canEdit }: OrgTaskListProps) {
  const [taskText, setTaskText] = useState("")
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium")
  const [saving, setSaving] = useState(false)

  const updateFileTasks = async (nextTasks: OrgTask[]) => {
    await updateDoc(doc(getDb(), "organizations", orgId, "files", file.id), {
      extractedTasks: nextTasks,
    })
    await updateDoc(doc(getDb(), "organizations", orgId), {
      lastActivityAt: serverTimestamp(),
    })
  }

  const toggleTask = async (task: OrgTask) => {
    if (!canEdit) {
      return
    }

    await updateFileTasks(
      file.extractedTasks.map((item) =>
        item.id === task.id ? { ...item, done: !item.done } : item
      )
    )
  }

  const assignTask = async (task: OrgTask, assignedTo: string | null) => {
    if (!canEdit) {
      return
    }

    await updateFileTasks(
      file.extractedTasks.map((item) =>
        item.id === task.id ? { ...item, assignedTo } : item
      )
    )
  }

  const addManualTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!taskText.trim() || !canEdit) {
      return
    }

    setSaving(true)

    try {
      const nextTask: OrgTask = {
        id: generateReadableId("task"),
        text: taskText.trim(),
        done: false,
        assignedTo: null,
        dueDate: null,
        priority,
        source: "manual",
        createdAt: new Date().toISOString(),
      }

      await updateFileTasks([...file.extractedTasks, nextTask])
      setTaskText("")
      setPriority("medium")
    } finally {
      setSaving(false)
    }
  }

  if (file.extractedTasks.length === 0 && !canEdit) {
    return null
  }

  return (
    <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
      {file.extractedTasks.length > 0 ? (
        <div className="space-y-3">
          {file.extractedTasks.map((task) => (
            <div key={task.id} className="rounded-2xl border border-border/70 bg-slate-50/80 p-4">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => void toggleTask(task)}
                  className="mt-0.5 text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {task.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <Circle className="h-5 w-5" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${task.done ? "text-slate-400 line-through" : "text-slate-900"}`}>
                    {task.text}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {task.priority ? (
                      <Badge variant={priorityVariant(task.priority)}>
                        {task.priority}
                      </Badge>
                    ) : null}
                    {task.dueDate ? (
                      <Badge variant="secondary">Due {task.dueDate}</Badge>
                    ) : null}
                    <Badge variant={task.source === "ai_extracted" ? "accent" : "secondary"}>
                      {task.source === "ai_extracted" ? "AI extracted" : "Manual"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Assign to
                </label>
                <select
                  value={task.assignedTo ?? "unassigned"}
                  disabled={!canEdit}
                  onChange={(event) =>
                    void assignTask(
                      task,
                      event.target.value === "unassigned" ? null : event.target.value
                    )
                  }
                  className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
                >
                  <option value="unassigned">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.uid} value={member.uid}>
                      {member.name || member.email}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={addManualTask} className="grid gap-3 md:grid-cols-[1fr_150px_auto]">
          <Input
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            placeholder="Add task manually"
          />
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as "high" | "medium" | "low")}
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <Button type="submit" disabled={saving || !taskText.trim()}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Add
          </Button>
        </form>
      ) : null}
    </div>
  )
}
