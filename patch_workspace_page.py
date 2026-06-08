#!/usr/bin/env python3
"""
Run this once from the project root:
  python3 patch_workspace_page.py

It makes two targeted edits to app/workspace/[workspaceId]/page.tsx:
  1. Renames "Web Development" → "Nexus" in ASSET_PROJECT_TYPES
  2. Adds the 4th retainer card (Build Cost Comparison) to the Billing Summary section
     and bumps the slide pagination from 3 → 4
"""

import re

path = "app/workspace/[workspaceId]/page.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

original = content

# ── Change 1: Rename label ────────────────────────────────────────────────────
content = content.replace(
    '{ value: "webdev", label: "Web Development" },',
    '{ value: "webdev", label: "Nexus" },'
)

# ── Change 2: Bump pagination max from 2 → 3 (slide count 0–3 = 4 slides) ────
content = re.sub(
    r'setRetainerSlide\(Math\.min\(2,',
    'setRetainerSlide(Math.min(3,',
    content
)

# ── Change 3: Update "X / 3" label to "X / 4" ────────────────────────────────
content = re.sub(
    r'(\{retainerSlide \+ 1\}\s*/\s*)3',
    r'\g<1>4',
    content
)

# ── Change 4: Insert the 4th card after the Stripe Receipts card block ────────
# The Stripe Receipts card ends with a closing </Card> followed by a closing
# </div> of the 3-col grid. We insert a 4th card before that grid-closing </div>.
# We anchor on the unique CardTitle "STRIPE RECEIPTS" section end.

NEW_CARD = '''
                {/* ── Card 4: Build Cost Comparison ─────────────────────────── */}
                {retainerSlide === 3 ? (
                  <Card className="border-amber-200 bg-amber-50/60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                        Build Cost Comparison
                        <InfoTooltip text="Shows what this project would cost if attempted with off-the-shelf platforms vs. a custom build through readyaimgo." />
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {[
                          {
                            platform: "Squarespace",
                            possible: "Partial only",
                            setupHrs: "8–20 hrs",
                            monthlyCost: "$23–65/mo",
                            note: "No custom auth, no database, no app logic.",
                            accent: "text-amber-700",
                          },
                          {
                            platform: "WordPress",
                            possible: "Limited",
                            setupHrs: "40–120 hrs",
                            monthlyCost: "$25–200+/mo",
                            note: "Plugins + dev time add up fast; security overhead.",
                            accent: "text-amber-700",
                          },
                          {
                            platform: "Custom (readyaimgo)",
                            possible: "Full scope",
                            setupHrs: "Ongoing managed",
                            monthlyCost: "$50/mo all-in",
                            note: "Firebase, Next.js, AI-powered — built for your scale.",
                            accent: "text-emerald-700",
                          },
                        ].map((row) => (
                          <div
                            key={row.platform}
                            className="rounded-xl border border-border bg-white/80 px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-slate-900">{row.platform}</p>
                              <span className={`text-[10px] font-bold ${row.accent}`}>
                                {row.monthlyCost}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                              <span>Feasibility: <span className="font-medium text-slate-700">{row.possible}</span></span>
                              <span>·</span>
                              <span>Setup: <span className="font-medium text-slate-700">{row.setupHrs}</span></span>
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">{row.note}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : null}'''

# Find the closing of the 3-card grid section. The grid div opens with a specific pattern.
# The safest anchor: the STRIPE RECEIPTS card's closing tag followed by the grid close.
# Pattern: we find the retainerSlide===2 block end (Stripe Receipts card close) and insert after.

ANCHOR = 'retainerSlide === 2 ?'
STRIPE_CARD_END = '''                ) : null}
              </div>'''

if STRIPE_CARD_END in content:
    # Insert the new card block between the stripe card end and closing div
    content = content.replace(
        STRIPE_CARD_END,
        f'''                ) : null}
{NEW_CARD}
              </div>''',
        1  # only first occurrence
    )
    print("✓ 4th retainer card inserted")
else:
    print("⚠ Could not find Stripe card anchor — please insert the 4th card manually.")
    print("  Search for 'retainerSlide === 2' in the payments tab and add after that block.")

if content != original:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print("✓ File written successfully")
    print("  Changes applied:")
    print("  1. 'Web Development' → 'Nexus' in ASSET_PROJECT_TYPES")
    print("  2. Retainer slide max bumped 2 → 3")
    print("  3. Slide counter label updated to '/ 4'")
    print("  4. 4th card (Build Cost Comparison) added to retainer billing section")
else:
    print("⚠ No changes were made — anchors may have shifted. Check the file manually.")
