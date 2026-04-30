# Codex Prompt — clients.readyaimgo.biz Client Feedback System

## Context

You are working on `clients.readyaimgo.biz`, a Next.js 14 App Router project using Firebase/Firestore,
TailwindCSS, shadcn/ui, and TypeScript. The project is deployed on Vercel.

We have just added the following new files:
- `app/api/feedback/route.ts` — POST/GET/PATCH API for AI-interpreted client feedback
- `app/feedback/[projectId]/page.tsx` — Public client-facing feedback portal

Your job is to complete the integration end-to-end.

---

## Task 1 — Add feedback section to the client dashboard

File: `app/dashboard/page.tsx`

After the existing "Recent Transactions" card, add a new "Your Feedback" card:

```tsx
// Fetch feedback for this client's projects
const feedbackRes = await fetch(`/api/feedback?projectId=${clientProjectId}`)
// clientProjectId should come from the client's Firestore doc
```

The card should:
- Show a count of open feedback items submitted by this client
- Show the most recent 3 feedback items with status badges (open/resolved)
- Show a "Submit new feedback" button that links to `/feedback/[projectId]`
- Each feedback item should show: summary text, urgency badge, category pill, and created date

Look at the existing Card components in the dashboard for styling patterns — match the existing design.

---

## Task 2 — Chrome Extension install flow (easy one-click)

Create: `app/api/extension/check/route.ts`

This endpoint checks if the Readyaimgo Chrome extension is installed by:
1. Accepting a POST with `{ extensionId: string }`
2. Returning `{ installed: boolean }`

Note: Real extension detection happens client-side. This endpoint exists as a fallback signal.

Then update `app/feedback/[projectId]/page.tsx`:

In the extension step (step === "extension"), add detection logic:
```tsx
// Check if extension is already installed
useEffect(() => {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage(
      EXTENSION_ID,
      { type: 'ping' },
      (response) => {
        if (response?.installed) setExtensionInstalled(true)
      }
    )
  }
}, [])
```

If the extension is already installed:
- Skip the install step and show "Extension active — visit your site and click the toolbar icon"
- Show a green checkmark badge on the extension card in the chooser

If NOT installed:
- Show the "Add to Chrome" button prominently
- Below it, show these exact steps with checkmarks that appear as the user completes each:
  1. Click "Add to Chrome" above
  2. Click "Add extension" in the popup
  3. Visit your website
  4. Click the Readyaimgo icon in your toolbar

After install, the extension should send a message to the feedback API automatically with:
```json
{ "projectId": "<from URL>", "source": "extension", "installed": true }
```

---

## Task 3 — Pulse sync endpoint

Create: `app/api/pulse/route.ts`

This endpoint is called by raCommand (the iOS/macOS Swift app) to get a priority signal
for each project based on open client feedback.

GET `/api/pulse?projectIds=id1,id2,id3`

Returns:
```json
{
  "signals": [
    {
      "projectId": "abc123",
      "openFeedbackCount": 3,
      "maxPulseScore": 9,
      "hasHighUrgency": true,
      "latestSummary": "Client reported the contact form is broken on mobile",
      "lastActivity": "2026-04-11T20:00:00Z"
    }
  ]
}
```

Implementation:
- Query `clientFeedback` collection in Firestore for each projectId where status == "open"
- Aggregate: count, max pulseScore, any urgency=="high", latest summary, latest timestamp
- Return sorted by maxPulseScore descending
- Use Firebase Admin SDK (same pattern as `app/api/feedback/route.ts`)

---

## Task 4 — Loom video thumbnail preview

In `app/feedback/[projectId]/page.tsx`, when a Loom URL is submitted:
1. Extract the Loom video ID from the URL (format: `https://www.loom.com/share/{videoId}`)
2. Show a thumbnail preview using: `https://cdn.loom.com/sessions/thumbnails/{videoId}-with-play.gif`
3. Show the thumbnail before the submit button so the client can confirm it's the right video

---

## Task 5 — Environment variables needed

Add these to `.env.local` and `env.example` if not already present:

```
OPENAI_API_KEY=sk-...          # for AI feedback interpretation
FIREBASE_PROJECT_ID=...        # already exists
FIREBASE_CLIENT_EMAIL=...      # already exists  
FIREBASE_PRIVATE_KEY=...       # already exists
NEXT_PUBLIC_EXTENSION_ID=...   # Chrome extension ID from Web Store
```

---

## Task 6 — Firestore security rules update

Add these rules to allow the feedback collection to be written by anyone (public form)
but only read by authenticated admin:

```javascript
match /clientFeedback/{feedbackId} {
  // Anyone can submit feedback (no auth required for public form)
  allow create: if true;
  // Only authenticated users can read or update
  allow read, update: if request.auth != null;
}

match /ragProjects/{projectId} {
  // Only admin can read/write project metadata
  allow read, write: if request.auth != null && request.auth.uid == request.resource.data.adminUid;
}
```

---

## What NOT to change
- Do not modify `app/api/stripe/` routes
- Do not modify `app/api/beam-coin/` routes
- Do not modify `components/auth/AuthProvider.tsx`
- Do not modify `lib/firebase/config.ts`
- Keep all existing dashboard cards — only add the new feedback card at the bottom

---

## Testing checklist
After completing all tasks, verify:
- [ ] `POST /api/feedback` with rawText returns an AI interpretation
- [ ] `GET /api/feedback?projectId=test` returns an array
- [ ] `GET /api/pulse?projectIds=test` returns a signals array
- [ ] `/feedback/test-project-id` loads without auth and shows all three feedback methods
- [ ] Submitting a note shows the AI interpretation on the success screen
- [ ] The "Add to Chrome" button on the extension step links to the correct store URL
- [ ] Dashboard feedback card appears below transactions card
