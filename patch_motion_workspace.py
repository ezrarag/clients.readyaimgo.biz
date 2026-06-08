#!/usr/bin/env python3
"""
Motion Network workspace scaffold patch.

Run from the project root:
  python3 patch_motion_workspace.py

This script expands the `assetType === "transportation"` card block in
app/workspace/[workspaceId]/page.tsx from the current bare fleet-ID list
into a full Motion Network card with:
  - Credit balance strip (X / 4 credits used)
  - 60-day launch countdown (derived from subscriptionStartDate or createdAt)
  - Route zone + transit type display
  - Assigned driver + vehicle row
  - Fleet status badge

It also renames the ASSET_PROJECT_TYPES label from "Transportation Asset"
to "Motion Network" and adds the `subscriptionStartDate` field to the
WorkspaceProject interface.

IMPORTANT: Run patch_workspace_page.py FIRST (the Nexus rename patch) before
running this script.
"""

import re

path = "app/workspace/[workspaceId]/page.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

original = content

# ── Change 1: Rename "Transportation Asset" → "Motion Network" ───────────────
content = content.replace(
    '{ value: "transportation", label: "Transportation Asset" },',
    '{ value: "transportation", label: "Motion Network" },'
)

# ── Change 2: Add motionCreditsUsed + subscriptionStartDate to WorkspaceProject ─
# Insert after the `mileageTotal?` field
OLD_FIELD = "  mileageTotal?: number"
NEW_FIELD = """  mileageTotal?: number
  motionCreditsUsed?: number
  motionCreditsTotal?: number
  assignedDriverName?: string
  assignedVehicle?: string
  transitZone?: string
  transitType?: string
  subscriptionStartDate?: string"""

content = content.replace(OLD_FIELD, NEW_FIELD, 1)

# ── Change 3: Expand the transportation card block ────────────────────────────
OLD_TRANSPORT_BLOCK = """                        {assetType === "transportation" ? (
                          <div className="mt-4 rounded-2xl border border-border bg-slate-50/70 p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                              Fleet Tracking Log
                            </p>
                            <div className="mt-3 grid gap-2">
                              {fleetIdsForProject(project).map((fleetId, index) => (
                                <div key={fleetId} className="rounded-xl bg-white px-3 py-2">
                                  <p className="text-xs font-semibold text-slate-800">{fleetId}</p>
                                  <p className="mt-1 text-xs text-slate-500">
                                    Mileage tracked: {((project.mileageTotal ?? 0) + index * 125).toLocaleString("en-US")} mi
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}"""

NEW_TRANSPORT_BLOCK = """                        {assetType === "transportation" ? (
                          <div className="mt-4 space-y-3">
                            {/* ── Motion Credits Strip ── */}
                            <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">
                                Motion Network — Credit Balance
                              </p>
                              <div className="mt-2 flex items-center gap-3">
                                {Array.from({ length: project.motionCreditsTotal ?? 4 }).map((_, i) => (
                                  <div
                                    key={i}
                                    className={[
                                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                                      i < (project.motionCreditsUsed ?? 0)
                                        ? "bg-blue-200 text-blue-400 line-through"
                                        : "bg-blue-600 text-white",
                                    ].join(" ")}
                                  >
                                    {i + 1}
                                  </div>
                                ))}
                                <span className="ml-2 text-xs text-slate-500">
                                  {(project.motionCreditsTotal ?? 4) - (project.motionCreditsUsed ?? 0)} credit{(project.motionCreditsTotal ?? 4) - (project.motionCreditsUsed ?? 0) !== 1 ? "s" : ""} remaining
                                </span>
                              </div>
                              <p className="mt-2 text-[11px] text-blue-500">
                                1 credit = 1 round-trip ride or delivery run up to 15 mi
                              </p>
                            </div>

                            {/* ── 60-Day Launch Countdown ── */}
                            {(() => {
                              const start = project.subscriptionStartDate ?? project.createdAt
                              if (!start) return null
                              const launchDate = new Date(new Date(start).getTime() + 60 * 24 * 60 * 60 * 1000)
                              const now = new Date()
                              const daysLeft = Math.ceil((launchDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                              const launched = daysLeft <= 0
                              return (
                                <div className={["rounded-2xl border p-3", launched ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"].join(" ")}>
                                  <p className={["text-[11px] font-semibold uppercase tracking-[0.16em]", launched ? "text-emerald-600" : "text-amber-600"].join(" ")}>
                                    {launched ? "✓ Network Active" : `Day 60 Launch — ${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining`}
                                  </p>
                                  <p className="mt-1 text-[11px] text-slate-500">
                                    {launched
                                      ? "Credits active · Routes bookable · Fleet dispatched"
                                      : "Capital building · Route intake in progress · Fleet acquisition pending"}
                                  </p>
                                </div>
                              )
                            })()}

                            {/* ── Route & Fleet Details ── */}
                            <div className="grid gap-2 rounded-2xl border border-border bg-slate-50/70 p-3 text-xs">
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Zone</span>
                                <span className="text-right font-semibold text-slate-700">{project.transitZone ?? "Intake pending"}</span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Transit Type</span>
                                <span className="text-right font-semibold text-slate-700">{project.transitType ?? "Profile pending"}</span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Vehicle</span>
                                <span className="text-right font-semibold text-slate-700">{project.assignedVehicle ?? "Not yet assigned"}</span>
                              </div>
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Driver</span>
                                <span className="text-right font-semibold text-slate-700">{project.assignedDriverName ?? "Assignment pending"}</span>
                              </div>
                              {fleetIdsForProject(project).map((fleetId) => (
                                <div key={fleetId} className="flex items-start justify-between gap-3">
                                  <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Fleet ID</span>
                                  <span className="font-mono text-right font-semibold text-slate-700">{fleetId}</span>
                                </div>
                              ))}
                              <div className="flex items-start justify-between gap-3">
                                <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Mileage</span>
                                <span className="text-right font-semibold text-slate-700">{(project.mileageTotal ?? 0).toLocaleString("en-US")} mi tracked</span>
                              </div>
                            </div>
                          </div>
                        ) : null}"""

content = content.replace(OLD_TRANSPORT_BLOCK, NEW_TRANSPORT_BLOCK, 1)

if content != original:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("✓ Motion Network workspace patch applied successfully")
    print("  Changes:")
    print("  1. 'Transportation Asset' → 'Motion Network' in ASSET_PROJECT_TYPES")
    print("  2. Added motion-specific fields to WorkspaceProject interface")
    print("  3. Expanded transportation card with credit strip, launch countdown, route grid")
    print()
    print("  Firestore fields to populate per project document:")
    print("  - motionCreditsUsed: number (0–4)")
    print("  - motionCreditsTotal: number (default 4)")
    print("  - assignedDriverName: string")
    print("  - assignedVehicle: string")
    print("  - transitZone: string (e.g. 'MKE Central')")
    print("  - transitType: string (e.g. 'Product delivery runs')")
    print("  - subscriptionStartDate: ISO string (drives the 60-day countdown)")
else:
    print("⚠ No changes applied — anchors may have shifted.")
    print("  Check that patch_workspace_page.py ran first and search for")
    print("  'Fleet Tracking Log' in the file to verify the old block is still present.")
