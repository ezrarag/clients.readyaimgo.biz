# Partner Tier — Schema Design

## Overview

The partner tier extends the existing `clients/{email}` document
with a lightweight `partnerTier` flag and a separate `partners/{email}`
collection for referral tracking. No breaking changes to existing
client records.

---

## Firestore Changes

### 1. `clients/{email}` — new fields (merged on existing doc)

```ts
{
  // existing fields unchanged ...

  // NEW
  partnerTier: "agency" | null          // null = standard client
  partnerSince: Timestamp | null        // when the tier was granted
  partnerCommissionPct: number          // default 10, configurable per partner
  partnerReferralCount: number          // denormalized count, updated on each referral creation
}
```

Grant via RAG admin: set `partnerTier: "agency"` on the client doc.
Revoke: set `partnerTier: null`.

---

### 2. `handoffs/{handoffId}` — new field

```ts
{
  // existing fields unchanged ...

  // NEW
  referredByPartnerEmail: string | null  // email of the partner who generated this link
}
```

This field already flows into `clients/{email}.onboardingHandoffId`.
Now we can trace lineage: client → handoff → partner.

---

### 3. `partners/{email}` — new collection

One doc per partner. Keyed by partner email (same key pattern as `clients/`).

```ts
{
  email: string
  companyName: string
  partnerTier: "agency"
  commissionPct: number           // e.g. 10 (= 10%)
  totalReferrals: number          // denormalized
  totalConvertedReferrals: number // referrals that signed up
  referralLinks: PartnerReferralLink[]  // embedded array (max ~50 per partner)
  createdAt: Timestamp
  updatedAt: Timestamp
}
```

#### `PartnerReferralLink` (embedded in `partners/{email}.referralLinks`)

```ts
{
  handoffId: string              // matches handoffs/{handoffId}
  label: string                  // partner-supplied label, e.g. "Green Leaf Dispensary"
  businessType: string           // org type pre-filled
  serviceInterests: string[]     // pre-checked services
  createdAt: string              // ISO timestamp
  url: string                    // full signup URL with ?handoff= param
  converted: boolean             // true once a client doc with this handoffId exists
  convertedAt: string | null     // ISO timestamp when converted
}
```

---

## API Routes to Add

### `POST /api/partner/generate-link`
- Auth: requires logged-in user with `partnerTier === "agency"` on their client doc
- Body: `{ label, businessType, serviceInterests, notes? }`
- Creates a `handoffs/{handoffId}` doc with `referredByPartnerEmail` set
- Appends to `partners/{email}.referralLinks`
- Returns: `{ handoffId, url }`

### `GET /api/partner/referrals`
- Auth: partner only
- Returns: `partners/{email}.referralLinks` with conversion status

### `PATCH /api/partner/referrals/:handoffId/convert`
- Called internally by the signup flow when a handoff is consumed
- Marks `converted: true` on the embedded link + increments `totalConvertedReferrals`
- Hook into `upsertClientAccountRecord` in `lib/client-onboarding.ts`

---

## `lib/partner.ts` — new file

```ts
export interface PartnerReferralLink {
  handoffId: string
  label: string
  businessType: string
  serviceInterests: string[]
  createdAt: string
  url: string
  converted: boolean
  convertedAt: string | null
}

export interface PartnerRecord {
  email: string
  companyName: string
  partnerTier: "agency"
  commissionPct: number
  totalReferrals: number
  totalConvertedReferrals: number
  referralLinks: PartnerReferralLink[]
  createdAt: string | null
  updatedAt: string | null
}
```

---

## `types/index.ts` — additions to `Client`

```ts
// Add to existing Client interface:
partnerTier?: "agency" | null
partnerSince?: Date | null
partnerCommissionPct?: number
partnerReferralCount?: number
```

---

## Conversion Rate Tracking

`conversionRate = totalConvertedReferrals / totalReferrals * 100`

Computed client-side in the partner dashboard — no extra Firestore field needed.

---

## Notes

- **Key consistency**: `partners/` uses the same email-as-key pattern as `clients/`.
  Both documents exist for a partner client — one for their own RAG relationship,
  one for their outbound referral activity.
- **No Supabase**: Firestore only. No SQL.
- **Handoff expiry**: existing `expiresAt` on handoff docs handles link expiry automatically.
- **Admin grant flow**: RAG admin sets `partnerTier: "agency"` via the existing
  `/admin` page (add a toggle in the clients table — Codex task).
