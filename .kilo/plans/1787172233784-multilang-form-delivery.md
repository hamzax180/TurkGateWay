# Multi-language agents · chat auto-fill · document delivery

## Goal
1. **Every listed language fully works.** All 9 languages (en, tr, ar, tk, az, uz, kk, fa, ru) get real support everywhere — chat replies, roadmaps, document checklists, confirm dialogs, citations — with no English fallbacks.
2. **Agents extract user info from chat** (and uploaded documents) to auto-fill official application forms: İkamet (new + renewal), visa appointment, health insurance, university application, business permit.
3. **Agents deliver the final document.** The user downloads the official processed document from their portal themselves; the app (a) generates a filled replica PDF delivered as a downloadable file in chat, and (b) shows an animated indicator in the dashboard runbook overlay showing exactly where the download button is on the official portal (e-İkamet / visa / SGK).

## Confirmed decisions (user)
- "Every language" = the 9 languages already listed in the app. Not new languages, not auto-detect beyond the list.
- "Fetch info" = fetch the user's data **from the client chat conversation + uploaded documents** to fill forms automatically. No external web scraping/search.
- Final document = the one the user downloads from their own portal; the app adds the animated download-location sign + a filled replica PDF in chat.
- Services needing forms: İkamet (new + renewal), visa appointment, health insurance, university application packet, business permit packet.
- Generated PDFs are free (they format data the user already gave — no credit, same rule as intake).

## Current state (verified)
- `Lang` union already has all 9 languages (`src/lib/prompts.ts:12`), but:
  - `roadmapSummary` maps az→tr, uz→tk, kk→tk, fa→ar, ru→en (`src/lib/agent-router.ts:185`) — English/Turkish leakage.
  - `protocol.ts` step text only exists in en/tr/ar/tk (`type Lang` there is 4 codes).
  - Citation labels only cover en/tr/ar/tk (`src/app/agent/query/route.ts:282`).
  - UI rides `LANGUAGE_BASE` (`src/app/context/LanguageContext.tsx:12`) for the 5 extra languages.
- No `stopWhen` in `agent-router.ts` — AI SDK v6 defaults to `stepCountIs(1)`, so tool-only replies never get the model's follow-up question.
- Intakes exist for visa / university / criminal (merge-blank pattern, SSE events, `VisaIntakeCard` UI). No intake for İkamet, insurance, or business permit.
- `application_documents` stores uploads (PDF/JPG/PNG ≤ 5 MB, 30-day purge). Assistant-side file delivery does not exist.
- `edevlet-automation.ts` builds the e-İkamet runbook (bot fills / user presses); dashboard overlay animates the PRESS buttons. No download-button step. `/api/submit-edevlet` also has static insurance + MERSİS branches.
- Migrations 0002–0004 present in `drizzle/migrations/meta/_journal.json`; schema has `applications`, `application_documents` tables. `ApplicationKind` = `'visa_appointment' | 'university' | 'criminal_case'` (`src/lib/schema.ts:150`).

---

## Phase 0 — Prerequisites

- **P0.1** `src/lib/agent-router.ts`: import `stepCountIs` from `ai`; pass `stopWhen: stepCountIs(3)` in the `streamText` `callOptions` (normal path) and in the Turkmen retry path (`generateValidatedTurkmen` receives the same options). Without this every new tool flow is broken.
- **P0.2** Verify migrations are applied on the live DB with `scripts/apply-migration.mjs` (0002, 0003, 0004). Never `db:push`.
- **P0.3** Add dependency `pdf-lib` (`npm i pdf-lib`) — used in Phase 4.

## Phase 1 — All 9 languages everywhere

- **P1.1** `src/lib/prompts.ts`: delete the `BASE_LANG` fallback concept; add real translations of `roadmapSummary` for az, uz, kk, fa, ru in `agent-router.ts` (keep `byLang` complete for all 9). Extend the citation label map in `src/app/agent/query/route.ts` to all 9 languages.
- **P1.2** `src/lib/protocol.ts` + `agent-router.ts`: keep deterministic en/tr/ar/tk texts. Add `localizeWorkflow(state, lang)` in a new small module (e.g. `src/lib/workflow-localize.ts`): when `lang` ∈ {az, uz, kk, fa, ru}, make ONE Qwen call that translates every text field (step titles/notes/docs, summary, documents) natively, returns the same structure. On failure, fall back to the current BASE_LANG mapping. Wire it into `buildRoadmap` — only for the paid, confirmed roadmap (the free `previewDocuments` path stays synchronous/untouched). Follow the TURKMEN_ANCHOR pattern: add short anti-drift anchors for az, uz, kk (false friends vs Turkish/Russian) in `languageDirective`.
- **P1.3** Client strings: ensure the confirm-credit dialog, intake cards, and roadmap dashboard render for the 5 extra languages (extend `LANGUAGE_BASE` keys or add per-lang label maps in the field-list files). Chat bubbles must use `dir="auto"` (ar/fa already RTL; verify ru/uz/kk unaffected).
- **P1.4** Validate: 9-language matrix — send the same question ("What do I need to upload for university registration?") in each language and confirm a native, non-English reply; build a roadmap in az and ru and confirm native step text.

## Phase 2 — New intake pipelines (extract from chat → auto-fill forms)

Follow the exact visa-intake pattern (`src/lib/visa-fields.ts` + `visa-intake.ts`): field vocabulary in one module (no DB imports), persistence in another, merge-blank semantics, `applications` row per session+kind.

- **P2.1** `src/lib/ikamet-fields.ts` + `src/lib/ikamet-intake.ts`. Fields: passport_no, nationality, dob, father_name, mother_name, gender, passport_type, email, phone, address_in_tr; renewal extras: permit_no, permit_expiry, address_changed. Kind `'ikamet'`.
- **P2.2** `src/lib/insurance-fields.ts` + `insurance-intake.ts` (SGK student health insurance): personal fields (reuse list) + university, enrollment_date, start_month. Kind `'insurance'`.
- **P2.3** `src/lib/business-fields.ts` + `business-intake.ts`: business_name, activity (NACE), district, address, owner_passport_or_tckn, phone, email, lease_status. Kind `'business'`.
- **P2.4** Schema: extend `ApplicationKind` (`src/lib/schema.ts:150`) with `'ikamet' | 'insurance' | 'business'` (varchar — no DDL change needed) and add the doc kinds to the comment.
- **P2.5** `src/lib/agent-router.ts`: add tools `collect_ikamet_application`, `collect_insurance_application` (student agent) and `collect_business_application` (permit agent), mirroring `collectVisaApplication` (sign-in guard, merge-blank, stillNeeded). Add SSE events `ikamet_intake`, `insurance_intake`, `business_intake` and client handlers + cards mirroring `VisaIntakeCard` (`src/app/chat/page.tsx:2597`).
- **P2.6** Document extraction: add `src/lib/passport-vision.ts` (Qwen-VL via existing DashScope provider): on image upload, extract passport fields into the ikamet/visa intake; on any failure → manual typing fallback. Wire into `src/app/agent/query/route.ts` upload path. `hasDocument` must keep counting only `kind='acceptance_letter'` for visa readiness.

## Phase 3 — Document checklists ("what do I need to upload?")

- **P3.1** `src/lib/document-checklists.ts`: deterministic checklist catalog keyed by service — university registration, student visa, ikamet new, ikamet renewal, health insurance, denklik, dormitory (student); restaurant/cafe, retail, office/service, company formation, work permit (permit). Each item: `{ title, whereToGet, format }` in en/tr/ar/tk. Items come from the existing prompt knowledge (acceptance letter, apostilled diploma, passport, 4 photos, bank statement, insurance policy, rental contract, tax number, lease, floor plan, etc.).
- **P3.2** Tool `get_document_checklist({ service })` (student + permit agents, free): returns the checklist; the model renders it in the user's language (it translates the 5 extra languages itself) and explains where each document comes from. SSE event `document_checklist` so the client can render a checklist card with upload chips (MVP: model renders the list in chat + a simple card; per-item upload wiring is optional).
- **P3.3** Agent prompts (`src/lib/prompts.ts`): rule for student + permit personas — when the user names a service, give the upload list FIRST, then start collecting.

## Phase 4 — Generated documents delivered in chat

- **P4.1** `src/lib/form-docs.ts` (pdf-lib): builders for — İkamet başvuru formu (first + extension), visa appointment form packet, SGK health insurance form, university application packet, business permit packet. Each is a filled replica of the official form layout using the saved intake data; blank fields show as "—". Same fill-then-print look, no logos claimed.
- **P4.2** Storage: save generated PDFs into `application_documents` with kinds `generated_form` (per service filename). Existing purge/retention rules apply unchanged.
- **P4.3** Delivery route `src/app/api/documents/[id]/route.ts`: JWT auth, owner-or-same-session check, `Content-Disposition: attachment`.
- **P4.4** Tool `deliver_form` (per agent): when intake is complete (or user explicitly asks), build the PDF, store it, return `{ filename, url }`; the model announces it in the user's language. `agent/query/route.ts` emits a new SSE frame `attachment { filename, url }` after the tool runs.
- **P4.5** Client: assistant bubble renders a downloadable file chip (FileText icon, name, download button) from the `attachment` frame. Persistence: migration `0005_chat_attachments.sql` adding nullable `attachment_id` + `attachment_filename` to `chat_messages` so history re-renders the file (bubble shows link if the document row was purged).

## Phase 5 — Animated download-location sign in the portal flow

- **P5.1** `src/lib/edevlet-automation.ts`: extend `PortalRunbook` with `download_actions: Array<{ id; label; hint; when }>`. Static entries: e-İkamet first + extension ("after APPLY, the Başvuru formu appears — İNDİR button at top-right of the summary page"), visa ("after the appointment is booked, download the appointment form from the appointments list"), SGK ("the policy document is under e-Devlet → SGK → Belgelerim"). Qwen runbook prompt gains the same field.
- **P5.2** Dashboard overlay (`src/app/dashboard/page.tsx` runbook section): after the last `user_actions` press, show an animated step — pulsing download icon + arrow, the button label, and the location hint — then a final step telling the user to re-upload the downloaded official document into chat with the + button so the agent files it with their application.
- **P5.3** `/api/submit-edevlet` returns `download_actions`; client passes them into the runbook state.

---

## Validation
- `npm run lint` and `npm run build` (both must pass).
- Language matrix (P1.4): 9 languages × chat reply + one paid roadmap in az/ru.
- İkamet flow end-to-end: chat intake (name → passport → address) → checklist card fills → `deliver_form` puts a PDF chip in chat → dashboard runbook ends with the animated download-location step.
- Business flow: business intake in tr, checklist for restaurant, generated permit packet PDF.
- Visa flow regression: acceptance letter upload still drives readiness; generated PDF does not satisfy `hasDocument`.
- Security: `/api/documents/[id]` returns 404/403 for other users; purge still runs; no credentials stored anywhere.

## Risks / notes
- Qwen localization quality for az/uz/kk/fa/ru roadmaps is imperfect → BASE_LANG fallback keeps the flow alive.
- pdf-lib is small and serverless-safe; PDFs are ≤ a few hundred KB.
- Portal UIs change → download hints are generic ("top-right of the summary page") and phrased as guidance, not exact pixels.
- Do not overlap with the older plan (`.kilo/plans/1787156494977-embassy-flags-customer-service.md`): that one owns the unified student file, placement matching and KYK/Denklik pipelines. This plan only adds the intakes/checklists/forms listed above and reuses its passport-vision idea.

## Out of scope
- Languages beyond the 9 listed; auto-detection of new languages.
- External web scraping/search.
- Storing portal credentials or auto-clicking portal submit buttons (existing contract).
- Email/SMS notifications; charging credits for generated PDFs.
