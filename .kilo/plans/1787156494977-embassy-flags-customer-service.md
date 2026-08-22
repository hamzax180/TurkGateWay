# Student Agency — fully AI-automated student services (agency-style)

## Goal
Make the Student Agent behave like a complete human student agency, fully
AI-run: collect the student's data once, then handle every task end-to-end —
visa, İkamet (new + renewal), Denklik, university placement, dormitory,
İstanbulkart, work permit — with status tracking and deadline reminders.

## Confirmed decisions (user)
1. **Portal automation line:** the AI does ALL paperwork (fills every form via
   runbooks, extracts passport/document data, prepares applications, tracks
   deadlines). The applicant only presses the final buttons / enters the SMS
   OTP on e-Devlet portals. **No credential storage, no auto-clicking
   government submit buttons** (current `edevlet-automation.ts` contract).
2. **Unified student file:** one profile per user — passport, education,
   contact, documents — collected once and reused across every task.
3. **Passport photo extraction:** Qwen-VL vision model via existing DashScope
   key (auto-save + echo for correction; manual typing stays as fallback).

## Current state (verified)
- Works: visa intake (`applications` kind `visa_appointment`), university
  intake + paid submission, e-İkamet runbook overlay in dashboard
  (`/api/submit-edevlet` → Qwen runbook, bot fills / user presses), criminal
  intake, support tools.
- Broken/blocking: AI SDK v6 `stopWhen` defaults to `stepCountIs(1)` so
  tool-only replies never get the model's follow-up question (agent "does
  nothing" after the user gives their name); DB is missing `applications`,
  `application_documents`, `credit_ledger`, `university_partners`,
  `application_submissions` tables (migrations 0002/0003 not applied).
- Missing: İkamet renewal intake, Denklik/dormitory/IstanbulKart pipelines,
  AI placement matching (partner registry is an empty placeholder), status
  tracking + deadline reminders, unified profile.

---

## Phase 0 — Unblock the agent (prerequisite for everything)

### P0.1 Apply DB migrations (mutation)
```
node scripts/apply-migration.mjs 0002_add_service_credits
node scripts/apply-migration.mjs 0003_add_applications
```
(`apply-migration.mjs` skips already-existing statements; never `db:push` on
this live DB.) Verify read-only: `applications`, `application_documents`,
`application_submissions`, `university_partners`, `credit_ledger` exist.

### P0.2 Tool-loop fix — `src/lib/agent-router.ts`
Import `stepCountIs` from `ai`; pass `stopWhen: stepCountIs(3)` in the
`callOptions` for `streamText` (normal + Turkmen paths). Fixes every
tool-based flow (intakes, support tools, roadmap follow-up).

### P0.3 Tool error guards — `src/lib/agent-router.ts`
Wrap `execute` bodies of `collectVisaApplication`,
`collectUniversityApplication`, `collectCriminalCase` in try/catch returning
`{ ok: false, message: 'Ask the user to try again in a moment.' }` so a DB
error never kills the stream.

### P0.4 No empty bubbles
- Server `src/app/agent/query/route.ts`: if the stream ends with empty text
  and no dashboard state, emit an `error` frame with a localized friendly
  message.
- Client `src/app/chat/page.tsx` (`send`): if `rawContent` is empty with no
  roadmap/error, replace the empty bubble with a short fallback line.

---

## Phase 1 — Unified student file (data layer)

### P1.1 New migration `0005_student_agency.sql` (write via drizzle-kit or handcrafted, applied with `apply-migration.mjs`)
- `student_profiles`: id, user_id (unique, FK `users.id` onDelete cascade),
  data JSON (passport/education/contact fields), status
  (`collecting | complete`), created_at, updated_at.
- `student_tasks`: id, user_id (FK), kind
  (`visa | ikamet_new | ikamet_renew | university | denklik | dormitory |
  istanbulkart | work_permit`), status
  (`created | in_progress | prepared | submitted | done`), data JSON,
  deadline_at (nullable), portal_ref text, created_at, updated_at.
- `student_documents`: id, user_id (FK), kind
  (`passport_photo | diploma | transcript | acceptance_letter | ...`),
  filename, mime_type, size_bytes, data bytea, uploaded_at.
- Add all three to `src/lib/schema.ts`.

### P1.2 Module `src/lib/student-file.ts`
`saveStudentFile` (merge-answers, blanks never erase), `readStudentFile`,
`missingStudentFields`, `storeStudentDocument`, `listStudentDocuments`.
Field vocabulary `src/lib/student-fields.ts`: union of
`visa-fields` + `university-fields` + İkamet extras (current permit number,
permit expiry, TCKN optional, address) — deduplicated, optional-merge like
the existing intakes. Shared by client checklist and server.

### P1.3 Tool `collect_student_file` in `agent-router.ts`
Student agent only. Saves answers to the profile, returns still-missing
labels. SSE event `student_file { collected, missing, status }` + client
handler mirrors the existing `visa_intake` pattern (labels only — never
values).

---

## Phase 2 — Passport photo extraction (Qwen-VL)

### P2.1 New `src/lib/passport-vision.ts`
`extractPassportData(bytes, mimeType)` → `{ fields: Partial<StudentFileData>,
isPassport: boolean } | null`. Data URL image part → `qwen(QWEN_VISION_MODEL ||
'qwen-vl-plus')` via existing provider; schema = the student-file fields;
instruction: "extract only what is visible, never invent; isPassport false if
not an ID". Any failure → `null` (manual fallback). Images only; PDFs skip.

### P2.2 Wire into upload path (`src/app/agent/query/route.ts`)
- Validate → if image: vision-extract first, then
  `storeStudentDocument(..., kind: 'passport_photo')` and
  `saveStudentFile(extracted fields)`; else store as today.
- `uploadNote` lists extracted labels, tells the model to confirm values with
  the user and ask only for the remaining fields.
- `application_documents.hasDocument` must only count `kind='acceptance_letter'`
  (a passport photo must not satisfy the visa document requirement).

### P2.3 Validate
Upload passport → agent echoes extracted values, asks for what's missing;
blurry image → graceful manual path; acceptance letter → unchanged behavior.

---

## Phase 3 — Task engine + İkamet new & renewal pipeline

### P3.1 Module `src/lib/student-tasks.ts` + tool `start_student_task`
Creates/updates a `student_tasks` row from the profile; returns the task
plan (required documents from the profile's documents, missing docs, portal
runbook trigger, deadline fields to collect).

### P3.2 Extend `src/lib/edevlet-automation.ts` + `/api/submit-edevlet`
Generalize the Qwen runbook builder (same bot-fills / user-presses contract,
static fallback per portal):
- `ikamet_new` (exists), `ikamet_renew` (Uzatma — exists, add renewal fields:
  current permit number, expiry, changed address), `denklik`
  (e-denklik.meb.gov.tr), `yosks` (university pre-registration), `kyk`
  (dormitory application window), `insurance` (exists).
- Dashboard runbook overlay already renders `bot_actions`/`user_actions`
  generically — no client rework beyond step status updates.

### P3.3 Status tracking + in-app reminders (no email/SMS infra)
`student_tasks.status` advances via runbook submissions; dashboard shows
task list + `deadline_at` badges (İkamet expiry, KYK window, visa appointment).
Student agent prompt gains a rule: check open tasks at conversation start and
flag deadlines.

---

## Phase 4 — AI university placement
- Tool `match_universities`: profile vs `university_partners` (active rows)
  → ranked matches; create `application_submissions` rows (status `draft`).
- Tool `prepare_application_packet`: build per-partner document checklist +
  filled form data from the profile; submission follows each partner's
  `apply_via` portal via the P3.2 runbook (user confirms), status →
  `submitted`.
- Replace the "human placement team" wording in the agent prompt with the AI
  pipeline; keep the one-credit gate (`submitUniversityApplication`) as today.
- **Data dependency:** `PARTNER_UNIVERSITIES` is empty. The engine works with
  whatever rows exist; seed a few partner rows for testing. Real agreements
  data entry is out of scope.

---

## Phase 5 — Remaining student services (runbooks + advisory)
- **Denklik:** P3.2 runbook + document validation (diploma/transcript uploads
  vision-checked for apostille + translation presence).
- **Dormitory (KYK):** window reminder + e-Devlet KYK runbook; advisory beyond.
- **İstanbulkart:** advisory pipeline only (app-based, no portal) — agent
  completes student certificate checklist after YÖKSİS.
- **Student work permit:** advisory + document prep (24h/week rule already in
  prompt). No legal filings.

---

## Phase 6 — Dashboard "Student Agency" view + validation
- Dashboard section: profile completeness, task cards (status, deadline,
  documents, runbook button), document list.
- `npm run lint`, `npm run build`.
- End-to-end checks: (1) name-message in visa flow replies with next question
  (P0 fixes), (2) passport upload auto-fills profile, (3) İkamet renewal
  runbook renders in dashboard, (4) placement matching with seeded partner
  row, (5) RTL (ar) + dark mode unbroken.

## Risks / notes
- Portal DOM changes break runbooks → static fallback + user_actions keep the
  flow alive; runbook notes tell the user what to expect.
- Vision latency 2–6 s/upload; best-effort with manual fallback.
- No email/SMS infra — reminders are in-app only (dashboard + chat).
- PII retention: `student_profiles`/`student_documents` cascade on user
  deletion; `student_tasks` too. Keep the existing purge pattern for
  `applications`.
- Migration 0005 applied with `apply-migration.mjs`; never `db:push` the live DB.

## Out of scope
Storing e-Devlet credentials or auto-clicking government submit buttons;
email/SMS notifications; entering real partner-university agreement data;
guaranteeing dormitory placements; work-permit legal representation.
