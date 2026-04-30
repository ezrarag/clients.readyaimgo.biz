================================================================================
PROMPT C1 — clients.readyaimgo.biz: Organization Model + Multi-Member Access
Repo: clients.readyaimgo.biz (ezrarag)
Priority: HIGH — Rick/Solana meeting with boss next week
================================================================================

Migrate clients.readyaimgo.biz from single-user (clients/{email}) to an
organization model so multiple people from the same company (MKE Black, PaynePros,
etc.) can share one workspace with role-based access.

## New Firestore Schema

### organizations/{orgId}
{
  id: string,
  name: string,                    // "MKE Black"
  slug: string,                    // "mke-black" (used in URLs)
  plan: 'starter' | 'growth' | 'enterprise',
  stripeCustomerId: string | null,
  subscriptionId: string | null,
  status: 'active' | 'trial' | 'paused' | 'churned',
  createdAt: timestamp,
  createdByUid: string,
  city: string,
  website: string,
  logoUrl: string | null,
  onboardingNotes: string
}

### organizations/{orgId}/members/{uid}
{
  uid: string,
  email: string,
  name: string,
  role: 'owner' | 'admin' | 'viewer',
  joinedAt: timestamp,
  invitedBy: string | null
}

### organizations/{orgId}/projects/{projectId}
{
  id: string,
  name: string,                    // "Website Rebuild", "App Design"
  status: 'active' | 'paused' | 'complete',
  description: string,
  startDate: timestamp | null,
  targetDate: timestamp | null,
  ragLeadEmail: string,            // RAG team member assigned
  createdAt: timestamp
}

### organizations/{orgId}/files/{fileId}
{
  id: string,
  projectId: string | null,        // links to a project
  name: string,
  type: 'upload' | 'google_drive' | 'link',
  url: string,                     // storage URL or Drive link
  mimeType: string,
  uploadedByUid: string,
  uploadedAt: timestamp,
  extractedTasks: Task[],          // AI-extracted tasks (see Prompt C2)
  taskExtractionStatus: 'pending' | 'processing' | 'done' | 'failed' | null
}

### Task type (used inside files and projects)
{
  id: string,
  text: string,
  done: boolean,
  assignedTo: string | null,       // uid
  dueDate: string | null,
  priority: 'high' | 'medium' | 'low' | null,
  source: 'ai_extracted' | 'manual',
  createdAt: timestamp
}

## Migration: existing clients → organizations

Keep existing clients/{email} docs intact (backward compatible).
On first login after this change:
- Check if user's email already has an org (query members where email == user.email)
- If no org found AND clients/{email} exists: auto-create an org from their client doc
  - orgId = nanoid()
  - Copy name, companyName, plan, stripeCustomerId from client doc
  - Write user as owner in members subcollection
  - Update client doc with orgId field
- Redirect to /org/[orgId]/dashboard

## New URL structure
/org/[orgId]/dashboard          ← main workspace
/org/[orgId]/projects           ← project list
/org/[orgId]/projects/[id]      ← single project + files + tasks
/org/[orgId]/files              ← all files across projects
/org/[orgId]/settings           ← org settings, members, billing
/org/[orgId]/settings/members   ← invite/remove members

## Org dashboard (/org/[orgId]/dashboard)
- Header: org name + logo, plan badge, member count
- Project cards: name, status, file count, task completion %
- Recent activity feed: "Solana uploaded App Design Brief · 2 hours ago"
- Quick actions: "Upload file" | "Add project" | "Invite member"
- RAG notes feed (existing RagNotesFeed component) — filtered to this org

## Member invitation flow (/org/[orgId]/settings/members)
- List current members with role badge + remove button (owner only)
- "Invite member" form: email + role selector
- On submit:
  - Write invite doc to organizations/{orgId}/invites/{email}
    { email, role, invitedBy, invitedAt, status: 'pending' }
  - Send email via /api/invite (use existing mail collection pattern)
  - Invite link: /join?org={orgId}&token={inviteToken}
- Invited user clicks link → signs up or signs in → auto-joins org

## /join?org=...&token=... page
- If user signed in: show "Join [org name] as [role]" → one click to accept
- If not signed in: show signup form pre-filled, join on complete

## Firestore rules (replace existing client rules)
match /organizations/{orgId} {
  allow read: if isMember(orgId);
  allow create: if signedIn();
  allow update: if isOrgAdmin(orgId);
  allow delete: if isOrgOwner(orgId);
}
match /organizations/{orgId}/members/{uid} {
  allow read: if isMember(orgId);
  allow write: if isOrgOwner(orgId) || isOrgAdmin(orgId);
}
match /organizations/{orgId}/projects/{projectId} {
  allow read: if isMember(orgId);
  allow write: if isOrgAdmin(orgId);
}
match /organizations/{orgId}/files/{fileId} {
  allow read: if isMember(orgId);
  allow create: if isMember(orgId);
  allow update, delete: if isOrgAdmin(orgId);
}

Helper functions:
function isMember(orgId) {
  return signedIn() &&
    exists(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid));
}
function isOrgAdmin(orgId) {
  return isMember(orgId) &&
    get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.role in ['owner', 'admin'];
}
function isOrgOwner(orgId) {
  return isMember(orgId) &&
    get(/databases/$(database)/documents/organizations/$(orgId)/members/$(request.auth.uid)).data.role == 'owner';
}

## RAG admin view (/admin/organizations)
- List all orgs with: name, plan, member count, project count, last activity
- Click org → view their full workspace (read-only overlay)
- "Add RAG note" → writes to RagNotesFeed for that org
- Transfer org between plans
- All existing /admin routes remain unchanged


================================================================================
PROMPT C2 — clients.readyaimgo.biz: File Sharing + AI Task Extraction
Repo: clients.readyaimgo.biz (ezrarag)
Priority: HIGH — demo for Rick's boss meeting
Run AFTER Prompt C1 (requires organizations schema)
================================================================================

Add file upload, Google Drive link import, and AI-powered task extraction
to the client organization workspace.

## Part A — File Upload (Direct)

### Upload UI (component: OrgFileUpload)
- Drag-and-drop zone or click-to-browse
- Accept: .pdf, .docx, .txt, .md, .xlsx, .csv, .png, .jpg
- Show upload progress bar
- On complete: write to organizations/{orgId}/files/{fileId}
  with type: 'upload', url: Firebase Storage URL

### Storage path
org-files/{orgId}/{projectId ?? 'general'}/{timestamp}-{filename}

### File card display
Each file shows:
- Icon by type (pdf/doc/sheet/image)
- Filename + size
- Uploaded by + date
- Project badge (if linked)
- "Extract tasks" button (if .pdf/.docx/.txt)
- Task count badge once extracted
- Download link

## Part B — Google Drive Link Import

### Drive link input
Simple text field: "Paste a Google Drive share link"
- Validate URL is a drive.google.com link
- Write to files collection with type: 'google_drive', url: the link
- Show as a file card with Google Drive icon
- "Open in Drive" button

### Direct Drive browsing (if Google OAuth connected)
If admin has connected Google account (from Workspace prompt):
- "Browse Drive" button opens file list from Drive API
- Click file → imports metadata + link to files collection
- .xlsx files get "Import to project tasks" button

## Part C — AI Task Extraction (most important for the demo)

### API route: POST /api/org/extract-tasks
Server-side only. Body: { fileId, orgId }

Flow:
1. Fetch file from Firebase Storage (or read Google Drive export)
2. Extract text:
   - .pdf → use pdf-parse npm package
   - .docx → use mammoth npm package
   - .txt/.md → read directly
3. Send text to Claude API (Anthropic):

```typescript
const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01"
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: `Extract all action items, tasks, and to-dos from this document.
Return ONLY a JSON array of task objects. No preamble, no markdown fences.
Each task: { "text": string, "priority": "high"|"medium"|"low"|null, "dueDate": "YYYY-MM-DD"|null }
Infer priority from urgency language. Infer due dates from any date mentions.

Document:
${documentText.slice(0, 8000)}`
    }]
  })
});
```

4. Parse JSON response → write tasks to file doc:
   extractedTasks: tasks[], taskExtractionStatus: 'done'

5. Update file doc: taskExtractionStatus = 'done'

### "Extract tasks" button behavior (client)
- Click → POST to /api/org/extract-tasks with fileId + orgId
- Button shows spinner: "Reading document…" then "Extracting tasks…"
- On done: task list appears below the file card immediately
- On error: show "Extraction failed — try again" with retry button

### Task list UI (per file)
After extraction, show inline task list:
- Checkbox per task (click → toggles done: true/false, saves to Firestore)
- Task text
- Priority badge (high = red, medium = amber, low = gray)
- Due date if extracted
- "Assign to" dropdown → org members
- "Add task manually" button at bottom of list
- Task count in file card badge updates as tasks are completed

### Aggregated task view (/org/[orgId]/projects/[id])
Project page shows ALL tasks across ALL files in that project:
- Filter: all | incomplete | complete | assigned to me | high priority
- Sort: by due date | by priority | by file
- "Task progress": X of Y complete (progress bar)
- Each task row: checkbox | text | source file badge | assignee | due date

### Cross-project task view (/org/[orgId]/tasks)
All tasks across all projects for the org:
- Same filter/sort as project view
- Source project badge per task
- "My tasks" quick filter (tasks assigned to current user)

## Part D — Real-time sync

Use Firestore onSnapshot for:
- Task completion state (so when Rick checks a box, Solana sees it immediately)
- File list (new uploads appear without page refresh)
- RAG notes feed (your notes to them appear live)

## Env vars needed
ANTHROPIC_API_KEY   ← for task extraction
                       (already have Claude API access via Anthropic account)

## Demo script for Rick's boss meeting
1. Sign in as MKE Black org member
2. Upload the App Design Brief doc they shared
3. Click "Extract tasks" — watch AI pull action items from the doc in ~5 seconds
4. Check off a completed task — Rick and Solana see it update live
5. Show the project view — all tasks in one place with progress bar
6. Show the member list — rick@mkeblack.org + solana@mkeblack.org both in the org
7. Show RAG notes feed — your messages to them visible in their dashboard

This is the "wow" moment: they upload a Google Doc, AI reads it,
tasks appear, the whole team can manage them together.
RAG is not just building their website — RAG is their operating system.
