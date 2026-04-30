import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  type Firestore,
} from "firebase/firestore"

import {
  normalizeOrganization,
  normalizeOrgFile,
  normalizeOrgInvite,
  normalizeOrgMember,
  normalizeOrgProject,
  type Organization,
  type OrgFile,
  type OrgInvite,
  type OrgMember,
  type OrgProject,
} from "@/lib/organizations"

export interface OrgAccessContext {
  org: Organization
  member: OrgMember
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

export async function loadOrgAccessContext({
  firestoreDb,
  orgId,
  uid,
}: {
  firestoreDb: Firestore
  orgId: string
  uid: string
}): Promise<OrgAccessContext | null> {
  const [orgSnap, memberSnap] = await Promise.all([
    getDoc(doc(firestoreDb, "organizations", orgId)),
    getDoc(doc(firestoreDb, "organizations", orgId, "members", uid)),
  ])

  if (!orgSnap.exists() || !memberSnap.exists()) {
    return null
  }

  return {
    org: normalizeOrganization(orgSnap.id, asRecord(orgSnap.data())),
    member: normalizeOrgMember(memberSnap.id, asRecord(memberSnap.data())),
  }
}

export async function listOrgMembers(
  firestoreDb: Firestore,
  orgId: string
): Promise<OrgMember[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, "organizations", orgId, "members"), orderBy("joinedAt", "asc"))
  )

  return snapshot.docs.map((memberDoc) =>
    normalizeOrgMember(memberDoc.id, asRecord(memberDoc.data()))
  )
}

export async function listOrgProjects(
  firestoreDb: Firestore,
  orgId: string
): Promise<OrgProject[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, "organizations", orgId, "projects"), orderBy("createdAt", "desc"))
  )

  return snapshot.docs.map((projectDoc) =>
    normalizeOrgProject(projectDoc.id, asRecord(projectDoc.data()))
  )
}

export async function listOrgFiles(
  firestoreDb: Firestore,
  orgId: string
): Promise<OrgFile[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, "organizations", orgId, "files"), orderBy("uploadedAt", "desc"))
  )

  return snapshot.docs.map((fileDoc) =>
    normalizeOrgFile(fileDoc.id, asRecord(fileDoc.data()))
  )
}

export async function listOrgInvites(
  firestoreDb: Firestore,
  orgId: string
): Promise<OrgInvite[]> {
  const snapshot = await getDocs(
    query(collection(firestoreDb, "organizations", orgId, "invites"), orderBy("invitedAt", "desc"))
  )

  return snapshot.docs.map((inviteDoc) =>
    normalizeOrgInvite(inviteDoc.id, asRecord(inviteDoc.data()))
  )
}

export async function loadOrgProject({
  firestoreDb,
  orgId,
  projectId,
}: {
  firestoreDb: Firestore
  orgId: string
  projectId: string
}) {
  const projectSnap = await getDoc(
    doc(firestoreDb, "organizations", orgId, "projects", projectId)
  )

  if (!projectSnap.exists()) {
    return null
  }

  return normalizeOrgProject(projectSnap.id, asRecord(projectSnap.data()))
}
