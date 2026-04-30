# Codex Task: Partner Agency Sub-Account — Full Build

## Decision: What is a partner?

Partners like Ezra's cousin are agency sub-accounts. This means:

- She has her OWN clients.readyaimgo.biz login and dashboard
- Inside her dashboard she has a "Partner" tab where she manages HER clients
- The businesses she refers show up under her — she can see their status,
  what services they have activated, and whether they have converted
- She is NOT just getting a referral link — she is getting a lightweight
  agency CRM layer on top of her own client account
- RAG sees all of her sub-clients in the main admin panel, tagged with her
  as the referring/managing partner

Model: partner = agency partner client. Her dispensary clients = standard
clients who came in through her link. She sees them. RAG admin sees everything.

---

## What Already Exists (Do NOT recreate)

Claude has already written these files. Read them before writing anything:

- components/partner/referral-link-generator.tsx
- app/api/partner/generate-link/route.ts
- app/api/partner/referrals/route.ts
- docs/PARTNER_TIER_SCHEMA.md

Firebase Admin pattern: see app/api/feedback/route.ts — all server routes use
initializeApp + cert from firebase-admin. Client pages use getDb() from
lib/firebase/config.ts. Follow this split exactly.

---

## Thing 1 — lib/partner.ts + type additions

Create lib/partner.ts:

```ts
import type { Client } from "@/types"

export interface PartnerReferralLink {
  handoffId: string
  label: string
  businessType: string
  serviceInterests: string[]
  notes: string
  createdAt: string
  url: string
  converted: boolean
  convertedAt: string | null
}

export interface PartnerSubClient {
  email: string
  companyName: string
  organizationType: string
  serviceInterests: string[]
  onboardingStatus: string
  createdAt: string | null
  handoffId: string
}

export interface PartnerRecord {
  email: string
  companyName: string
  partnerTier: "agency"
  commissionPct: number
  totalReferrals: number
  totalConvertedReferrals: number
  referralLinks: PartnerReferralLink[]
  subClients: PartnerSubClient[]
  createdAt: string | null
  updatedAt: string | null
}

export function isAgencyPartner(client: Client | null): boolean {
  return client?.partnerTier === "agency"
}

export function conversionRate(record: PartnerRecord): number {
  if (!record.totalReferrals) return 0
  return Math.round((record.totalConvertedReferrals / record.totalReferrals) * 100)
}

export function normalizePartnerRecord(
  email: string,
  data: Record<string, unknown>
): PartnerRecord {
  return {
    email,
    companyName: typeof data.companyName === "string" ? data.companyName : "",
    partnerTier: "agency",
    commissionPct: typeof data.commissionPct === "number" ? data.commissionPct : 10,
    totalReferrals: typeof data.totalReferrals === "number" ? data.totalReferrals : 0,
    totalConvertedReferrals:
      typeof data.totalConvertedReferrals === "number"
        ? data.totalConvertedReferrals
        : 0,
    referralLinks: Array.isArray(data.referralLinks)
      ? (data.referralLinks as PartnerReferralLink[])
      : [],
    subClients: [],
    createdAt: typeof data.createdAt === "string" ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
  }
}
```

Edit types/index.ts — add to existing Client interface:

```ts
partnerTier?: "agency" | null
partnerSince?: Date | null
partnerCommissionPct?: number
partnerReferralCount?: number
```

---

## Thing 2 — Three new API routes

### app/api/partner/sub-clients/route.ts (GET)

GET /api/partner/sub-clients?email=partner@example.com

Logic:
1. Verify clients/{email}.partnerTier === "agency" — return 403 if not
2. Get partners/{email}.referralLinks array
3. Extract all handoffId values
4. If none, return { subClients: [] }
5. Query Firestore clients collection:
   where("onboardingHandoffId", "in", [handoffId1, handoffId2, ...])
   Chunk into groups of 30 if needed (Firestore "in" limit)
6. Map each result to PartnerSubClient:
   - email: doc id
   - companyName: data.companyName
   - organizationType: data.organizationType
   - serviceInterests: data.serviceInterests (array)
   - onboardingStatus: data.onboardingStatus
   - createdAt: serialize timestamp to ISO string
   - handoffId: data.onboardingHandoffId
7. Return { subClients }

### app/api/partner/referrals/[handoffId]/convert/route.ts (PATCH)

PATCH /api/partner/referrals/:handoffId/convert
Header: x-rag-internal-secret: <secret>

Logic:
1. Check x-rag-internal-secret header vs process.env.RAG_INTERNAL_SECRET — 401 if wrong
2. Get handoffs/{handoffId} — if no doc or no referredByPartnerEmail, return 200 no-op
3. Get partners/{partnerEmail} doc
4. Read referralLinks array, find item matching handoffId
5. Build updated array with that item set to converted: true, convertedAt: now ISO
6. Write full updated array back with setDoc + merge: true
7. Increment totalConvertedReferrals with FieldValue.increment(1)
8. Return { ok: true }

Note: Firestore does not support in-place array element updates.
Read the full array, update the matching item, write the whole array back.

### app/api/admin/grant-partner/route.ts (POST)

POST /api/admin/grant-partner
Body: { email: string, action: "grant" | "revoke", callerEmail: string }

Logic:
1. Verify caller is admin — check NEXT_PUBLIC_ADMIN_UID env or
   read clients/{callerEmail} and check roles includes beam-admin
   Return 403 if not admin
2. action === "grant":
   - setDoc merge:true on clients/{email}:
     { partnerTier: "agency", partnerSince: FieldValue.serverTimestamp() }
   - Read clients/{email} to get companyName
   - setDoc merge:true on partners/{email}:
     { email, companyName, partnerTier: "agency", commissionPct: 10,
       totalReferrals: 0, totalConvertedReferrals: 0, referralLinks: [],
       createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
3. action === "revoke":
   - setDoc merge:true on clients/{email}: { partnerTier: null }
   - Do NOT touch partners/{email} — preserve history
4. Return { ok: true }

---

## Thing 3 — app/partner/page.tsx

Model closely after app/dashboard/page.tsx.

### Access guard on mount:
- Load clients/{user.email} from Firestore (same pattern as dashboard)
- If client.partnerTier !== "agency", redirect to /dashboard
- Show Loader2 spinner while loading

### AppShell:

```tsx
<AppShell
  eyebrow="Partner workspace"
  title={`${clientData?.companyName ?? "Partner"} — Agency dashboard`}
  description="Manage the clients you have brought into the RAG ecosystem."
  nav={[
    { href: "/dashboard", label: "My dashboard" },
    { href: "/partner", label: "Partner", active: true },
    { href: "/settings", label: "Settings" },
  ]}
  actions={
    <>
      <Badge variant="secondary">{user.email}</Badge>
      <Button variant="outline" onClick={handleSignOut}>
        <LogOut className="mr-2 h-4 w-4" />
        Sign Out
      </Button>
    </>
  }
  intro={/* four-metric strip */}
>
```

### Intro metric strip (same style as dashboard):

```tsx
<div className="rounded-[28px] border border-white/75 bg-white/80 p-5 shadow-sm">
  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
    Partner snapshot
  </p>
  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
    {[
      { label: "Links sent", value: partner?.totalReferrals ?? 0 },
      { label: "Signed up", value: partner?.totalConvertedReferrals ?? 0 },
      { label: "Conversion", value: `${partner ? conversionRate(partner) : 0}%` },
      { label: "Commission", value: `${partner?.commissionPct ?? 10}%` },
    ].map((stat) => (
      <div key={stat.label}>
        <p className="text-xs text-slate-500">{stat.label}</p>
        <p className="text-2xl font-semibold text-slate-950">{stat.value}</p>
      </div>
    ))}
  </div>
</div>
```

### Section A — Your clients card

Table columns: Business | Type | Services | Status | Joined

- Business: companyName
- Type: organizationType as Badge variant="secondary"
- Services: serviceInterests.slice(0, 3) as small badges, "+N" if more
- Status: onboardingStatus — Badge variant="accent" for "claimed", variant="secondary" for others
- Joined: format(new Date(createdAt), "MMM d, yyyy") from date-fns

Empty state:
```tsx
<div className="py-12 text-center text-sm text-slate-500">
  No clients have signed up through your links yet.
</div>
```

Data: fetch GET /api/partner/sub-clients?email={user.email}

### Section B — Generate referral link

Import existing component and add partnerEmail prop:

```tsx
import { ReferralLinkGenerator } from "@/components/partner/referral-link-generator"

<ReferralLinkGenerator
  partnerEmail={user.email ?? ""}
  onLinkGenerated={() => void loadPartnerData()}
/>
```

Also update components/partner/referral-link-generator.tsx to accept:
```ts
interface Props {
  partnerEmail: string
  onLinkGenerated?: () => void
}
```
Pass partnerEmail as callerEmail in the POST body.
Call onLinkGenerated?.() after successful generation.

### Section C — All referral links table

Sorted newest first. Columns: Business | Type | Created | Status | Copy

- Status: Badge variant="success" if converted, variant="secondary" if pending
- Copy: icon button, navigator.clipboard.writeText(link.url), shows checkmark 2s

### Data loading parallel on mount:

```ts
const loadPartnerData = async () => {
  if (!user?.email) return
  setPageLoading(true)
  try {
    const firestoreDb = getDb()
    const emailKey = user.email.toLowerCase().trim()
    const clientSnap = await getDoc(doc(firestoreDb, "clients", emailKey))
    const clientDoc = clientSnap.exists() ? (clientSnap.data() as Client) : null

    if (!clientDoc || clientDoc.partnerTier !== "agency") {
      router.replace("/dashboard")
      return
    }
    setClientData(clientDoc)

    const [partnerRes, subClientsRes] = await Promise.all([
      fetch(`/api/partner/referrals?email=${encodeURIComponent(user.email)}`),
      fetch(`/api/partner/sub-clients?email=${encodeURIComponent(user.email)}`),
    ])

    const partnerJson = await partnerRes.json()
    const subClientsJson = await subClientsRes.json()

    setPartner(normalizePartnerRecord(user.email, partnerJson))
    setSubClients(subClientsJson.subClients ?? [])
  } catch (err) {
    console.error(err)
    setError("Unable to load partner workspace.")
  } finally {
    setPageLoading(false)
  }
}

useEffect(() => {
  if (!authLoading && !user) {
    router.push("/login")
    return
  }
  if (!authLoading && user) {
    void loadPartnerData()
  }
}, [authLoading, user])
```

---

## Thing 4 — Nav injection + admin grant toggle

### Edit app/dashboard/page.tsx:

In the nav prop, add after the admin link:

```ts
...(client?.partnerTier === "agency"
  ? [{ href: "/partner", label: "Partner" }]
  : []),
```

### Edit lib/admin.ts:

Add to AdminClient interface:
```ts
partnerTier?: "agency" | null
```

### Edit app/admin/page.tsx:

Add Partner column to clients table. Per row:
- partnerTier === "agency": Badge variant="accent" labeled "Agency" + Revoke button
- Otherwise: "Grant agency" button

On grant:
```ts
await fetch("/api/admin/grant-partner", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: client.email, action: "grant", callerEmail: user?.email }),
})
void loadClients()
```

---

## Signup hook — conversion tracking

### Edit lib/client-onboarding.ts:

After the main setDoc call in upsertClientAccountRecord, add:

```ts
if (handoff?.id) {
  try {
    await fetch(`/api/partner/referrals/${handoff.id}/convert`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-rag-internal-secret": process.env.RAG_INTERNAL_SECRET ?? "",
      },
    })
  } catch {
    // non-fatal
  }
}
```

---

## Constraints

- Firebase Admin SDK in all API routes (see app/api/feedback/route.ts for pattern)
- Client-side Firestore via getDb() in page components
- No Supabase, no new UI libraries
- TypeScript strict — no any, use unknown + type guards
- "use client" on all page components and hooks
- API routes return { error: string } on failure with correct HTTP status
- Run tsc --noEmit after all areas complete

---

## Demo Readiness Checklist

- [ ] Ezra signs up at clients.readyaimgo.biz/signup with Google
- [ ] Firestore Console: add partnerTier: "agency" to clients/ezra.haugabrooks@gmail.com
- [ ] Ezra logs in and sees "Partner" in his nav
- [ ] Ezra visits /partner — agency dashboard loads
- [ ] Ezra generates a referral link for a dispensary
- [ ] Link opens a pre-filled signup form
- [ ] Cousin clicks link, creates her account, appears in Ezra's "Your clients" table
