================================================================================
CLIENT INTAKE QUESTIONNAIRE SYSTEM
clients.readyaimgo.biz (ezrarag / readyaimgo-ab187)
3-prompt sequence — run in order, verify build passes between each
================================================================================

CONTEXT FOR ALL PROMPTS
─────────────────────────────────────────────────────────────────────────────
- Framework: Next.js 14 App Router, TypeScript strict
- Firebase project: readyaimgo-ab187
- Auth helper: getAuthenticatedBeamUser(request) from lib/firebase-admin.ts
- DB pattern: getAdminDb() server-side, getDb() + onSnapshot client-side
- Existing workspace page: app/workspace/[workspaceId]/page.tsx
- Existing admin page: app/admin/page.tsx
- Slack notify: app/api/slack/notify/route.ts
- Existing workspace page is large and has an existing Projects tab suggestion
  panel. Do not remove or rename that suggestion system.
- The old Files tab should be refactored into project cards before QI-2.
- BEAM admin role check: roles.includes("beam-admin")
- Run `npx tsc --noEmit` and
  `NODE_OPTIONS=--max-old-space-size=4096 npm run build` after each prompt
- Commit message format: "feat(QI-N): <description>" or
  "feat(QF-N): <description>"
================================================================================


================================================================================
PROMPT QI-1 — Firestore Schema + Admin UI: Questionnaire Builder
Priority: HIGH — foundation for QI-2
================================================================================

## Goal
Build the admin side of a client intake questionnaire system. Ezra creates
questionnaires from the admin panel, assigns them to a workspace, and clients
see them in their dashboard. Responses flow back to Firestore and trigger a
Slack notification to Ezra.

## 1. New Firestore schema

### workspaces/{workspaceId}/questionnaires/{questionnaireId}
```
{
  id: string,
  title: string,                     // e.g. "PaynePros Discovery — Phase 1"
  description: string | null,        // shown to client above questions
  status: "draft" | "active" | "closed",
  createdByUid: string,
  createdAt: Timestamp,
  clientLabel: string | null,        // e.g. "DeTania" — shown in greeting
  questions: Question[],             // ordered array, max 20
  completedAt: Timestamp | null,     // set when client submits
  completedByUid: string | null,
}
```

### Question type (embedded array, NOT a subcollection)
```
{
  id: string,                        // nanoid, 8 chars
  order: number,                     // 1-based display order
  type: "short" | "long" | "choice" | "multi" | "scale",
  text: string,                      // the question text
  required: boolean,
  options: string[] | null,          // for choice/multi types only
  scaleMin: number | null,           // for scale type (e.g. 1)
  scaleMax: number | null,           // for scale type (e.g. 10)
  scaleLabels: { min: string; max: string } | null,
  placeholder: string | null,        // hint text for short/long
}
```

### workspaces/{workspaceId}/questionnaires/{questionnaireId}/responses/{responseId}
One response doc per question submission (written on final submit, not per question):
```
{
  id: string,
  questionnaireId: string,
  workspaceId: string,
  submittedByUid: string,
  submittedAt: Timestamp,
  answers: Answer[],
}
```

### Answer type (embedded in responses doc)
```
{
  questionId: string,
  questionText: string,              // snapshot of question text at submit time
  type: Question["type"],
  value: string | string[] | number | null,
}
```

## 2. New lib/questionnaires.ts

Export these types and helpers:

```ts
export type QuestionType = "short" | "long" | "choice" | "multi" | "scale"

export interface Question {
  id: string
  order: number
  type: QuestionType
  text: string
  required: boolean
  options: string[] | null
  scaleMin: number | null
  scaleMax: number | null
  scaleLabels: { min: string; max: string } | null
  placeholder: string | null
}

export interface QuestionnaireDoc {
  id: string
  title: string
  description: string | null
  status: "draft" | "active" | "closed"
  createdByUid: string
  createdAt: string          // ISO
  clientLabel: string | null
  questions: Question[]
  completedAt: string | null
  completedByUid: string | null
}

export interface Answer {
  questionId: string
  questionText: string
  type: QuestionType
  value: string | string[] | number | null
}

export interface QuestionnaireResponse {
  id: string
  questionnaireId: string
  workspaceId: string
  submittedByUid: string
  submittedAt: string        // ISO
  answers: Answer[]
}

export function normalizeQuestionnaire(
  id: string,
  data: Record<string, unknown>
): QuestionnaireDoc { ... }

export function normalizeResponse(
  id: string,
  data: Record<string, unknown>
): QuestionnaireResponse { ... }

// Returns true if the questionnaire has been completed
export function isCompleted(q: QuestionnaireDoc): boolean {
  return q.completedAt !== null
}
```

## 3. New API routes

All routes use getAuthenticatedBeamUser(request) for auth.

### POST /api/workspaces/[workspaceId]/questionnaires
- Requires beam-admin
- Body: { title, description?, clientLabel?, questions: Question[], status? }
- Validates: title non-empty, questions array 1–20 items, each question has
  id (generate if missing via crypto.randomUUID().slice(0,8)), text, type
- Writes to workspaces/{workspaceId}/questionnaires/{auto-id}
- Sets createdByUid, createdAt: FieldValue.serverTimestamp(),
  completedAt: null, completedByUid: null, status: "draft" by default
- Returns { success: true, id }

### PATCH /api/workspaces/[workspaceId]/questionnaires/[questionnaireId]
- Requires beam-admin
- Body: partial QuestionnaireDoc fields (title, description, status, questions,
  clientLabel)
- Updates only provided fields
- Returns { success: true }

### DELETE /api/workspaces/[workspaceId]/questionnaires/[questionnaireId]
- Requires beam-admin
- Deletes the questionnaire doc (responses subcollection orphaned — OK)
- Returns { success: true }

### GET /api/workspaces/[workspaceId]/questionnaires/[questionnaireId]/responses
- Requires beam-admin
- Returns all docs from the responses subcollection
- Returns { responses: QuestionnaireResponse[] }

### POST /api/workspaces/[workspaceId]/questionnaires/[questionnaireId]/submit
- Requires workspace member (NOT beam-admin only — this is the client submitting)
- Body: { answers: Answer[] }
- Validates all required questions have a non-null, non-empty value
- Writes one doc to the responses subcollection
- Updates the questionnaire doc:
    completedAt: FieldValue.serverTimestamp()
    completedByUid: decodedToken.uid
    status: "closed"
- Fires Slack notification via the existing /api/slack/notify pattern
  (call the Slack webhook directly from this route, same pattern as other routes):
  event: "questionnaire_completed", include workspace name, client label,
  questionnaire title, and number of answers
- Returns { success: true }

## 4. Admin panel additions (app/admin/page.tsx)

Add a "Questionnaires" section to the admin workspace detail view. Per workspace:

### Questionnaire list
- Table of existing questionnaires: title, status badge, question count,
  completedAt (or "Pending" if null), Delete button
- Status badge colors: draft=gray, active=blue, closed=green

### "New Questionnaire" button → opens a Dialog/Sheet with:

**Step 1 — Basic info:**
- Title (text input, required)
- Client greeting name (text input, optional — e.g. "DeTania")
- Description (textarea, optional — shown to client above the form)
- Status (select: draft / active) — default draft

**Step 2 — Question builder:**
- List of questions with drag-handle (visual only, order by array index)
- Per question:
  - Type selector (short / long / choice / multi / scale)
  - Question text (textarea)
  - Required toggle
  - If type === "choice" or "multi": show options list with add/remove
  - If type === "scale": show min/max number inputs + label inputs
  - If type === "short" or "long": show placeholder text input
  - Delete question button
- "Add Question" button at bottom
- Min 1 question enforced

**Submit button:** POST /api/workspaces/[id]/questionnaires
On success: refetch questionnaire list, close dialog, show toast

### Response viewer
Click a closed questionnaire → opens a side panel or Dialog:
- Shows: submitted at, submitted by UID
- Per answer: question text, answer value (formatted nicely by type)
- "Export as text" button → copies a plain-text summary to clipboard:
  ```
  PaynePros Discovery — Phase 1
  Submitted: Jan 5 2026

  Q1: What accounting software do you currently use?
  A: QuickBooks Online

  Q2: ...
  ```
  This export is what Ezra pastes into a Claude or Codex session.

## 5. Extend Slack notify pattern

In the submit API route, POST to SLACK_WEBHOOK_URL directly with this payload:
```json
{
  "text": "📋 *Questionnaire Completed*\n*Client:* {clientLabel}\n*Workspace:* {workspaceName}\n*Form:* {questionnaireTitle}\n*Answers:* {count} responses submitted\n_Open admin panel to view responses._"
}
```

## 6. Firestore rules TODO (append to TODO.md, do NOT edit firestore.rules)

```
# Add to firestore.rules after QI-1 deploys:
#
# match /workspaces/{workspaceId}/questionnaires/{qId} {
#   allow read: if isWorkspaceMember(workspaceId) || isAdmin();
#   allow create, update, delete: if isAdmin();
# }
# match /workspaces/{workspaceId}/questionnaires/{qId}/responses/{rId} {
#   allow read: if isAdmin();
#   allow create: if isWorkspaceMember(workspaceId);
# }
```

## Acceptance criteria
- `npx tsc --noEmit` passes
- `npm run build` passes
- Admin can create a questionnaire with multiple question types
- Admin can set status to "active"
- Admin can view submitted responses and use the text export


================================================================================
PROMPT QF-1 — Client Dashboard: Move Files Into Projects
Priority: HIGH — run after QI-1 and before QI-2
================================================================================

## Goal
Move workspace files out of the top-level Files tab and into the Projects tab.
Files should become project-scoped context, while existing unassigned uploads
remain visible in a General Files section below the project cards.

Important:
- Do not remove, rename, or regress the existing Projects tab suggestion panel.
- Do not change Firebase Storage paths unless absolutely necessary.
- Keep existing uploaded files readable. Existing records without projectId
  should show under General Files.

## 1. Extend workspace file metadata

In lib/workspace-files.ts:
- Add `projectId: string | null` to the WorkspaceFile type.
- Update `normalizeWorkspaceFile()` so missing, non-string, or empty projectId
  normalizes to null.
- Preserve all existing fields and behavior.

In app/api/workspaces/[workspaceId]/files/route.ts:
- Accept optional `projectId` on POST body.
- Store normalized `projectId` on the Firestore file record.
- Keep projectId optional. Do not require it for old/general uploads.

## 2. Remove Files as a top-level workspace tab

In app/workspace/[workspaceId]/page.tsx:
- Remove the top-level `TabsTrigger value="files"`.
- Remove the top-level `TabsContent value="files"` only after its upload/list
  behavior has been moved into Projects.
- Do not replace Files with Intake in this prompt. Intake is added by QI-2 as
  a separate `value="intake"` tab.

## 3. Add ProjectFilesPanel inside the Projects tab

Add a small inline component near the bottom of app/workspace/[workspaceId]/page.tsx:

```tsx
function ProjectFilesPanel({
  project,
  files,
  uploading,
  uploadProgress,
  onUpload,
}: {
  project: WorkspaceProject
  files: WorkspaceFile[]
  uploading: boolean
  uploadProgress: number | null
  onUpload: (projectId: string) => void
}) {
  // Collapsible/expandable panel.
  // Show file cards filtered to this project.
  // Include an Upload button that calls onUpload(project.id).
}
```

Use the existing file-card/download UI patterns already present in the old
Files tab. Do not invent a second file card design.

Render `ProjectFilesPanel` at the bottom of each project card in the Projects
tab, below project-specific sections and below the existing Suggest a change
button/panel controls.

## 4. Route uploads to a selected project

The existing file input/upload handler should accept an optional projectId.

Required behavior:
- Uploading from a project card sends `{ projectId: project.id }` to
  `/api/workspaces/[workspaceId]/files`.
- Uploading from General Files sends no projectId, or sends projectId null.
- After upload, merge the returned file into the existing `files` state.
- Project file lists filter with `file.projectId === project.id`.
- General Files filters with `!file.projectId`.

## 5. Add General Files section below project cards

Below the project-card grid and before the Project Suggestions card:
- Show "General Files" for files with `projectId === null`.
- Include a general Upload button for unassigned workspace files.
- Keep existing empty, loading, download, size, and uploaded-at states.

## 6. Acceptance criteria

- `npx tsc --noEmit` passes.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build` passes.
- No top-level Files tab remains.
- Project cards each have a file section.
- Uploading inside a project creates a file record with projectId.
- Old files with no projectId still appear under General Files.
- The Projects tab suggestion panel still works.
- No questionnaire UI is added in this prompt.


================================================================================
PROMPT QI-2 — Client Dashboard: Intake Tab (Questionnaire UI)
Priority: HIGH — depends on QI-1 and QF-1
================================================================================

## Goal
Add a new Intake tab to the client workspace page. The Intake tab shows the
active questionnaire, if any, as a polished one-question-at-a-time card flow and
shows completed state once submitted.

Important:
- Do not rename or reuse the old Files tab.
- Do not use `value="files"` for Intake.
- Add Intake as a new tab with `value="intake"`.
- QF-1 should already have moved Files into Projects and removed the top-level
  Files tab.
- Do not remove or rename Projects, Updates, or the existing project suggestion
  panel.

## 1. Add Intake tab trigger and content

In app/workspace/[workspaceId]/page.tsx:
- Add a new `<TabsTrigger value="intake">Intake</TabsTrigger>` near the
  Projects/Updates tabs.
- Add a new `<TabsContent value="intake">...</TabsContent>`.
- The tab value string must be `"intake"`.
- Do not add questionnaire UI under Projects and do not add it under any files
  UI.

## 2. Add questionnaire state and data fetching

Add to the workspace page component:

```ts
const [questionnaires, setQuestionnaires] = useState<QuestionnaireDoc[]>([])
const [questionnairesLoading, setQuestionnairesLoading] = useState(true)
```

Add a useEffect subscribing to:
collection(db, "workspaces", workspaceId, "questionnaires")
where status in ["active", "closed"], ordered by createdAt desc, limit 5.

On snapshot: normalize with normalizeQuestionnaire, setQuestionnaires,
setQuestionnairesLoading(false). Cleanup on unmount.

Derive:
```ts
const activeQuestionnaire = questionnaires.find(q => q.status === "active") ?? null
const completedQuestionnaires = questionnaires.filter(q => q.status === "closed")
```

## 3. Add unread/attention badge to Intake tab trigger

Show a dot badge on the Intake TabsTrigger when there is an active
questionnaire that has not been completed (completedAt === null):

```tsx
<TabsTrigger value="intake">
  Intake
  {activeQuestionnaire && !isCompleted(activeQuestionnaire) && (
    <span className="ml-1.5 h-2 w-2 rounded-full bg-amber-400 inline-block" />
  )}
</TabsTrigger>
```

## 4. Questionnaire UI — render inside `TabsContent value="intake"`

### When there is NO active questionnaire and NO completed ones:
Show a soft placeholder card:
```tsx
<Card className="border-dashed">
  <CardContent className="py-8 text-center text-sm text-muted-foreground">
    No intake form yet. Ezra will send one when it's time to gather
    information about your project.
  </CardContent>
</Card>
```

### When there IS an active questionnaire (not yet completed):
Render `<IntakeQuestionnaire questionnaire={activeQuestionnaire} workspaceId={workspaceId} user={user} />`

Define IntakeQuestionnaire as a component at the bottom of the file
(outside the main component):

```tsx
function IntakeQuestionnaire({
  questionnaire,
  workspaceId,
  user,
}: {
  questionnaire: QuestionnaireDoc
  workspaceId: string
  user: User   // Firebase User type
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[] | number | null>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const questions = questionnaire.questions.sort((a, b) => a.order - b.order)
  const currentQuestion = questions[currentIndex]
  const isLast = currentIndex === questions.length - 1
  const progress = Math.round(((currentIndex) / questions.length) * 100)

  function setAnswer(value: string | string[] | number | null) {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: value }))
  }

  function canAdvance(): boolean {
    if (!currentQuestion.required) return true
    const val = answers[currentQuestion.id]
    if (val === null || val === undefined) return false
    if (typeof val === "string") return val.trim().length > 0
    if (Array.isArray(val)) return val.length > 0
    return true
  }

  async function handleSubmit() {
    // Build Answer[] from state
    const answerArray: Answer[] = questions.map((q) => ({
      questionId: q.id,
      questionText: q.text,
      type: q.type,
      value: answers[q.id] ?? null,
    }))

    setSubmitting(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const res = await fetch(
        `/api/workspaces/${workspaceId}/questionnaires/${questionnaire.id}/submit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ answers: answerArray }),
        }
      )
      if (!res.ok) throw new Error("Submission failed")
      setSubmitted(true)
    } catch (e: any) {
      setError("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted || isCompleted(questionnaire)) {
    return (
      <Card className="border-green-200 bg-green-50/40">
        <CardContent className="py-10 text-center space-y-2">
          <div className="text-3xl">✅</div>
          <p className="font-semibold text-green-800">
            {questionnaire.clientLabel
              ? `Thanks, ${questionnaire.clientLabel}!`
              : "Thanks for completing the form!"}
          </p>
          <p className="text-sm text-muted-foreground">
            Ezra has been notified and will follow up shortly.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{questionnaire.title}</CardTitle>
        {questionnaire.description && (
          <CardDescription>{questionnaire.description}</CardDescription>
        )}
        {/* Progress bar */}
        <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Question {currentIndex + 1} of {questions.length}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Question text */}
        <p className="text-sm font-medium leading-relaxed">
          {currentQuestion.text}
          {currentQuestion.required && (
            <span className="ml-1 text-red-500">*</span>
          )}
        </p>

        {/* Answer input — varies by type */}
        {currentQuestion.type === "short" && (
          <Input
            placeholder={currentQuestion.placeholder ?? "Your answer"}
            value={(answers[currentQuestion.id] as string) ?? ""}
            onChange={(e) => setAnswer(e.target.value)}
          />
        )}
        {currentQuestion.type === "long" && (
          <Textarea
            placeholder={currentQuestion.placeholder ?? "Your answer"}
            value={(answers[currentQuestion.id] as string) ?? ""}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
          />
        )}
        {currentQuestion.type === "choice" && currentQuestion.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((opt) => (
              <button
                key={opt}
                onClick={() => setAnswer(opt)}
                className={cn(
                  "w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors",
                  answers[currentQuestion.id] === opt
                    ? "border-primary bg-primary/5 font-medium"
                    : "border-border hover:border-primary/50"
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        )}
        {currentQuestion.type === "multi" && currentQuestion.options && (
          <div className="space-y-2">
            {currentQuestion.options.map((opt) => {
              const selected = ((answers[currentQuestion.id] as string[]) ?? []).includes(opt)
              return (
                <button
                  key={opt}
                  onClick={() => {
                    const current = (answers[currentQuestion.id] as string[]) ?? []
                    setAnswer(
                      selected ? current.filter((v) => v !== opt) : [...current, opt]
                    )
                  }}
                  className={cn(
                    "w-full text-left px-4 py-2.5 rounded-lg border text-sm transition-colors",
                    selected
                      ? "border-primary bg-primary/5 font-medium"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {opt}
                </button>
              )
            })}
          </div>
        )}
        {currentQuestion.type === "scale" && (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              {Array.from(
                { length: (currentQuestion.scaleMax ?? 10) - (currentQuestion.scaleMin ?? 1) + 1 },
                (_, i) => (currentQuestion.scaleMin ?? 1) + i
              ).map((n) => (
                <button
                  key={n}
                  onClick={() => setAnswer(n)}
                  className={cn(
                    "h-10 w-10 rounded-lg border text-sm font-medium transition-colors",
                    answers[currentQuestion.id] === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            {currentQuestion.scaleLabels && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{currentQuestion.scaleLabels.min}</span>
                <span>{currentQuestion.scaleLabels.max}</span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
          >
            ← Back
          </Button>
          {isLast ? (
            <Button
              size="sm"
              disabled={!canAdvance() || submitting}
              onClick={handleSubmit}
            >
              {submitting ? "Submitting…" : "Submit →"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!canAdvance()}
              onClick={() => setCurrentIndex((i) => i + 1)}
            >
              Next →
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
```

### Completed questionnaires
If completedQuestionnaires.length > 0, show a small section:
```tsx
<div className="mt-4 space-y-2">
  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
    Completed Forms
  </p>
  {completedQuestionnaires.map((q) => (
    <div key={q.id}
         className="flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm">
      <span className="font-medium">{q.title}</span>
      <span className="text-xs text-muted-foreground">
        {q.completedAt ? new Date(q.completedAt).toLocaleDateString() : ""}
      </span>
    </div>
  ))}
</div>
```

## 5. Imports needed in the workspace page

Add to imports:
```ts
import type { QuestionnaireDoc, Answer } from "@/lib/questionnaires"
import { normalizeQuestionnaire, isCompleted } from "@/lib/questionnaires"
```

Shadcn components already in the file — verify before adding:
Input, Textarea, Button, Card, CardContent, CardHeader, CardTitle,
CardDescription, Badge. Add any missing ones from @/components/ui/...

## Acceptance criteria
- `npx tsc --noEmit` passes
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build` passes
- Intake appears as a separate tab with value "intake"
- No top-level Files tab exists after QF-1
- Amber dot appears on tab when active questionnaire is pending
- All 5 question types render correctly
- Progress bar advances per question
- Back/Next navigation works, required validation blocks Next
- Submit calls /submit route, shows thank-you card on success
- Slack notification fires on submit
- Completed questionnaires appear in the "Completed Forms" list


================================================================================
PAYNEPROS DISCOVERY QUESTIONNAIRE — SEED DATA
================================================================================
Use this to create the first questionnaire for DeTania via the admin panel
after QI-1 and QI-2 are deployed. Copy these questions into the builder.

Title: "PaynePros Client Discovery — Phase 1"
Client greeting name: "DeTania"
Description: "Hi DeTania! These questions help Ezra and the RAG team build
your PaynePros portal around how you actually work. Take your time — there
are no wrong answers."
Status: active (set immediately so DeTania sees it on login)

Questions:

1. [short] What accounting software do you currently use most?
   (e.g. QuickBooks Online, QuickBooks Desktop, Wave, spreadsheets)
   Required: yes

2. [choice] How do most of your clients currently send you documents?
   Options: Email attachments | Client portal (current) | Physical drop-off | Mix of all
   Required: yes

3. [multi] Which of these would save you the most time if automated?
   Options:
   - Sending client intake reminders
   - Collecting signed engagement letters
   - Chasing missing tax documents
   - Categorizing expenses / flagging commingled funds
   - Sending invoices and payment reminders
   - Scheduling appointments
   Required: yes

4. [scale 1–5] How comfortable are your clients with technology?
   Scale labels: min="Very traditional / prefer paper", max="Very tech-savvy"
   Required: yes

5. [short] What is the biggest bottleneck in your current workflow?
   Placeholder: "e.g. clients missing deadlines, missing documents, too many emails..."
   Required: yes

6. [choice] Do you want clients to be able to pay invoices directly through the portal?
   Options: Yes, absolutely | Maybe later | No, I handle payments separately
   Required: yes

7. [long] Is there anything you wish your current software did that it doesn't?
   Placeholder: "Any features, reports, or automations you've always wanted..."
   Required: no

8. [short] What is your busiest season? (e.g. Jan–April for tax season)
   Required: yes

9. [multi] Which notification types should the portal send to your clients?
   Options:
   - Document request reminders
   - Appointment confirmations
   - Invoice due reminders
   - Portal message from you
   - Task completed confirmations
   Required: yes

10. [long] Anything else you want Ezra to know before we start building?
    Placeholder: "Open floor — anything about your practice, your clients, or your goals..."
    Required: no

================================================================================
END OF QUESTIONNAIRE PROMPTS
================================================================================
