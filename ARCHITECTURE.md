# 🏗️ TurkGateWay — System Architecture

> An AI-guided platform for navigating Turkish bureaucracy — visa appointments,
> residence permits, university placement, SGK insurance and business licences.
> Next.js 16 (App Router) end to end, Qwen via Alibaba DashScope for generation,
> Neon PostgreSQL with pgvector for storage and retrieval, deployed on Vercel.

**Scale:** 33,317 lines of TypeScript · 61 route handlers · 16 pages · 15 tables · 9 languages.

---

## 📐 High-Level Overview

There is no separate backend service. Every server-side concern is a Next.js
route handler running on the Node runtime, with one Edge middleware in front of
all of them.

```mermaid
graph TB
    subgraph CLIENT["🌐 Browser"]
        UI["React 19 · Next.js 16<br/>16 pages · SSE client"]
    end

    subgraph VERCEL["☁️ Vercel"]
        MW["Edge Middleware<br/>middleware.ts — rate-limit policy"]
        RT["Route Handlers<br/>61 routes · Node runtime"]
    end

    subgraph DATA["🗄️ Neon PostgreSQL"]
        DB[("15 tables<br/>users · sessions · messages<br/>credits · applications · tickets")]
        VEC[("pgvector<br/>knowledge_chunks<br/>vector(768)")]
    end

    subgraph EXT["🔌 External services"]
        QWEN["Alibaba DashScope<br/>qwen3.8-max · text-embedding-v3"]
        OAI["OpenAI<br/>Realtime voice · TTS"]
        IYZ["iyzico<br/>HMAC-signed checkout"]
        RED["Upstash Redis<br/>shared rate-limit state"]
    end

    UI -->|HTTPS| MW
    MW -->|allowed| RT
    MW -.->|"counters (optional)"| RED
    RT -->|Drizzle ORM| DB
    RT -->|raw SQL · cosine| VEC
    RT -->|streamText| QWEN
    RT -->|ephemeral session| OAI
    RT -->|verify + settle| IYZ
    RT -->|"SSE: text/event-stream"| UI

    style CLIENT fill:#1e293b,color:#94a3b8,stroke:#334155
    style VERCEL fill:#0f0f23,color:#818cf8,stroke:#4f46e5
    style DATA fill:#0f2a1a,color:#4ade80,stroke:#16a34a
    style EXT fill:#1c1917,color:#fb923c,stroke:#ea580c
```

> **Upstash is optional in code and effectively required in production.** When
> the two `UPSTASH_*` variables are absent, `rate-limit.ts` falls back to a
> per-process in-memory map. Each Vercel instance is its own process, so the
> ceilings become per-instance — see [Known gaps](#-known-gaps).

---

## 🛡️ Rate Limiting — one gate, not fifty-two

Enforcement lives in Edge middleware rather than in each handler. The previous
arrangement had a call in 4 of 52 routes, and the expensive ones were the ones
nobody remembered.

```mermaid
flowchart LR
    REQ([Request]) --> M{"policyFor(path, method)"}
    M -->|"exempt<br/>payment callback/webhook"| PASS([handler])
    M -->|tier| MIN{"minute window<br/>exceeded?"}
    MIN -->|yes| R429["429 + Retry-After"]
    MIN -->|no| DAY{"daily cap<br/>exceeded?"}
    DAY -->|yes| R429
    DAY -->|no| PASS

    style R429 fill:#450a0a,color:#fca5a5,stroke:#dc2626
    style PASS fill:#14532d,color:#86efac,stroke:#16a34a
```

Tiers are sized by what a request **costs to serve**, not by how it feels:

| Tier | Per minute | Per day | Covers |
|---|---:|---:|---|
| `browser` | 3 | 20 | Headless automation runs |
| `vision` | 10 | 60 | Document extraction |
| `llm` | 20 | 300 | `/agent/query`, İkamet automation |
| `auth` | 10 | — | Login, register, MFA verify |
| `authLight` | 30 | — | Session checks |
| `write` | 30 | — | Ordinary mutations |
| `admin` | 60 | — | Admin panel, LLM relay |
| `read` | 120 | — | Cheap reads |
| `poll` | 120 | — | Support queue, automation frames |
| `default` | 60 | — | Anything unmatched |
| *exempt* | ∞ | ∞ | Payment callback + webhook, by design |

Matching is first-wins, ordered most-specific to least. **An unmatched route
falls to `default`, so a route added tomorrow is metered without anyone wiring
it up** — that is the property the table exists to guarantee.

Identity is user id for a signed-in caller (verified with `jose` in the Edge
runtime, no database round trip) and IP otherwise, so sharing an office NAT does
not halve anyone's budget.

---

## 🧠 The hot path — `POST /agent/query`

The only streaming endpoint, and the most expensive. Two routes reach an answer;
both emit the same frame vocabulary, so the client never branches on which one
replied.

```mermaid
flowchart TD
    IN([POST /agent/query]) --> AUTH["getOptionalUser — guests allowed"]
    AUTH --> QUOTA{"question quota<br/>25 free / 100 paid"}
    QUOTA -->|exhausted| E403["403 + reset time"]
    QUOTA -->|ok| UP{"file attached?"}
    UP -->|yes| STORE["storeDocument()<br/>validate · store · refresh readiness"]
    UP -->|no| ROUTE
    STORE --> ROUTE{"service chip?<br/>'X - New Application in Y'"}

    ROUTE -->|yes| PROTO["📋 protocol.ts · buildWorkflow()<br/>deterministic · 0 tokens"]
    ROUTE -->|no| RAG["📚 rag.ts · retrieveChunks()<br/>grounding passages"]
    RAG --> QWEN["🤖 Qwen streamText<br/>tools: start_roadmap, intake, deliver_form"]

    PROTO --> SSE([SSE frames])
    QWEN --> SSE
    SSE --> FIN["finally — after the stream closes"]

    style PROTO fill:#14532d,color:#86efac,stroke:#16a34a
    style RAG fill:#713f12,color:#fde68a,stroke:#d97706
    style FIN fill:#1e3a5f,color:#93c5fd,stroke:#3b82f6
```

### Stream contract

Frames consumed by `src/app/chat/page.tsx`:

| Event | Payload | Meaning |
|---|---|---|
| `meta` | `{ source, token_balance, session_title }` | Sent immediately, before any text |
| `delta` | `{ t }` | A chunk of reply text |
| `dashboard` | `{ state }` | Roadmap ready |
| `visa_intake` | `{ collected, missing, … }` | Intake progress — **field labels only, never answers** |
| `university_intake` · `ikamet_intake` · `insurance_intake` · `business_intake` | same shape | Per-service intake progress |
| `document_checklist` | `{ service, items }` | Free upload checklist |
| `attachment` | `{ filename, url }` | A generated form PDF |
| `confirm_required` | `{ pending }` | Model wants to build a roadmap; no credit spent yet |
| `done` / `error` | `{}` / `{ detail }` | Terminal |

### Charging happens last, on purpose

The question quota is debited and the transcript persisted inside a `finally`,
and only when `fullText` is non-empty. A stream that dies halfway costs the user
nothing. If a **service credit** was spent and the stream then failed, it is
returned via `refundCredit()`.

---

## 📚 Retrieval (RAG)

```mermaid
flowchart LR
    Q([User query<br/>any of 9 languages]) --> E["embed()<br/>text-embedding-v3 · 768d"]
    E --> S["pgvector cosine &lt;=&gt;<br/>filtered by agent_type · top 3"]
    S --> T{"similarity ≥ 0.35?"}
    T -->|yes| P["injected into system prompt<br/>+ cited to the user"]
    T -->|no| U["answer ungrounded"]

    style P fill:#14532d,color:#86efac,stroke:#16a34a
```

**Every failure path returns an empty array rather than throwing.** A DashScope
embedding outage costs the answer its citations, never the answer itself.
Concrete Turkish facts (fee ranges, portals, timelines) live in `prompts.ts` as
the knowledge floor, so replies stay grounded even when retrieval returns
nothing.

---

## 💳 Billing — purchases, then credits

Service credits replaced the old subscription binary. **One credit buys one
finalised roadmap.** Chat is unaffected and stays on the free question quota.

### Settlement: two public doors, one locked gate

```mermaid
sequenceDiagram
    participant B as Browser / iyzico
    participant R as callback OR webhook
    participant S as settlePurchase()
    participant I as iyzico API
    participant D as Neon

    B->>R: POST (token, …)
    Note over R: body is untrusted —<br/>only `token` is read, as a lookup key
    R->>S: settlePurchase(token)
    S->>I: retrieveCheckout(token)
    I-->>S: status, paymentStatus, conversationId, paidPrice
    S->>S: gate 1 — provider says SUCCESS?
    S->>D: find purchase by provider-echoed conversationId
    S->>S: gate 2 — row exists?
    S->>S: gate 3 — paidPrice == amount_try_minor (integer kuruş)
    alt all gates pass
        S->>D: status = paid
        S->>D: grantCreditsForPurchase() — idempotent
    else any gate fails
        S->>D: status = failed — nothing minted
    end
```

Both entry points are unauthenticated by necessity: `/payment/callback` is a
redirect the customer's browser lands on, `/payment/webhook` is a server
notification. Neither is believed. Reading a user id out of the posted
`conversationId` once made this a free-money endpoint:

```
curl -X POST /payment/callback -d 'status=success&conversationId=tg-1-1'
```

The amount check is the subtle gate — without reconciling against the purchase
row created *before* checkout, a tampered form could pay ₺1 for a ₺1,750 plan
and clear every other check.

### Credit states

A credit is **one row, not a counter** — each needs its own expiry, provenance
and audit trail, which an integer on `users` cannot express.

```mermaid
stateDiagram-v2
    [*] --> reserved: family seat, owner NULL
    [*] --> owned: buyer's own credits
    reserved --> assigned: invite claimed
    assigned --> consumed: spend
    owned --> consumed: spend, SKIP LOCKED
    consumed --> refunded: generation failed
    refunded --> consumed: retried
    owned --> expired: 12 months
    assigned --> expired: 12 months
```

**Reserved credits are spendable by nobody.** That is what stops a family-plan
buyer from spending a seat they have already given away. Every transition
appends one row to `credit_ledger`, which is append-only and never updated —
and a ledger write failure is logged but never rolls back a real credit
movement.

Concurrency: `consumeCredit()` is a single conditional `UPDATE` whose sub-select
takes `FOR UPDATE SKIP LOCKED` and whose `WHERE` re-asserts
`consumed_at IS NULL`. Two simultaneous calls with one credit left produce
exactly one winner; the loser updates zero rows and gets `null`, which callers
must treat as a hard stop.

---

## 📄 Applications and document lifecycle

One table for every kind of work the platform takes on, distinguished by `kind`:
`visa_appointment` · `university` · `criminal_case` · `ikamet` · `insurance` ·
`business`. They share conversational intake, uploaded documents, a service
credit and an operator-moved status, so they share a table.

```mermaid
flowchart LR
    U([Upload<br/>pdf/jpeg/png · ≤5 MB]) --> V["validate + store<br/>bytea column"]
    V --> D["purge_after = now + 30 days"]
    D --> O["operator deletes on delivery<br/>purgeApplication()"]
    D --> X["daily sweep<br/>purgeExpired()"]
    C(["Vercel Cron 03:20 UTC"]) -->|"Bearer CRON_SECRET"| R["/api/cron/purge"]
    R --> X

    style O fill:#14532d,color:#86efac,stroke:#16a34a
    style X fill:#14532d,color:#86efac,stroke:#16a34a
    style R fill:#1e3a5f,color:#93c5fd,stroke:#3b82f6
```

These rows hold **passport-level PII and academic records**, so they are
short-lived by design: `purge_after` bounds how long a row may exist at all,
the operator deletes it outright once the work is delivered, and the daily
sweep is the backstop for anything abandoned mid-intake.

> The sweep route **refuses to run without `CRON_SECRET`** rather than falling
> back to unauthenticated. It deletes rows, so an open version of it is a
> denial-of-service against the applicants' own documents. `/api/health`
> reports whether it is armed.

Documents are kept in their own table rather than as a column on `applications`,
so listing an application never drags file bytes along with it. Downloads join
through to the owning application and answer **404, not 403**, for a foreign row
— the id space leaks nothing to an enumerator.

---

## 🗄️ Database Schema

15 tables. Grouped by concern; foreign keys shown for the relationships that
carry behaviour.

```mermaid
erDiagram
    USERS ||--o{ CHAT_SESSIONS : has
    USERS ||--o{ PURCHASES : makes
    USERS ||--o{ SERVICE_CREDITS : owns
    CHAT_SESSIONS ||--o{ CHAT_MESSAGES : contains
    CHAT_SESSIONS ||--o{ VOICE_CALL_TRANSCRIPTS : records
    CHAT_SESSIONS ||--o| SUPPORT_TICKETS : "is one ticket"
    CHAT_SESSIONS ||--o{ APPLICATIONS : "one per kind"
    PURCHASES ||--o{ SERVICE_CREDITS : mints
    PURCHASES ||--o{ FAMILY_INVITES : reserves
    SERVICE_CREDITS ||--o{ CREDIT_LEDGER : "audit trail"
    SERVICE_CREDITS ||--o| APPLICATIONS : "pays for"
    APPLICATIONS ||--o{ APPLICATION_DOCUMENTS : holds
    APPLICATIONS ||--o{ APPLICATION_SUBMISSIONS : "put forward to"
    UNIVERSITY_PARTNERS ||--o{ APPLICATION_SUBMISSIONS : receives
    KNOWLEDGE_ARTICLES ||--o{ KNOWLEDGE_CHUNKS : "split into"

    USERS {
        int id PK
        string email UK
        string hashed_password
        bool is_admin
        int token_balance "free question quota"
        string subscription_status
        string mfa_secret
        bool mfa_enabled
        string api_key UK
    }
    CHAT_SESSIONS {
        string id PK
        int user_id FK
        string assistant_type
        string dashboard_state
        string service_id
        string language
    }
    CHAT_MESSAGES {
        int id PK
        string session_id FK
        string role
        text content
        int attachment_id "→ application_documents"
        int transcript_id "→ voice_call_transcripts"
    }
    PURCHASES {
        int id PK
        int user_id FK
        string plan
        int amount_try_minor "kuruş — never a float"
        int credits_granted
        string conversation_id UK
        string status "pending|paid|failed"
    }
    SERVICE_CREDITS {
        int id PK
        int owner_user_id FK "NULL = reserved seat"
        int purchase_id FK
        string source "purchase|family"
        datetime expires_at
        datetime consumed_at "NULL = unspent"
    }
    APPLICATIONS {
        int id PK
        string kind
        string session_id FK
        string status
        text data "intake answers as JSON"
        int credit_id FK
        datetime purge_after "hard deletion deadline"
    }
    APPLICATION_DOCUMENTS {
        int id PK
        int application_id FK
        string kind
        string mime_type
        int size_bytes
        bytea data
    }
    KNOWLEDGE_CHUNKS {
        int id PK
        int article_id FK
        text chunk_text
        vector embedding "vector(768)"
    }
```

Not drawn, for legibility: `family_invites`, `credit_ledger`,
`voice_call_transcripts`, `support_tickets`, `university_partners`,
`application_submissions`, `knowledge_articles` — all present in
`src/lib/schema.ts` and related as the diagram's edges indicate.

> `embedding` is a native `vector(768)` column created by
> `scripts/setup-pgvector.mjs`. Drizzle has no vector type, so `rag.ts` queries
> it with raw SQL through the Neon template tag — the embedding and agent type
> are **bound parameters**, not interpolated text.

### Migrations

Ordered SQL files in `drizzle/migrations`, applied by `scripts/migrate.mjs`,
which records each one in a `_migrations` table so a second run is a no-op. It
exists because `drizzle-kit push` diffs and rewrites the database to match —
fine for a scratch database, wrong for one holding real applications.

```bash
npm run db:migrate:status   # applied vs pending
npm run db:migrate:dry      # preview, change nothing
npm run db:migrate          # apply
```

---

## 🔐 Authentication

```mermaid
flowchart TD
    L([POST /auth/login]) --> V{"bcrypt.compare<br/>cost 12"}
    V -->|no| F401([401])
    V -->|yes| M{"mfa_enabled?"}
    M -->|yes| T{"verifyTotp<br/>timingSafeEqual"}
    T -->|no| F401
    T -->|yes| SIGN
    M -->|no| SIGN["signToken — jose HS256 · 7d"]
    SIGN --> C([Bearer token to client])
    C --> API["every call: Authorization header"]
    API --> RU["requireUser / requireAdmin<br/>re-reads the row, checks is_active"]

    style F401 fill:#450a0a,color:#fca5a5,stroke:#dc2626
    style SIGN fill:#14532d,color:#86efac,stroke:#16a34a
```

Deliberate choices worth keeping:

- **Bearer header only.** Tokens in query strings leak into proxy logs, browser
  history and referrer headers. The query-param fallback the legacy backend used
  is gone.
- **Production hard-fails without `JWT_SECRET`.** Falling back to a public
  constant would let anyone forge tokens, including admin ones. Development
  keeps a loud fallback so local startup stays frictionless.
- **TOTP is dependency-free** (RFC 6238, ~90 lines in `auth.ts`), so the MFA
  check works against the same stored secrets the legacy `pyotp` backend wrote,
  without a new package.
- **`is_active IS NOT FALSE`**, not `= true`, so legacy rows with NULL keep
  working and only explicitly deactivated accounts are locked out.

---

## 📦 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 16.1.6 + React 19 | SSR, routing, UI |
| **Styling** | Vanilla CSS + CSS variables | Dark/light theming |
| **Animation** | Framer Motion | Micro-interactions |
| **Backend** | Next.js App Router route handlers | REST + SSE, agent orchestration |
| **Edge** | Next.js middleware | Rate-limit enforcement |
| **AI models** | Qwen `qwen3.8-max` via DashScope | Streaming inference |
| **AI framework** | Vercel AI SDK (`ai`, `@ai-sdk/openai-compatible`) | `streamText`, tool calling |
| **Embeddings** | DashScope `text-embedding-v3` (768d) | RAG vectors |
| **Voice** | OpenAI Realtime + TTS | Spoken intake calls |
| **ORM** | Drizzle | Schema + query building |
| **Database** | Neon PostgreSQL (serverless driver) | Primary data store |
| **Vector search** | pgvector | Knowledge retrieval |
| **Auth** | JWT (jose) + bcryptjs + TOTP | Stateless auth, MFA |
| **OAuth** | Google OAuth 2.0 | Social login |
| **Payments** | iyzico (HMAC-SHA256 signed) | Service-credit purchase |
| **Shared state** | Upstash Redis | Rate limits, support-queue claims |
| **Automation** | Playwright | Headless form filling |
| **Documents** | pdf-lib | Filled application PDFs |
| **Hosting** | Vercel | Edge + serverless functions |

---

## 🗂️ Repository Structure

```
bcb/
├── src/middleware.ts            # Edge rate-limit enforcement — runs before every API route
│
├── src/app/                     # App Router: pages AND route handlers
│   ├── agent/query/             # ⭐ The streaming endpoint
│   ├── auth/                    # login · register · google · mfa · api-key · account
│   ├── payment/                 # subscribe · callback · webhook
│   ├── chat/                    # Chat page + session/history handlers
│   ├── api/
│   │   ├── admin/               # stats · users · sessions · tickets · usage
│   │   ├── applications/        # checklist · details · automate · mine
│   │   ├── voice/               # realtime · tts · transcribe · transcript
│   │   ├── support/             # live-queue + tickets
│   │   ├── automation/          # headless run control
│   │   └── documents/[id]/      # owner-only download
│   ├── components/              # Shared UI
│   ├── context/                 # AuthContext · LanguageContext (9 languages)
│   └── utils/api.ts             # Deduplicated fetch + offline detection
│
├── src/lib/                     # Server-side domain logic
│   ├── agent-router.ts          # ⭐ Routing, RAG, Qwen streaming, tool handling
│   ├── protocol.ts              # Deterministic roadmap builders (no LLM)
│   ├── prompts.ts               # Personas, language directive, knowledge floor
│   ├── rag.ts                   # Embeddings + pgvector search
│   ├── qwen.ts                  # DashScope provider config
│   ├── credits.ts               # ⭐ Mint · spend · refund · family seats
│   ├── settle-purchase.ts       # ⭐ The only path to 'paid'
│   ├── iyzico.ts                # Signed provider calls + verification
│   ├── plans.ts                 # Plan catalogue (credits, price, seats)
│   ├── application-documents.ts # Upload validation, storage, retention
│   ├── *-intake.ts / *-fields.ts# Per-service intake state machines
│   ├── rate-limit.ts            # Limiter + Edge-safe identify()
│   ├── rate-limit-policy.ts     # ⭐ The tier table
│   ├── auth.ts                  # JWT · bcrypt · TOTP
│   ├── user-helper.ts           # requireUser / requireAdmin
│   ├── schema.ts                # Drizzle schema (15 tables)
│   └── db.ts                    # Neon serverless client
│
├── drizzle/migrations/          # Ordered SQL, applied by scripts/migrate.mjs
└── scripts/
    ├── migrate.mjs              # Migration runner (status / dry-run / apply)
    ├── setup-pgvector.mjs       # Enables pgvector, creates knowledge tables
    └── reembed-knowledge.mjs    # Re-embeds chunks with text-embedding-v3
```

---

## ⚡ Key Design Decisions

| Decision | Rationale |
|---|---|
| **No separate backend** | Route handlers are the backend. The Python/FastAPI service was removed; nothing depends on it. |
| **Rate limiting in middleware** | A per-handler call covered 4 routes out of 52, and the expensive ones were the omissions. One policy table means new routes are metered by default. |
| **Deterministic roadmaps** | `protocol.ts` builds step-by-step guides with **no LLM call**, so the Dashboard always receives a valid structure. Reached from service chips or Qwen's `start_roadmap` tool. |
| **Charge in `finally`** | The quota is debited after text has actually reached the user, so a failed stream is free. Credits spent on a failed roadmap are refunded. |
| **Credits as rows, not a counter** | Each credit carries its own expiry, provenance and audit trail. "3 credits, two expiring in March" is not expressible as an integer. |
| **Verify payments server-to-server** | The callback is public and its body attacker-controlled. `settlePurchase()` asks iyzico directly and reconciles the amount before minting. |
| **Money in integer minor units** | `amount_try_minor` is kuruş. Float rounding on money is a bug waiting for a decimal boundary. |
| **404, not 403, on foreign rows** | Distinguishing "not yours" from "does not exist" hands an enumerator a valid-id oracle. |
| **PII is short-lived by design** | Applications carry a hard `purge_after` deadline; documents live in a side table so reads never drag bytes along. |
| **Voice transcripts kept out of the thread** | Verbatim speech-recognition noise made threads unreadable *and* was replayed as model context on later questions. |
| **SSE streaming** | Text appears as generated rather than after the full response lands — which matters most for long roadmap explanations. |
| **No response cache** | The old key was `{agent}:{lang}:{query}` — shared across users and blind to history. Replies now depend on history, so caching them is incorrect. |
| **Fail open on limiter outage** | A Redis blip should not take down sign-in. The limiter is only as available as Upstash, and that trade is deliberate. |
| **9 languages** | en · tr · ar · tk · az · uz · kk · fa · ru — Turkmen needs output validation because Qwen intermittently leaks Turkish. |

---

## 🩹 Recently closed

Audited and fixed 22 August 2026. All were wiring gaps rather than design
flaws — the mechanisms existed and were correct; nothing called them.

| Was | Now |
|---|---|
| `purgeExpired()` had no caller; passport-level PII past its 30-day deadline was never swept | `POST /api/cron/purge`, run daily by Vercel Cron (`vercel.json`), authorised by a constant-time `CRON_SECRET` check. **Refuses to run rather than sweep unauthenticated.** |
| `/api/voice/*` fell through to `default` (60/min) while Realtime billed per minute of audio | Dedicated `voice` (5/min, 40/day) and `voiceTts` (60/min, 1500/day) tiers; reads of stored transcripts correctly stay on `read` |
| `next.config.ts` was empty — no security headers at all | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS, plus `no-store` on every `/api/*` response |
| Nothing to point uptime monitoring at | `GET /api/health` — probes the database for real, reports model/limiter/payments/cron configuration, and answers `degraded` when the limiter is per-process |
| `usage_events` existed in the database but not in `schema.ts`, so a `drizzle-kit push` would have offered to drop it | Declared in `schema.ts` with its three indexes |
| `_journal.json` stopped at 0006 while 0007–0009 existed as SQL | Journal now covers all ten migrations; `idx` sequential |
| No tests anywhere in the repository | `npm test` — 25 tests over TOTP (RFC 6238 vectors), money conversion, rate-limit tiers and plan invariants. Wired into CI. Zero new dependencies. |

## ⚠️ Still open

| Gap | Impact | Owner |
|---|---|---|
| **Upstash not configured** | The single largest exposure. Rate limits fall back to per-process memory, so on serverless every ceiling is per-instance — and `/agent/query` admits guests. `/api/health` reports `degraded` until this is set. | Set `UPSTASH_REDIS_REST_URL` + `_TOKEN` |
| **`CRON_SECRET` not set** | The retention sweep is built and scheduled but refuses to run without it. `/api/health` reports `retentionSweep: CRON_SECRET missing`. | `openssl rand -hex 32` → Vercel env |
| **Nothing writes `usage_events` yet** | The table and its schema declaration are in place, but no call site records to it, so model spend is still unmeasurable. | Instrument `agent-router.ts` |
| **No error monitoring** | No Sentry or OpenTelemetry; `console.*` is the only signal and ages out of Vercel retention. | — |
| **No Content-Security-Policy** | Deliberately deferred: the pricing page injects iyzico's checkout form via `dangerouslySetInnerHTML`, and a CSP without their origin list would break checkout. Needs the real origins from iyzico first. | — |
| **`src/app/chat/page.tsx` is 4,285 lines** | Holds the SSE client, every intake card, the voice UI and the roadmap renderer. Nothing is wrong with it; it is where the next bug will be hard to find. | — |
