import { FieldValue, type Firestore } from "firebase-admin/firestore"

export type WorkspacePurgePlan = {
  dryRun: boolean
  workspaceId: string
  workspaceExists: boolean
  userUpdates: Array<{ uid: string; workspaceIds: string[] }>
  clientUpdates: Array<{ clientId: string; clearsWorkspaceId: boolean; removesWorkspaceId: boolean }>
  allowlistUpdates: Array<{ docId: string; workspaceIds: string[] }>
  projectDeletes: string[]
  taskDeletes: string[]
  subcollectionDeletes: Array<{ collectionPath: string; docIds: string[] }>
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : []
}

export async function buildWorkspacePurgePlan(db: Firestore, workspaceId: string, dryRun = true): Promise<WorkspacePurgePlan> {
  const id = workspaceId.trim()
  const workspaceRef = db.collection("workspaces").doc(id)
  const [workspaceSnap, usersSnap, clientsSnap, allowlistSnap, projectsSnap, tasksSnap, subcollections] = await Promise.all([
    workspaceRef.get(),
    db.collection("users").limit(1000).get(),
    db.collection("clients").limit(1000).get(),
    db.collection("ragAllowlist").limit(1000).get(),
    db.collection("projects").where("workspaceId", "==", id).limit(1000).get().catch(() => null),
    db.collection("projectTasks").where("workspaceId", "==", id).limit(1000).get().catch(() => null),
    workspaceRef.listCollections().catch(() => []),
  ])

  const userUpdates = usersSnap.docs
    .map((doc) => ({ uid: doc.id, workspaceIds: readStringArray((doc.data() as Record<string, unknown>).workspaceIds) }))
    .filter((entry) => entry.workspaceIds.includes(id))

  const clientUpdates = clientsSnap.docs.flatMap((doc) => {
    const data = doc.data() as Record<string, unknown>
    const workspaceIds = readStringArray(data.workspaceIds)
    const clearsWorkspaceId = readString(data.workspaceId) === id
    const removesWorkspaceId = workspaceIds.includes(id)
    return clearsWorkspaceId || removesWorkspaceId
      ? [{ clientId: doc.id, clearsWorkspaceId, removesWorkspaceId }]
      : []
  })

  const allowlistUpdates = allowlistSnap.docs
    .map((doc) => ({ docId: doc.id, workspaceIds: readStringArray((doc.data() as Record<string, unknown>).workspaceIds) }))
    .filter((entry) => entry.workspaceIds.includes(id))

  const subcollectionDeletes = await Promise.all(
    subcollections.map(async (collectionRef) => {
      const snapshot = await collectionRef.limit(1000).get()
      return {
        collectionPath: collectionRef.path,
        docIds: snapshot.docs.map((doc) => doc.id),
      }
    })
  )

  return {
    dryRun,
    workspaceId: id,
    workspaceExists: workspaceSnap.exists,
    userUpdates,
    clientUpdates,
    allowlistUpdates,
    projectDeletes: projectsSnap?.docs.map((doc) => doc.id) ?? [],
    taskDeletes: tasksSnap?.docs.map((doc) => doc.id) ?? [],
    subcollectionDeletes,
  }
}

async function commitInChunks(db: Firestore, writeFns: Array<(batch: FirebaseFirestore.WriteBatch) => void>) {
  const size = 450
  for (let i = 0; i < writeFns.length; i += size) {
    const batch = db.batch()
    for (const write of writeFns.slice(i, i + size)) write(batch)
    await batch.commit()
  }
}

export async function applyWorkspacePurgePlan(db: Firestore, plan: WorkspacePurgePlan): Promise<void> {
  const now = FieldValue.serverTimestamp()
  const writes: Array<(batch: FirebaseFirestore.WriteBatch) => void> = []

  for (const entry of plan.userUpdates) {
    writes.push((batch) =>
      batch.set(
        db.collection("users").doc(entry.uid),
        { workspaceIds: FieldValue.arrayRemove(plan.workspaceId), updatedAt: now },
        { merge: true }
      )
    )
  }

  for (const entry of plan.clientUpdates) {
    writes.push((batch) => {
      const update: Record<string, unknown> = { updatedAt: now }
      if (entry.clearsWorkspaceId) update.workspaceId = FieldValue.delete()
      if (entry.removesWorkspaceId) update.workspaceIds = FieldValue.arrayRemove(plan.workspaceId)
      batch.set(db.collection("clients").doc(entry.clientId), update, { merge: true })
    })
  }

  for (const entry of plan.allowlistUpdates) {
    writes.push((batch) =>
      batch.set(
        db.collection("ragAllowlist").doc(entry.docId),
        { workspaceIds: FieldValue.arrayRemove(plan.workspaceId), updatedAt: now },
        { merge: true }
      )
    )
  }

  for (const projectId of plan.projectDeletes) {
    writes.push((batch) => batch.delete(db.collection("projects").doc(projectId)))
  }

  for (const taskId of plan.taskDeletes) {
    writes.push((batch) => batch.delete(db.collection("projectTasks").doc(taskId)))
  }

  for (const subcollection of plan.subcollectionDeletes) {
    for (const docId of subcollection.docIds) {
      writes.push((batch) => batch.delete(db.doc(`${subcollection.collectionPath}/${docId}`)))
    }
  }

  writes.push((batch) => batch.delete(db.collection("workspaces").doc(plan.workspaceId)))
  await commitInChunks(db, writes)
}
