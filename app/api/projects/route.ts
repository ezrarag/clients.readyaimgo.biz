import { type NextRequest, NextResponse } from "next/server"
import { FieldValue } from "firebase-admin/firestore"

import type {
  BeamProject,
  BeamRole,
  BeamUserOption,
  ProjectStatus,
} from "@/lib/beam"
import {
  PROJECT_STATUSES,
  getEffectiveRoles,
  hasAnyRole,
  isProjectParticipant,
  normalizeBeamProjectDocument,
  normalizeBeamUserDocument,
  normalizeNgoSlug,
  normalizeProjectCohort,
  normalizeProjectDeliverables,
  normalizeProjectSourceNgo,
  slugifyClientId,
} from "@/lib/beam"
import { getAuthenticatedBeamUser } from "@/lib/firebase-admin"

const PROJECT_CREATOR_ROLES: BeamRole[] = ["rag-lead", "beam-admin"]
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseStringField(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} is required.`)
  }

  return value.trim()
}

function parseNonNegativeNumber(value: unknown, fieldName: string) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number.`)
  }

  return parsed
}

function parseRevenueShare(value: unknown, fieldName: string) {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${fieldName} must be between 0 and 1.`)
  }

  return parsed
}

function parseProjectStatus(value: unknown): ProjectStatus {
  if (typeof value === "string" && PROJECT_STATUSES.includes(value as ProjectStatus)) {
    return value as ProjectStatus
  }

  throw new Error("status must be one of scoping, active, review, or complete.")
}

function serializeUserOption(
  uid: string,
  value: Record<string, unknown> | null,
  sourceNgo: string
): BeamUserOption {
  const normalized = normalizeBeamUserDocument(uid, value, undefined, sourceNgo)

  return {
    uid,
    email: normalized.email,
    displayName: normalized.displayName,
    roles: getEffectiveRoles({
      uid,
      roles: normalized.roles,
    }),
    memberships: normalized.memberships,
  }
}

function canViewProject({
  project,
  uid,
  roles,
  memberships,
  ngoScope,
}: {
  project: BeamProject
  uid: string
  roles: BeamRole[]
  memberships: string[]
  ngoScope: string[]
}) {
  if (roles.includes("beam-admin")) {
    return true
  }

  if (roles.includes("ngo-coordinator")) {
    const allowedNgos = ngoScope.length > 0 ? ngoScope : memberships
    return allowedNgos.includes(project.sourceNgo)
  }

  if (roles.includes("rag-lead")) {
    return memberships.includes(project.sourceNgo) || project.ragProjectLead === uid
  }

  if (roles.includes("client-manager")) {
    return memberships.includes(project.sourceNgo)
  }

  return isProjectParticipant(project, uid)
}

function canUseUserForNgo(
  option: BeamUserOption,
  sourceNgo: string,
  requestorRoles: BeamRole[]
) {
  if (requestorRoles.includes("beam-admin")) {
    return true
  }

  return option.memberships.includes(sourceNgo)
}

export async function GET(request: NextRequest) {
  try {
    const context = await getAuthenticatedBeamUser(request)
    const url = new URL(request.url)
    const requestedProjectId = url.searchParams.get("id")?.trim() || ""
    const viewAsParticipant =
      url.searchParams.get("viewAs") === "participant" &&
      context.roles.includes("beam-admin")

    const viewerRoles = viewAsParticipant ? (["participant"] as BeamRole[]) : context.roles
    const projectsSnapshot = requestedProjectId
      ? await context.db.collection("projects").doc(requestedProjectId).get()
      : await context.db
          .collection("projects")
          .orderBy("createdAt", "desc")
          .get()
    const projects = (
      "docs" in projectsSnapshot
        ? projectsSnapshot.docs.map((snapshot) =>
            normalizeBeamProjectDocument(
              snapshot.id,
              snapshot.data() as Record<string, unknown>
            )
          )
        : projectsSnapshot.exists
          ? [
              normalizeBeamProjectDocument(
                projectsSnapshot.id,
                projectsSnapshot.data() as Record<string, unknown>
              ),
            ]
          : []
    )
      .filter((project) =>
        canViewProject({
          project,
          uid: context.decodedToken.uid,
          roles: viewerRoles,
          memberships: context.beamUser.memberships,
          ngoScope: context.beamUser.ngoScope,
        })
      )

    const usersSnapshot = await context.db.collection("users").get()
    const allUsers = usersSnapshot.docs.map((snapshot) =>
      serializeUserOption(
        snapshot.id,
        snapshot.exists ? (snapshot.data() as Record<string, unknown>) : null,
        context.sourceNgo
      )
    )

    const teamOptions = allUsers.filter((option) =>
      canUseUserForNgo(option, context.sourceNgo, context.roles)
    )
    const leadOptions = teamOptions.filter((option) =>
      hasAnyRole(option.roles, ["rag-lead", "beam-admin"])
    )

    const project = requestedProjectId ? projects[0] ?? null : null

    if (requestedProjectId && !project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 })
    }

    return NextResponse.json({
      permissions: {
        canCreateProjects: hasAnyRole(context.roles, PROJECT_CREATOR_ROLES),
        isBeamAdmin: context.roles.includes("beam-admin"),
        viewerRoles,
      },
      leadOptions,
      teamOptions,
      project,
      projects,
      sourceNgo: context.sourceNgo,
    })
  } catch (error) {
    console.error("Projects GET error:", error)
    const status = (error as Error & { status?: number }).status || 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load projects." },
      { status }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getAuthenticatedBeamUser(request)

    if (!hasAnyRole(context.roles, PROJECT_CREATOR_ROLES)) {
      return NextResponse.json(
        { error: "Only rag leads and BEAM admins can create projects." },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const clientName = parseStringField(body.clientName, "clientName")
    const clientPortalEmail = parseStringField(body.clientPortalEmail, "clientPortalEmail")
      .toLowerCase()
    const requestedSourceNgo = normalizeProjectSourceNgo(
      typeof body.sourceNgo === "string" ? body.sourceNgo : null
    )
    if (!requestedSourceNgo) {
      return NextResponse.json(
        { error: "sourceNgo must be one of forge, environment, grounds, orchestra, finance, or law." },
        { status: 400 }
      )
    }

    const sourceNgo = context.roles.includes("beam-admin")
      ? requestedSourceNgo
      : normalizeNgoSlug(context.sourceNgo)

    if (!EMAIL_PATTERN.test(clientPortalEmail)) {
      return NextResponse.json(
        { error: "clientPortalEmail must be a valid email address." },
        { status: 400 }
      )
    }

    if (
      !context.roles.includes("beam-admin") &&
      !context.beamUser.memberships.includes(sourceNgo)
    ) {
      return NextResponse.json(
        { error: "You cannot create projects outside your NGO memberships." },
        { status: 403 }
      )
    }

    const ragProjectLead =
      typeof body.ragProjectLead === "string" && body.ragProjectLead.trim()
        ? body.ragProjectLead.trim()
        : context.decodedToken.uid
    const beamParticipantLead =
      typeof body.beamParticipantLead === "string" && body.beamParticipantLead.trim()
        ? body.beamParticipantLead.trim()
        : ragProjectLead
    const ragRevenue = parseNonNegativeNumber(body.ragRevenue, "ragRevenue")
    const participantRevenueShare = parseRevenueShare(
      body.participantRevenueShare,
      "participantRevenueShare"
    )
    const status = parseProjectStatus(body.status)
    const deliverables = normalizeProjectDeliverables(body.deliverables)
    const cohort = normalizeProjectCohort(body.cohort)
    const sourceBusiness =
      typeof body.sourceBusiness === "string" && body.sourceBusiness.trim()
        ? body.sourceBusiness.trim()
        : "readyaimgo"
    const beamBookEntry = Boolean(body.beamBookEntry)
    const clientId = slugifyClientId(clientName)

    if (!clientId) {
      return NextResponse.json(
        { error: "clientName must produce a valid clientId slug." },
        { status: 400 }
      )
    }

    const ragLeadSnapshot = await context.db.collection("users").doc(ragProjectLead).get()
    if (!ragLeadSnapshot.exists) {
      return NextResponse.json(
        { error: "ragProjectLead must reference an existing BEAM user." },
        { status: 400 }
      )
    }

    const ragLeadOption = serializeUserOption(
      ragLeadSnapshot.id,
      ragLeadSnapshot.data() as Record<string, unknown>,
      sourceNgo
    )
    if (!hasAnyRole(ragLeadOption.roles, ["rag-lead", "beam-admin"])) {
      return NextResponse.json(
        { error: "ragProjectLead must have a rag-lead or beam-admin role." },
        { status: 400 }
      )
    }

    if (!canUseUserForNgo(ragLeadOption, sourceNgo, context.roles)) {
      return NextResponse.json(
        { error: "ragProjectLead must belong to the active NGO." },
        { status: 400 }
      )
    }

    const participantLeadSnapshot = await context.db
      .collection("users")
      .doc(beamParticipantLead)
      .get()
    if (!participantLeadSnapshot.exists) {
      return NextResponse.json(
        { error: "beamParticipantLead must reference an existing BEAM user." },
        { status: 400 }
      )
    }

    const participantLeadOption = serializeUserOption(
      participantLeadSnapshot.id,
      participantLeadSnapshot.data() as Record<string, unknown>,
      sourceNgo
    )
    if (!canUseUserForNgo(participantLeadOption, sourceNgo, context.roles)) {
      return NextResponse.json(
        { error: "beamParticipantLead must belong to the active NGO." },
        { status: 400 }
      )
    }

    let projectDocId = clientId
    let suffix = 1
    // Keep a human-readable document id while avoiding accidental overwrite.
    while ((await context.db.collection("projects").doc(projectDocId).get()).exists) {
      projectDocId = `${clientId}-${suffix}`
      suffix += 1
    }

    await context.db
      .collection("projects")
      .doc(projectDocId)
      .set({
        clientName,
        clientId,
        ragProjectLead,
        beamParticipantLead,
        sourceNgo,
        ragRevenue,
        participantRevenueShare,
        status: status as ProjectStatus,
        deliverables,
        cohort,
        clientPortalEmail,
        expansionPlan: {},
        sourceBusiness,
        beamBookEntry,
        createdAt: FieldValue.serverTimestamp(),
      })

    return NextResponse.json(
      {
        success: true,
        project: {
          id: projectDocId,
          clientName,
          clientId,
          ragProjectLead,
          beamParticipantLead,
          sourceNgo,
          ragRevenue,
          participantRevenueShare,
          status,
          deliverables,
          cohort,
          clientPortalEmail,
          expansionPlan: {},
          sourceBusiness,
          beamBookEntry,
          repository: null,
          createdAt: new Date().toISOString(),
        } satisfies BeamProject,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("Projects POST error:", error)
    const status = (error as Error & { status?: number }).status || 500
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create project." },
      { status }
    )
  }
}
