# readyaimgo | Space Network — Workspace Overview

## Service Identity

**Brand Name:** Space Network  
**Internal Type Key:** `real-estate` (AssetProjectType)  
**Subscription Price:** $100/month  
**Credit Unit:** Space Credit (1 credit = 1 × 2-hour block of meeting room, storefront, studio, or desk)  
**Credits Per Month:** 12  
**Model:** Fractional workspace subscription — clients book time, not buildings

---

## The Role: Acquisition Architect

The **Acquisition Architect** is the founding role — the person who secures property relationships and matches underutilized physical space with the client demand pool.

Responsibilities:
- Runs the Space Profile intake (space type needs, time patterns, geographic zone preference)
- Builds the demand grid used as leverage in hospitality block and BID negotiations
- Sources and structures master-lease agreements, hospitality blocks, and university MOUs
- Hands off day-to-day property management to the **Space Operations Manager** once assets are live

Unlike Nexus and Motion, this role is designed to be **split between two partners** — Ezra handles the digital platform and client subscriptions; the real estate partner handles property relationships and deal negotiations.

---

## $100 Allocation Breakdown

| Bucket | Amount | Purpose |
|--------|--------|---------|
| Property Reserve Fund | $50/mo | Master-leases, hospitality blocks, renovation funds |
| Operations & Utilities | $35/mo | Wi-Fi, insurance, cleaning, smart access tech |
| Platform Integration | $10/mo | Dashboard booking, credit tracking, key provisioning |
| Acquisition Architect | $5/mo | Commission, split between two partners |

**At 15 pilot clients:** $750/mo property reserve · $525/mo ops · $150/mo platform

---

## Workspace Card — Firestore Fields

These fields must be set on each `projects/{projectId}` Firestore document when the project type is `real-estate`:

```typescript
{
  assetProjectType: "real-estate",
  subscriptionStartDate: "2025-06-01T00:00:00Z",
  spaceCreditsTotal: 12,              // default 12 per month
  spaceCreditsUsed: 0,                // increments per booking
  spaceType: "Meeting Room",          // from intake: Pop-Up Storefront | Meeting Room | Studio | Co-Work Desk
  preferredZone: "Downtown MKE",      // from intake: geographic zone preference
  activeProperty: "Marriott Block",   // matched property name
  agreementType: "Hospitality Block", // Hospitality Block | Master Lease | University MOU | BID Lease
  bidGrantEligible: true,             // flags BID/NID grant opportunity
  propertyLocations: [                // rendered as Portfolio Property Grid
    { label: "Marriott Conference A", latitude: 43.0389, longitude: -87.9065 }
  ]
}
```

---

## Card Display Logic

The workspace card (`assetType === "real-estate"`) should render:

1. **Space Credits Strip** — circular pips (12 total, amber for available, faded for used)
2. **Active Property Badge** — shows `activeProperty` and `agreementType`; if empty shows "Intake in progress"
3. **Space Profile grid** — space type, preferred zone, BID grant eligibility, agreement type
4. **Portfolio Property Grid** — existing `propertyLocations` map tiles (already in codebase)
5. **Directory** — standard role directory

**Retainer tab comparison card (4th card):** Show "Workspace Cost Comparison" — WeWork/Regus ($300–600/mo, desk only), Commercial lease ($1,500–5,000/mo, full liability), Peerspace ($200–800/mo, per-use), readyaimgo Space ($100/mo, 12 credits, all space types). Sage/green color theme.

---

## Three Acquisition Paths

### Path 1: Hospitality Block (Immediate)
Target corporate sales at downtown Milwaukee hotels (Marriott, Kimpton, Westin).
Offer: guaranteed 30+ room-blocks/month from client pool at B2B fractional rate.
Hotels want minimum occupancy on dead mid-week conference inventory.
No renovation, no lease, no capital outlay — just the demand grid as leverage.

### Path 2: BID/NID Master-Lease (6 months)
Target underutilized storefronts in BID-active corridors:
- Historic Mitchell Street (VIA CDC, MiSA, Voces de la Frontera connections)
- Near Southside (active BID grant programs)
- Riverworks area (existing 501c3 development corp relationship)

BEAM participants handle cleaning, access tech, light renovation.
BID grant funding offsets lease costs. Client pop-up rotations sustain the lease.

### Path 3: University Master-Lease (12–18 months)
Pitch UWM (graduate student positioning) for long-term use-agreement on vacant property.
BEAM Architecture/Forge/Grounds cohorts execute renovation as accredited workforce track.
Zero traditional capital. Student workforce credit subsidizes renovation.
RAG anchors technology deployment (booking system, smart locks, workspace portal).

---

## Team Structure

```
Acquisition Architect (Ezra + Partner)
          │
Space Operations Manager (TBD — hiring)
          │
┌─────────┴──────────┐
Property Access Tech   BEAM Renovation Coordinator
(Smart locks, NFC)    (Architecture/Forge track)
          │
BID/NID Liaison (Partner/Consultant)
```

---

## Milwaukee Proof-of-Concept Analogues

| Organization | What They Prove | Relevance |
|---|---|---|
| Sherman Phoenix | Adaptive reuse of blighted institutional space → 25+ community businesses | Space Network's end-state vision |
| VIA CDC | CDC buys, renovates, builds commercial + residential to stabilize neighborhoods | BID grant pipeline partner |
| Riverworks Business Hub | BID-backed commercial matchmaking for entrepreneurs | Referral + co-pitch partner |
| MiSA (Mitchell Street Arts) | Nonprofit makerspace, no commissions, co-work + studio | Studio space model |
| Voces de la Frontera | Mission-driven permanent HQ anchor on Mitchell Street | Space as community power |

---

## Codebase Locations

- **Card JSX:** `app/workspace/[workspaceId]/page.tsx` → `assetType === "real-estate"` (already has `propertyLocations` grid)
- **Project type enum:** Same file → `ASSET_PROJECT_TYPES` (label: "Space Network")
- **Interface fields:** Same file → `WorkspaceProject` interface
- **Patch script:** `patch_space_workspace.py` (run after Nexus + Motion patches)
- **API projects route:** `app/api/workspaces/[workspaceId]/projects/`
- **Operations tracker:** `Space_Network_Operations.xlsx`
- **Vendor/partner brief:** `Space_Network_Vendor_Brief.html`

---

## Claude Code Prompt (Space Network Card)

Add to the existing Claude Code prompt for workspace card expansion:

```
For assetType === "real-estate" in the Projects tab project card:

Expand the current "Portfolio Property Grid" with additional sections above it:

1. Space Credits Strip: 12 circular amber pips. Used credits (project.spaceCreditsUsed ?? 0) 
   shown faded/muted, remaining shown filled/amber. 
   Label: "X credits remaining · 1 credit = 2-hour block"

2. Active Property Badge: Single row showing
   property: project.activeProperty ?? "Intake in progress"  
   type: project.agreementType ?? "Agreement pending"
   BID grant indicator: if project.bidGrantEligible show a small green "BID Grant Available" badge

3. Space Profile grid (same style as webdev repo grid):
   Space Type | project.spaceType ?? "Profile pending"
   Zone | project.preferredZone ?? "Zone intake pending"
   Agreement | project.agreementType ?? "Pending"

4. Keep existing Portfolio Property Grid below all of the above.

Add these optional fields to WorkspaceProject interface:
  spaceCreditsUsed?: number
  spaceCreditsTotal?: number  
  spaceType?: string
  preferredZone?: string
  activeProperty?: string
  agreementType?: string
  bidGrantEligible?: boolean

For the 4th retainer card (dominantType === "real-estate"):
Show "Workspace Cost Comparison":
- WeWork / Regus hot desk: $300–600/mo, desk only, no storefront access
- Commercial lease (direct): $1,500–5,000/mo, 12-month commitment, full liability
- Peerspace / Airbnb per-use: $200–800/mo, unpredictable, no subscription rate
- readyaimgo Space Network: $100/mo, 12 credits, all space types, dashboard booking
Use sage/green color theme (border-green-200, bg-green-50).
```

---

## Coming Next

- [ ] Space booking API route (`POST /api/workspaces/:id/space/book`)
- [ ] Credit deduction on booking confirmation
- [ ] Smart lock / NFC access provisioning endpoint
- [ ] Property availability calendar (prevents double-booking across clients)
- [ ] BID grant tracker (tracks application status per property)
- [ ] raCommand integration: property status push notifications
- [ ] BEAM Architecture track integration (renovation project management)
