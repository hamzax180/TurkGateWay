# TurkGateWay

TurkGateWay is a multilingual guidance and workflow platform for people navigating Turkish bureaucracy. It combines AI-assisted answers, grounded knowledge retrieval, deterministic application roadmaps, document checklists, workflow automation, authentication, payments, and human support in one Next.js application.

The product is designed for international residents, students, entrepreneurs, and families who need practical guidance in English, Turkish, or Arabic.

**Production:** [turkgateway.com](https://turkgateway.com)  
**Repository:** [github.com/hamzax180/TurkGateWay](https://github.com/hamzax180/TurkGateWay)  
**Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md)

> TurkGateWay provides informational and operational guidance. It is not a substitute for advice from a licensed lawyer, government office, accountant, or other qualified professional. Requirements, fees, appointment availability, and official procedures can change.

## Contents

- [Product capabilities](#product-capabilities)
- [Supported workflows](#supported-workflows)
- [How the system works](#how-the-system-works)
- [Technology](#technology)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Database and migrations](#database-and-migrations)
- [Development commands](#development-commands)
- [Testing and quality checks](#testing-and-quality-checks)
- [Deployment](#deployment)
- [Security and operations](#security-and-operations)
- [Contribution guidelines](#contribution-guidelines)
- [License](#license)

## Product capabilities

### AI guidance

- Qwen-powered conversations through Alibaba DashScope.
- Streaming responses over server-sent events so users can read answers as they are generated.
- Specialized routing for permit, student, legal, immigration, insurance, university, and related workflows.
- Native English, Turkish, and Arabic responses with localized interface content.
- Retrieval-augmented generation using PostgreSQL and pgvector knowledge chunks.
- Prompt-level scope and safety rules that keep answers focused on the selected service.

### Structured application workflows

- Deterministic, step-by-step roadmaps for supported services.
- Application sessions that preserve progress and selected service details.
- Document checklists, document uploads, extraction, and checklist status tracking.
- Guided intake flows for visa, residence, business, university, insurance, and criminal-law scenarios.
- Automation runs with visible status and progress where a supported process can be assisted.
- e-Devlet submission support and browser-automation integrations where configured.

### Accounts and payments

- Email and password authentication with bcrypt password hashing.
- JWT-based sessions and account endpoints.
- Google OAuth sign-in.
- Optional TOTP multi-factor authentication.
- Credit and subscription flows using iyzico when payment settings are configured.
- Optional Upstash Redis rate limiting.

### Support and administration

- Customer support tickets and queue management.
- Admin views for users, subscribers, sessions, statistics, and support tickets.
- API-key management for eligible accounts.
- Responsive interface with light and dark themes.

## Supported workflows

The application is organized around service-specific intake and guidance modules. The exact availability of a workflow depends on the current service configuration and required external integrations.

| Area | Examples |
| --- | --- |
| Business and permits | Company formation, municipal permits, restaurants, cafes, clinics, pharmacies, gyms, and hotels |
| Residence and immigration | Residence permit preparation, document requirements, appointment guidance, and application steps |
| Student services | University registration, student residence, scholarships, dormitories, and equivalency guidance |
| Visa applications | Guided applicant intake, document checklists, application progress, and appointment-related steps |
| Legal support | Employment, contracts, criminal matters, real estate, debt collection, and company questions |
| Insurance | Intake and guidance for supported insurance processes |
| University applications | Structured university data collection and next-step guidance |
| Customer support | Ticket creation, queue joining, status polling, and agent follow-up |

## How the system works

The browser uses the Next.js App Router interface and calls route handlers in the same deployment. AI conversations use an SSE stream; structured workflows use persisted application and session data.

```text
Browser
  |
  | HTTPS and SSE
  v
Next.js App Router
  |
  +-- Authentication and account routes
  +-- Chat and agent route
  +-- Application, document, support, payment, and admin routes
  |
  +--> PostgreSQL + pgvector
  |      users, sessions, messages, applications, documents,
  |      support tickets, service credits, knowledge articles,
  |      and embeddings
  |
  +--> Qwen / DashScope
  |      streaming generation and text embeddings
  |
  +--> Optional providers
         Google OAuth, iyzico, Upstash Redis, DeepSeek, Kilo
```

### Chat and roadmap flow

1. The user selects a service or starts a conversation.
2. The agent route identifies the active domain and language.
3. Relevant knowledge chunks are retrieved from pgvector when available.
4. Qwen streams the answer through the agent router.
5. When a structured application is appropriate, the model can request a roadmap tool.
6. The protocol layer builds a deterministic workflow state containing steps, documents, costs, timelines, and office details.
7. The client stores the state and presents the dashboard or next intake step.

Structured roadmaps are intentionally built by application code instead of generated as free-form JSON. This keeps the client contract stable and makes workflow progress testable.

### Stream contract

The chat client consumes a stream containing the following logical event types:

| Event | Purpose |
| --- | --- |
| `meta` | Initial source, session, and credit information |
| `delta` | Incremental assistant text |
| `dashboard` | Structured roadmap state ready for the client |
| `done` | Stream completed successfully |
| `error` | A recoverable or terminal generation error |

## Technology

| Layer | Technology |
| --- | --- |
| Application | Next.js 16.1.6, React 19.2, TypeScript 5 |
| UI | App Router, CSS variables, responsive CSS, Framer Motion, Lucide icons |
| Server APIs | Next.js route handlers and server-side modules |
| AI | Vercel AI SDK, Qwen through DashScope's OpenAI-compatible API |
| Embeddings | DashScope `text-embedding-v3` |
| Data | PostgreSQL on Neon or Supabase with pgvector |
| ORM and migrations | Drizzle ORM and SQL migration files |
| Authentication | `jose`, `bcryptjs`, Google OAuth |
| Payments | iyzico |
| Rate limiting | Upstash Redis and `@upstash/ratelimit` |
| Hosting | Vercel |

## Repository structure

```text
.
├── src/app/                    # Pages, layouts, components, and route handlers
│   ├── api/                    # Application, document, support, payment, and admin APIs
│   ├── agent/                  # AI agent query entry point
│   ├── applications/           # Application workflow UI
│   ├── chat/                   # Streaming chat interface
│   ├── dashboard/              # Roadmap and progress dashboard
│   ├── admin/                  # Administrative interface
│   ├── auth/                   # Authentication routes and account pages
│   ├── components/             # Shared product components
│   ├── context/                # Auth and language contexts
│   └── utils/                  # Client-side API and region helpers
├── src/lib/                    # AI, domain, auth, data, and integration logic
├── drizzle/migrations/         # Versioned database migrations and snapshots
├── scripts/                    # Database, embedding, automation, and smoke-test tools
├── public/                     # Static assets such as flags and sample files
├── desktop/                    # Optional Electron desktop shell
├── ARCHITECTURE.md             # Detailed diagrams and design decisions
├── drizzle.config.ts           # Drizzle configuration
├── next.config.ts              # Next.js configuration
└── package.json                # Scripts and dependencies
```

Important server-side modules include:

- `src/lib/agent-router.ts`: coordinates retrieval, prompts, model streaming, and roadmap tool calls.
- `src/lib/protocol.ts`: produces deterministic workflow and roadmap state.
- `src/lib/rag.ts`: creates embeddings and searches knowledge chunks.
- `src/lib/schema.ts`: defines the Drizzle database schema.
- `src/lib/auth.ts`: signs and verifies authenticated sessions.
- `src/lib/orchestrator.ts`: handles one-shot workflow automation generation.
- `src/lib/document-extract.ts`: extracts information from uploaded documents.

## Requirements

- Node.js 20 or newer is recommended for local development. Vercel currently runs the project on Node.js 24.
- npm.
- PostgreSQL with the `pgvector` extension. Neon and Supabase are supported deployment choices.
- A DashScope API key for AI generation and embeddings.
- Google OAuth credentials if Google sign-in is enabled.
- iyzico credentials if payments are enabled.
- Upstash Redis credentials if distributed rate limiting is enabled.

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/hamzax180/TurkGateWay.git
cd TurkGateWay
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create local configuration

```bash
cp .env.example .env.local
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env.local
```

Fill in the required values described in [Environment variables](#environment-variables). Never commit `.env.local` or any file containing credentials.

### 4. Prepare the database

The database must have pgvector enabled. For a new database, run:

```bash
node scripts/setup-pgvector.mjs
```

For an existing database with pending migrations:

```bash
npm run db:migrate:status
npm run db:migrate
```

### 5. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Copy `.env.example` as the source of truth. The following variables are currently used by the application.

### Required for core operation

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. The database must support pgvector. |
| `DASHSCOPE_API_KEY` | Server-side key for Qwen generation and embeddings. |
| `JWT_SECRET` | Secret used to sign and verify authenticated sessions. Use a long random value. |

### AI configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `QWEN_BASE_URL` | DashScope international endpoint | OpenAI-compatible Qwen endpoint. |
| `QWEN_MODEL` | `qwen3.8-max` | Main generation model. |
| `QWEN_EMBED_MODEL` | `text-embedding-v3` | Embedding model for knowledge retrieval. |
| `QWEN_VISION_MODEL` | `qwen-vl-max` | Vision model used for supported document extraction. |

### Application and authentication

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL, including the production domain for payment callbacks. |
| `NEXT_PUBLIC_API_URL` | API base URL. Leave empty when frontend and APIs share the same origin. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth client ID. |
| `LAWYER_CONTACT_EMAIL` | Optional contact shown for supported legal-intake escalation. |
| `LAWYER_CONTACT_PHONE` | Optional contact shown for supported legal-intake escalation. |

### Optional integrations

| Variables | Purpose |
| --- | --- |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Enable distributed rate limiting. |
| `IYZIPAY_API_KEY`, `IYZIPAY_SECRET_KEY`, `IYZIPAY_BASE_URL` | Enable iyzico payments. Use the sandbox URL during testing. |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL` | Enable the optional DeepSeek server-side proxy. |
| `KILO_API_KEY`, `KILO_BASE_URL`, `KILO_MODEL` | Enable the optional Kilo proxy. |
| `USE_DEEPSEEK_FOR_KILO` | Set to `true` to make the Kilo proxy default to DeepSeek. |

## Database and migrations

Database changes are represented by ordered SQL files in `drizzle/migrations`. The schema includes users, authentication state, chat sessions, messages, applications, documents, support tickets, service credits, knowledge articles, and vectorized knowledge chunks.

Common commands:

```bash
# Show migration status
npm run db:migrate:status

# Preview pending migrations
npm run db:migrate:dry

# Apply pending migrations
npm run db:migrate

# Open Drizzle Studio for inspection
npm run db:studio
```

Do not edit an already-applied migration in a shared environment. Add a new migration for every schema change, test it against a disposable or staging database, and verify both forward migration and application startup.

Knowledge retrieval requires valid embeddings. After changing knowledge content or embedding configuration, use the repository's re-embedding script and verify the vector dimension remains compatible with the database schema.

## Development commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create the optimized production build. |
| `npm run start` | Serve a previously built application. |
| `npm run lint` | Run ESLint. |
| `npm run db:migrate` | Apply pending SQL migrations. |
| `npm run db:migrate:status` | Inspect migration state. |
| `npm run db:migrate:dry` | Preview migrations without applying them. |
| `npm run db:studio` | Open Drizzle Studio. |
| `npm run check:uploads` | Exercise upload-related checks. |
| `npm run visa:find-slot` | Run the visa slot helper. |
| `npm run visa:watch` | Watch the visa automation helper. |

## Testing and quality checks

Before opening a pull request or deploying:

```bash
npm run lint
npm run build
```

For changes involving a specific workflow, also run its relevant smoke or integration script from `scripts/`. Tests that call external services require valid environment variables and should be run against sandbox or test accounts where available.

The production build performs TypeScript checking, route collection, and page generation. A successful build does not replace testing authenticated routes, database connectivity, provider credentials, payment callbacks, or browser automation.

## Deployment

The production application is hosted on Vercel at [turkgateway.com](https://turkgateway.com). The repository can be deployed through a connected Git branch or with the Vercel CLI.

### Vercel CLI deployment

Authenticate with the correct Vercel account, link the project if needed, then run:

```bash
vercel link
vercel --prod
```

The Vercel project must contain the production environment variables listed above. Environment variables are configured in Vercel under **Project Settings > Environment Variables** and are available to new deployments after saving. Redeploy after changing a variable that is needed at build or runtime.

### Production checklist

- Confirm `DATABASE_URL` points to the intended production database.
- Confirm pgvector is enabled and all migrations are applied.
- Set a strong production `JWT_SECRET` that is different from local development.
- Set `NEXT_PUBLIC_APP_URL=https://turkgateway.com`.
- Configure Google OAuth authorized origins and redirect settings for the production domain.
- Use production iyzico credentials and the production API base URL only when payments are ready.
- Confirm DashScope model access and usage limits.
- Enable Upstash rate limiting for public production traffic.
- Run `npm run build` before deployment.
- Test login, chat streaming, a representative workflow, document upload, and payment callbacks after deployment.

## Security and operations

- Keep all provider keys server-side. Only variables prefixed with `NEXT_PUBLIC_` should be exposed to the browser.
- Never commit `.env.local`, credentials, session tokens, uploaded private documents, or production database URLs.
- Treat uploaded documents and extracted data as sensitive user data.
- Use HTTPS in production and review OAuth callback domains whenever the deployment URL changes.
- Apply migrations deliberately and back up production data before destructive schema changes.
- Monitor model usage, database connection limits, rate-limit behavior, failed payment callbacks, and automation errors.
- Confirm that legal, immigration, financial, and government-process content is reviewed when official requirements change.

## Contribution guidelines

1. Create a focused branch for the change.
2. Keep domain logic in `src/lib` and route-specific HTTP behavior in `src/app/api`.
3. Prefer typed, deterministic workflow state over unvalidated model-generated structures.
4. Update migrations rather than editing production schema manually.
5. Add or update focused tests and documentation for behavior changes.
6. Run lint and the production build before submitting a pull request.
7. Do not include secrets or real user documents in commits, screenshots, fixtures, or logs.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for the full text.