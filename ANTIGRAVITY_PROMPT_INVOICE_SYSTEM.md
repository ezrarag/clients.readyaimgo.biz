# Finish the milestone invoice system — prompt for Antigravity

Paste this whole file into Antigravity as the task prompt. Context below is accurate as of a Sept 10 2026 code audit — read it before touching anything, since it points at exact files and a couple of real bugs.

## The problem

ReadyAimGo (Ezra, sole operator) invoices Track A clients — paying clients like Together for Homes / their fiscal sponsor 1000 Friends of Wisconsin, MKE Black, Auset — using a milestone structure: a total contract value split into a few milestones (e.g. Signing / Prototype delivery / Final delivery), each billed as its own invoice once due. A real example already sent by hand is attached as reference: `docs/invoices/reference/RAG-TFH-MW1-example.md` (create this file from the description below if no source file is available — it describes the exact target layout).

That invoice looks like this:
- Header: "READYAIMGO" wordmark + "CONTRACT WORK" tag, invoice number (e.g. `RAG-TFH-MW1`), issue date, due date ("Upon receipt"), project name.
- From / Bill to blocks (From is always ReadyAimGo; Bill To varies per client).
- A stats row: **Total contract value**, **Paid to date**, **This invoice** (three numbers, side by side).
- A milestone table: each row is a milestone label, its status (`Paid`, `Due — this invoice`, `Not yet due`), and its dollar amount.
- Totals: sales tax (usually "Not applicable"), total due.
- A payment block listing configurable payment options — today that's Zelle, Apple Cash, and ACH/bank transfer details (all currently pointing at Ezra's personal account as a stopgap; this needs to become a single config value, not hand-typed per invoice, so it can be swapped for a real ReadyAimGo business account later without touching every invoice).

**None of this exists in the app today.** The pieces that do exist don't fit together for this use case:

- `lib/invoices.ts` defines `ClientInvoice` — a flat `lineItems` array, no concept of milestones, totalContractValue, or paidToDate.
- `lib/invoice-templates.ts` + `lib/invoice-renderer.server.ts` render 5 templates (nexus/space/motion/cohort/contract_milestone) but the renderer (`buildLineItemsBlock`, `buildTotalsBlock`, `buildPaymentBlock` in `lib/invoice-renderer.server.ts`) only knows how to build a flat line-item table and a Stripe-checkout-only payment block. It cannot produce the stats row, the milestone status table, or manual payment methods.
- `lib/contracts.ts` has a `BeamContract` type with `paymentDates: string[]` (milestone labels) and `CONTRACT_TYPES = fleet_maintenance | anchor_partner | cohort_services | mou` — all four are BEAM↔RAG contract types (see `docs/MOTION_NETWORK_OVERVIEW.md` / `SPACE_NETWORK_OVERVIEW.md` / the BEAM_NGOS field for context on what those are for). There is no contract type for an ordinary paying client.
- `components/contracts/ContractMilestonePipeline.tsx` + `components/contracts/ContractDetailModal.tsx` already render a milestone stepper UI that matches invoices to milestones by `installmentIndex` on the invoice — this part is close to right and should be reused/extended, not replaced.
- `PATCH /api/workspaces/[workspaceId]/payments/invoices/[invoiceId]/route.ts` — accepting an invoice auto-creates a linked deliverable and a Stripe checkout session, then calls `renderInvoiceHtml` unless the invoice already has a `pdfUrl` set (that pdfUrl escape hatch is the only reason hand-made PDFs like RAG-TFH-MW1 currently "work" at all — they were uploaded manually, bypassing the renderer entirely).
- `app/api/workspaces/[workspaceId]/files/route.ts` (around the `category === "contract"` branch) has a rough "auto-generate an invoice from an uploaded file" path with real bugs: it hardcodes `amountCents = 150000` ($1,500) regardless of the actual contract value, uses `templateId: "nexus"` (wrong — that's a subscription template), sets `contractType: "milestone"` which is **not** a valid value in `CONTRACT_TYPES` (so `normalizeContract`'s `readEnum` silently coerces it to `"mou"` on every read — a silent data-corruption bug), and never sets `installmentIndex` on the created invoice, so it never matches up in `ContractMilestonePipeline`'s stepper.
- No admin UI page exists for directly creating or editing `clients/{clientId}/invoices` documents. `app/admin/contracts/page.tsx` creates `contracts` records but has no invoice-generation action wired to it at all.

Ezra does not want to keep making these by hand. The goal is a real "create a contract with its milestones once, then generate + send each milestone's invoice in succession, all rendered consistently and all visible as history" flow.

## What to build

### 1. Extend the contract type for Track A clients

In `lib/contracts.ts`, add a contract type usable by ordinary paying clients — e.g. add `"client_project"` to `CONTRACT_TYPES`. Don't remove or rename the existing BEAM types (`fleet_maintenance | anchor_partner | cohort_services | mou`) — this is additive. Update `CONTRACT_TYPE_LABELS` in `app/admin/contracts/page.tsx` to add a label for it (e.g. "Client Project"). `beamNgos` should be allowed to stay empty for this type (it already can — just confirm the create-contract form in `app/admin/contracts/page.tsx` doesn't force a BEAM NGO selection when this type is chosen).

`BeamContract.paymentDates` already holds milestone labels as plain strings (e.g. `["Signing", "Prototype delivery", "Final delivery"]`) — keep using that field for the milestone list, but also add a parallel `milestoneAmountsCents: number[]` (same length/order as `paymentDates`) so each milestone has its own dollar amount instead of assuming even splits, and a `totalContractValueCents: number` field (distinct from the existing `monthlyValue`, which doesn't fit a one-off project). Update `normalizeContract` in `lib/contracts.ts` to read/write these.

### 2. Extend the invoice data model

In `lib/invoices.ts`, add to `ClientInvoice`:
- `milestoneLabel?: string | null` — the label copied from the contract's `paymentDates[installmentIndex]` at generation time (so it's stable even if the contract's milestone list changes later).
- `totalContractValueCents?: number | null`
- `paidToDateCents?: number | null` — sum of all this contract's invoices with `status: "paid"` at generation time, snapshotted (not live-computed) so historical invoices don't silently change.
- `paymentMethods?: { stripe: boolean; manual: boolean } | null` — which payment options this invoice should display. Default both true unless the contract specifies otherwise.

`installmentIndex` already exists on `ClientInvoice` — keep using it to match a milestone to its invoice, exactly as `ContractMilestonePipeline.tsx` already expects.

### 3. Payment methods config (single source of truth)

Create `lib/payment-methods.ts` exporting the current manual payment details (Zelle handle/phone, Apple Cash number, bank name/routing/account) as one config object, e.g.:

```ts
export const MANUAL_PAYMENT_METHODS = {
  zelle: { handle: "haugabr2@uwm.edu", altHandle: "(404) 973-9860", recipientName: "Ezra Haugabrooks / ReadyAimGo" },
  applePay: { number: "404-973-9860" },
  ach: { bankName: "UWM Credit Union", routingNumber: "...", accountNumber: "..." }, // pull actual values from the existing invoice, don't leave placeholders
}
```

Read the real values out of the existing `RAG-TFH-MW1` invoice content Ezra already sent (ask him for it if not available in this repo) rather than inventing them. The whole point of centralizing this is that when Ezra opens a real ReadyAimGo business bank account, updating this one file updates every future invoice — nothing else should hardcode these values.

### 4. Milestone invoice template + renderer

Add a new template entry in `lib/invoice-templates.ts`, e.g. `id: "client_milestone"`, alongside the existing 5 (don't remove any of nexus/space/motion/cohort/contract_milestone — those are still used elsewhere).

Add a real HTML template file at `docs/invoices/ReadyAimGo Invoice - Client Milestone.html` matching the existing templates' structure (marker comments `<!-- meta row -->`, `<!-- from / bill to -->`, etc. — copy the pattern from `docs/invoices/ReadyAimGo Invoice - Contract Milestone.html`) but with the READYAIMGO wordmark + "CONTRACT WORK" header from the reference invoice.

Extend `lib/invoice-renderer.server.ts`:
- Add a `buildStatsRowBlock(invoice)` function rendering Total contract value / Paid to date / This invoice as three side-by-side stats (use `invoice.totalContractValueCents`, `invoice.paidToDateCents`, `invoice.totalCents`).
- Add a `buildMilestoneTableBlock(invoice, contract)` function rendering one row per contract milestone (label, status computed as: `Paid` if an invoice with that `installmentIndex` has `status: "paid"`, `Due — this invoice` if it matches the current invoice's `installmentIndex`, otherwise `Not yet due`), amount from `milestoneAmountsCents`. This needs the contract loaded alongside the invoice — thread it through wherever `renderInvoiceHtml` is called for this template, or accept an optional `contract` param.
- Extend `buildPaymentBlock(invoice)` so that when `invoice.paymentMethods?.manual` is true, it also renders the Zelle/Apple Pay/ACH options from `MANUAL_PAYMENT_METHODS` (lib/payment-methods.ts) alongside or instead of the Stripe link, depending on `invoice.paymentMethods?.stripe`.
- Route `renderInvoiceHtml` to use these new blocks only when `invoice.templateId === "client_milestone"`; leave the existing behavior untouched for the other 5 templates.

### 5. Admin flow: create once, generate in succession

In `app/admin/contracts/page.tsx` (or a new `app/admin/contracts/[contractId]/page.tsx` detail view if that's cleaner — `ContractDetailModal.tsx` may already cover this, check before adding a new route):

- When creating a `client_project` contract, the form should collect the milestone list as labels + amounts (not just labels), and a total contract value (should equal the sum, validate this).
- Add a **"Generate next invoice"** action, enabled only when there's an un-invoiced milestone (i.e. `paymentDates.length > invoices.filter(i => i.contractId === contract.id).length`, matching `ContractMilestonePipeline`'s own logic for finding the next uninvoiced index). It should:
  1. Compute the next `installmentIndex` (first index with no matching invoice).
  2. Create a new `clients/{clientId}/invoices` doc: `templateId: "client_milestone"`, `installmentIndex`, `milestoneLabel` from the contract, `totalCents` = that milestone's amount, `totalContractValueCents` from the contract, `paidToDateCents` = sum of prior paid milestones, an auto-generated `invoiceNumber` following the existing `RAG-TFH-MW1` style (e.g. `RAG-{CLIENT_SHORT}-MW{n}` — derive a short client code, don't reuse the exact TFH one), `status: "draft"`, `from`/`billTo` copied from the contract/client record.
  3. Render it via `renderInvoiceHtml` and store `renderedHtml` immediately so it can be previewed before sending — don't require the accept-flow PATCH endpoint just to see a preview.
  4. Show the rendered preview in the admin UI (iframe or new tab) before Ezra sends it, and give an explicit "Mark as sent" action distinct from "Accepted/Paid" (the existing `status` enum — `draft | client_review | accepted | paid | cancelled` — already has room for this; use `client_review` or add `sent` if that reads better, your call, just be consistent with `CONTRACT_STATUSES`-style naming already in the codebase).
- Show full invoice history per contract (reuse `ContractMilestonePipeline.tsx`'s stepper — it already does most of this) plus a simple chronological list with status and a link to view/download each rendered invoice.

### 6. Fix or retire the buggy auto-generator

In `app/api/workspaces/[workspaceId]/files/route.ts`, the `category === "contract"` branch currently creates a `contracts` doc with an invalid `contractType: "milestone"` and a hardcoded `$1,500` / `"nexus"`-templated invoice with no `installmentIndex`. Either:
- (a) Remove this auto-generation entirely now that the admin flow above exists (simplest, recommended — keep the file upload itself, just drop the invoice/deliverable side-effect), or
- (b) If it needs to stay for some other reason, fix it to use `contractType: "client_project"`, read a real amount instead of hardcoding, use `templateId: "client_milestone"`, and set `installmentIndex` correctly.

Pick (a) unless you find something in the codebase depending on the current behavior — grep for callers of this route with `category: "contract"` first (check the workspace file-upload UI component) before deciding.

### 7. Non-goals

- Don't touch the nexus/space/motion/cohort subscription templates, their $100/mo pricing, or anything under `docs/MOTION_NETWORK_OVERVIEW.md` / `SPACE_NETWORK_OVERVIEW.md` logic — those are a separate BEAM-funding product line, unrelated to this.
- Don't touch `fleet_maintenance | anchor_partner | cohort_services | mou` contract behavior or the BEAM NGO fields — Track B (BEAM) billing is out of scope here.
- Don't add real Stripe bank-payout logic — that's a separate, not-yet-decided piece (Ezra doesn't have a business bank account linked yet). Just make sure `paymentMethods.stripe` can be toggled off per invoice so an invoice can go out manual-only.

## Acceptance checklist

- [ ] `CONTRACT_TYPES` includes `client_project`, admin contract-creation form supports it without forcing a BEAM NGO.
- [ ] A contract can be created with a milestone list of `{label, amountCents}` pairs and a total contract value that must equal their sum.
- [ ] "Generate next invoice" produces a `client_milestone`-templated invoice with the correct `installmentIndex`, `milestoneLabel`, `totalContractValueCents`, and `paidToDateCents` snapshotted correctly.
- [ ] The rendered HTML visually matches the reference invoice: wordmark header, issue/due date + project meta row, From/Bill To, the three-stat row (Total contract value / Paid to date / This invoice), the milestone status table with correct per-row status, totals, and a payment block that can show Stripe, manual (Zelle/Apple Pay/ACH from `lib/payment-methods.ts`), or both.
- [ ] Generating milestone 2 for a contract correctly shows milestone 1 as "Paid" (if its invoice is marked paid) or otherwise appropriately, and shows milestone 2 as "Due — this invoice", milestone 3+ as "Not yet due".
- [ ] All of a contract's invoices are visible together as history (existing `ContractMilestonePipeline` stepper, plus a plain list) from the admin.
- [ ] The buggy file-upload auto-generator in `app/api/workspaces/[workspaceId]/files/route.ts` no longer creates invalid `contractType` values or un-matchable invoices.
- [ ] The other 5 invoice templates and BEAM contract types are unaffected — run through creating an `mou` contract and a `nexus` invoice manually to confirm nothing regressed.
- [ ] `lib/payment-methods.ts` is the only place manual payment details are hardcoded — grep the diff for any other literal Zelle/bank/Apple Pay values before calling this done.
