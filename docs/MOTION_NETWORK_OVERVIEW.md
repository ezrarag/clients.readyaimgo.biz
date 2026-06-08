# readyaimgo | Motion Network — Workspace Overview

## Service Identity

**Brand Name:** Motion Network  
**Internal Type Key:** `transportation` (AssetProjectType)  
**Subscription Price:** $100/month  
**Credit Unit:** Motion Credit (1 credit = 1 round-trip ride or delivery run, up to 15 miles)  
**Credits Per Month:** 4 (rollover cap: 8 total)  
**Pre-Launch Window:** 60 days from first payment before credits activate

---

## The Role: Logistics Architect

The **Logistics Architect** is the initial contact for every Motion Network client — equivalent to the Client Architect role in the Nexus Ecosystem. Responsibilities:

- Conducts the Transit Profile intake (routes, time blocks, zones, cargo/passenger profile)
- Maps client routes into the shared route density grid used for fleet acquisition negotiations
- Coordinates the 60-day pre-launch timeline
- Hands off day-to-day dispatch to the **Fleet Dispatch Lead** once routes are established

---

## $100 Allocation Breakdown

| Bucket | Amount | Purpose |
|--------|--------|---------|
| Fleet Asset Fund | $45/mo | Vehicle acquisition, insurance, lease payments |
| Labor & Fuel Pool | $40/mo | Driver payout + fuel per completed route |
| Platform Maintenance | $10/mo | Dashboard routing, dispatch infrastructure |
| Logistics Architect | $5/mo | Signer commission (5%) |

**At 20 pilot clients:** $900/mo fleet reserve · $800/mo labor pool · $4,000 pre-launch cash pool (60-day window)

---

## Workspace Card — Firestore Fields

These fields must be set on each `projects/{projectId}` Firestore document when the project type is `transportation`:

```typescript
{
  assetProjectType: "transportation",
  subscriptionStartDate: "2025-06-01T00:00:00Z",  // drives 60-day countdown
  motionCreditsTotal: 4,                            // default 4 per month
  motionCreditsUsed: 0,                             // increments per route completed
  transitZone: "MKE Central",                       // from intake questionnaire
  transitType: "Product delivery runs",             // from intake questionnaire
  assignedVehicle: "2023 Toyota Camry — VH-001",   // set at Day 30 fleet acquisition
  assignedDriverName: "Driver Name (BEAM)",         // set at Day 30 driver assignment
  fleetIds: ["VH-001"],                             // fleet vehicle IDs
  mileageTotal: 0,                                  // accumulated route mileage
}
```

---

## Card Display Logic

The workspace card (`assetType === "transportation"`) renders four sections:

1. **Motion Credits Strip** — visual credit pips (blue = available, faded = used)
2. **60-Day Launch Countdown** — derived from `subscriptionStartDate + 60 days`; shows amber "X days remaining" pre-launch, emerald "Network Active" post-launch
3. **Route & Fleet Details grid** — zone, transit type, vehicle, driver, fleet ID, mileage
4. **Directory** — standard role directory (owner, developer, BEAM driver)

---

## Fleet Acquisition Strategy

### Primary: Dealer Floor Plan Arbitrage
Target dealers with slow-turn inventory (88+ days on lot = ~$616 in floor plan interest lost).
Pitch: RAG covers insurance + maintenance via BEAM cohort, puts vehicle in revenue-generating routes.
After 6 months, exercise purchase option at depreciated value. No traditional credit check required.

### Secondary: Corporate Lease
readyaimgo business entity leases a commercial vehicle ($500–600/mo).
Fleet Asset Fund from 20 pilot clients covers this with ~$300/mo maintenance cushion.

### Tertiary: Family Network MOUs
MOUs with cousin rental/logistics businesses. RAG vehicles flow to rental inventory in off-peak hours.
Cousin logistics overflow dispatched through BEAM drivers on RAG vehicles.

---

## Team Structure

```
Logistics Architect (Ezra)
        │
Fleet Dispatch Lead (TBD — hiring)
        │
┌───────┴───────┐
Lead Driver     BEAM Drivers
(VIP/priority)  (Scheduled routes)
        │
Fleet Mechanic Partner (Eric's network)
```

---

## Route Batching Principle

No vehicle drives empty. The intake questionnaire captures:
1. Primary transit need (delivery, executive pickup, supply run)
2. Predictable days/times (enables sequential batching across clients)
3. Geographic zone (enables single-vehicle multi-client runs)

Example: Client A's 10AM product delivery + Client B's 1PM supply run handled by the same vehicle and driver. Revenue-per-mile maximized.

---

## Subscription Tiers & Upsells

| Tier | Price | Credits | Target Client |
|------|-------|---------|---------------|
| Base Motion | $100/mo | 4 credits | Small business, occasional delivery/transport |
| Motion Plus | $200/mo | 10 credits | Mid-volume delivery, regular executive transport |
| Motion Enterprise (SOW) | Custom | Dedicated | Daily routes, dedicated vehicle, named driver |

Credits never expire within the month. Rollover cap: 8 total. Enterprise clients bypass credit system entirely with dedicated routes.

---

## Codebase Locations

- **Card JSX:** `app/workspace/[workspaceId]/page.tsx` → search `assetType === "transportation"`
- **Project type enum:** Same file → `ASSET_PROJECT_TYPES` (label: "Motion Network")
- **Interface fields:** Same file → `WorkspaceProject` interface
- **Patch script:** `patch_motion_workspace.py` (run after `patch_workspace_page.py`)
- **API projects route:** `app/api/workspaces/[workspaceId]/projects/`
- **Operations tracker:** `Motion_Network_Operations.xlsx`
- **Vendor brief:** `Motion_Network_Vendor_Brief.html`

---

## Coming Next

- [ ] Route booking API route (`POST /api/workspaces/:id/motion/book`)
- [ ] Credit deduction webhook (triggered when driver marks route complete)
- [ ] Fleet status endpoint (vehicle location, availability, upcoming routes)
- [ ] BEAM driver dashboard view (separate from client view)
- [ ] raCommand integration: push route alerts to iOS app
