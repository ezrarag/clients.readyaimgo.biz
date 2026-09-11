# Reference Invoice Layout: RAG-TFH-MW1

This document describes the exact target layout for ReadyAimGo Track A milestone invoices (e.g. `RAG-TFH-MW1` for Together For Homes milestone 1).

## 1. Header
- **Brand Wordmark**: `READYAIMGO` wordmark with "CONTRACT WORK" dark tag badge.
- **Title**: `INVOICE` right-aligned.
- **Invoice Number**: e.g., `RAG-TFH-MW1`.
- **Issue Date**: e.g., `July 9, 2026`.
- **Due Date**: `Upon receipt` (or date).
- **Project**: e.g., `Together For Homes — Permit Dashboard`.

## 2. From / Bill To Blocks
- **From**:
  ReadyAimGo
  Ezra Haugabrooks, sole operator
  Milwaukee, WI
  support@readyaimgo.biz
  +1 (414) 635-2155
  EIN 85-0868964

- **Bill To**:
  Client Name / Contact
  Company Name / Fiscal Sponsor (e.g. 1000 Friends of Wisconsin)
  Client Address
  Client Email

## 3. Contract Summary Stats Row
Three side-by-side metric boxes:
- **Total Contract Value**: `$3,000.00`
- **Paid to Date**: `$0.00` (or prior paid milestones sum)
- **This Invoice**: `$1,000.00` (highlighted background)

## 4. Milestone Table
Columns: `Milestone` | `Status` | `Amount`
- `1. Signing` | `Due — this invoice` (Highlighted background, orange text) | `$1,000.00`
- `2. Prototype delivery` | `Not yet due` | `$1,000.00`
- `3. Final delivery` | `Not yet due` | `$1,000.00`

Status states:
- `Paid` (Green `#1B7A46`) for previously paid milestones.
- `Due — this invoice` (Orange `#F97316`, highlighted row `#FBF3EA`) for the current invoice installment index.
- `Not yet due` (Gray `#999`) for future milestones.

## 5. Totals
- **Sales Tax**: `Not applicable`
- **Total Due**: `$1,000.00`

## 6. Payment Instructions Block
Configurable options rendered from centralized `lib/payment-methods.ts`:
- **Zelle**: `haugabr2@uwm.edu` / `(404) 973-9860` (Recipient: Ezra Haugabrooks / ReadyAimGo)
- **Apple Cash**: `404-973-9860`
- **ACH / Bank Transfer**: UW Credit Union, Routing: `275978474`, Account: `2300054321`
- Optional **Stripe Pay Link** if Stripe Checkout is enabled.

## 7. Footer
- Support contact info: `support@readyaimgo.biz · +1 (414) 635-2155`
- Tax note: `No sales tax has been applied to this invoice.`
