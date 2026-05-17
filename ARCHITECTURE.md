# 🏗️ TurkGateWay — System Architecture

> A cloud-native, AI-powered guidance platform for navigating Turkish bureaucracy. Built with Next.js 16, FastAPI, and deployed on Vercel + Supabase (PostgreSQL).

---

## 📐 High-Level Overview

```mermaid
graph TB
    subgraph CLIENT["🌐 Client (Browser)"]
        UI["Next.js 16 Frontend\n(React 19 + TypeScript)"]
    end

    subgraph VERCEL["☁️ Vercel (Serverless)"]
        NEXT["Next.js Server\n(SSR / Static Pages)"]
        API["FastAPI Backend\n/api/* — Serverless Functions"]
    end

    subgraph SUPABASE["🗄️ Supabase (PostgreSQL)"]
        DB[("Primary Database\nUsers · Sessions · Messages\nLearning Responses")]
        VEC[("pgvector\nKnowledge Base\nRAG Chunks")]
    end

    subgraph GOOGLE["🤖 Google AI"]
        GEMINI["Gemini 2.0 Flash\nLLM Inference"]
    end

    UI -- "HTTPS Requests" --> NEXT
    UI -- "REST /api/*" --> API
    API -- "SQLAlchemy ORM" --> DB
    API -- "Vector Search" --> VEC
    API -- "AI Fallback Calls" --> GEMINI

    style CLIENT fill:#1e293b,color:#94a3b8,stroke:#334155
    style VERCEL fill:#0f0f23,color:#818cf8,stroke:#4f46e5
    style SUPABASE fill:#0f2a1a,color:#4ade80,stroke:#16a34a
    style GOOGLE fill:#1c1917,color:#fb923c,stroke:#ea580c
```

---

## 🧠 Backend Architecture — Smart Router Pipeline

Every user message passes through a **4-layer cost-optimization pipeline** before ever touching the AI.

```mermaid
flowchart TD
    MSG(["💬 User Message"]) --> SR

    subgraph SR["Smart Router Pipeline"]
        direction TB
        L1["① Cache Layer\nIn-Memory LRU (6h TTL)\ncache.py"] -->|MISS| L2
        L2["② Keyword Router\nRegex Intent Matching\nkeyword_router.py"] -->|NO MATCH| L3
        L3["③ Learning Cache\nFuzzy-Match Learned Responses\nlearning_cache.py"] -->|MISS| L4
        L4["④ RAG Retrieval\nVector DB Knowledge Chunks\nrag.py"] -->|NOT FOUND| L5
        L5["⑤ AI Fallback\nGemini 2.0 Flash\nai_fallback.py"]
    end

    L1 -->|HIT 🟢 0 tokens| RES
    L2 -->|HIT 🟢 0 tokens| RES
    L3 -->|HIT 🟢 0 tokens| RES
    L4 -->|HIT 🟡 0 tokens| RES
    L5 -->|GENERATED 🔴 tokens| LEARN["📚 learn()\nSave to DB + Memory"]

    LEARN --> RES(["📤 Response to User"])

    style L1 fill:#14532d,color:#86efac,stroke:#16a34a
    style L2 fill:#14532d,color:#86efac,stroke:#16a34a
    style L3 fill:#713f12,color:#fde68a,stroke:#d97706
    style L4 fill:#713f12,color:#fde68a,stroke:#d97706
    style L5 fill:#7f1d1d,color:#fca5a5,stroke:#dc2626
```

---

## 🤖 Agent System

Three specialized AI agents, each with a domain-specific knowledge library and roadmap generator.

```mermaid
graph LR
    subgraph AGENTS["AI Agents"]
        direction TB
        PA["🏢 Permit Agent\nBusiness permits, municipal\nlicenses, district-specific rules\nBusiness Types: Restaurant, Cafe,\nClinic, Pharmacy, Gym, Hotel..."]
        SA["🎓 Student Agent\nUniversity registration, Student ID\n(Kimlik / İkamet), visas,\nscholarships, dormitories"]
        LA["⚖️ Lawyer Agent\nCompany formation, contracts,\nemployment law, criminal cases,\nreal estate, dispute resolution"]
    end

    subgraph PROTOCOL["📋 Protocol Engine\nutils/protocol.py"]
        RMP["Deterministic Roadmap\nGenerator\nStep-by-Step Guides"]
    end

    subgraph CTX["🧩 Context Engine\ncontext_engine.py"]
        SLT["Slot Filling\nbusiness_type · district\nuniversity · legal_topic"]
        HST["History Compression\nRecent 8 messages → summary"]
    end

    PA & SA & LA --> CTX
    CTX --> RMP
    RMP --> STEPS["📍 Numbered Steps\nWith Documents · Costs\nTimelines · Office Locations"]

    style AGENTS fill:#1e1b4b,color:#a5b4fc,stroke:#4338ca
    style PROTOCOL fill:#0c0a09,color:#d6d3d1,stroke:#57534e
    style CTX fill:#0a0a0a,color:#d4d4d4,stroke:#404040
```

---

## 🗄️ Database Schema

```mermaid
erDiagram
    USERS {
        int id PK
        string email
        string full_name
        string hashed_password
        bool is_admin
        int token_balance
        bool mfa_enabled
        string google_id
    }

    CHAT_SESSIONS {
        string id PK
        int user_id FK
        string title
        string assistant_type
        string dashboard_state
        string service_id
        string service_slots
        string language
        bool is_favorite
        datetime created_at
    }

    CHAT_MESSAGES {
        int id PK
        string session_id FK
        string role
        text content
        datetime timestamp
    }

    LEARNING_RESPONSES {
        int id PK
        string query
        text response
        string assistant_type
        string intent
        string language
        int usage_count
        datetime created_at
    }

    KNOWLEDGE_BASE {
        int id PK
        string agent_type
        string topic
        text content
        vector embedding
        datetime created_at
    }

    USERS ||--o{ CHAT_SESSIONS : "has"
    CHAT_SESSIONS ||--o{ CHAT_MESSAGES : "contains"
```

---

## 🌐 Frontend Architecture

```mermaid
graph TD
    subgraph PAGES["📄 Next.js Pages"]
        HOME["/  — Landing Page"]
        CHAT["/chat  — AI Chat Interface"]
        SERV["/services  — Service Selector"]
        DASH["/dashboard  — User Dashboard"]
        ADM["/admin  — Admin Panel"]
        AUTH["/login · /signup"]
        SET["/settings  — MFA, API Keys"]
    end

    subgraph COMPONENTS["🧩 Shared Components"]
        NAV["Navbar"]
        SB["Sidebar\n(Chat History)"]
        LM["LoginModal\n(10-msg trigger)"]
        TT["ThemeToggle\n(Dark/Light)"]
    end

    subgraph CONTEXT["🔄 React Context"]
        AC["AuthContext\n(JWT, user state)"]
        LC["LanguageContext\n(EN / TR / AR)"]
    end

    subgraph UTILS["🛠️ Utilities"]
        API["api.ts\nDeduplicated Fetch\n+ Offline Detection"]
        TR["translations.ts\ni18n strings"]
    end

    CHAT --> SB & LM
    PAGES --> NAV & TT
    PAGES --> AC & LC
    PAGES --> API
    API --> BACKEND["FastAPI Backend\n(Vercel /api)"]

    style PAGES fill:#0f172a,color:#7dd3fc,stroke:#0284c7
    style COMPONENTS fill:#0f172a,color:#c4b5fd,stroke:#7c3aed
    style CONTEXT fill:#0f172a,color:#6ee7b7,stroke:#059669
    style UTILS fill:#0f172a,color:#fda4af,stroke:#e11d48
```

---

## 🚀 Deployment Architecture

```mermaid
graph TD
    DEV["👨‍💻 Developer\nLocal Dev (npm run server)"]

    subgraph GH["GitHub Repository"]
        MAIN["main branch"]
    end

    subgraph VERCEL_DEPLOY["☁️ Vercel"]
        direction LR
        VFE["Next.js Frontend\nSSR + Static Assets\nEdge Network CDN"]
        VBE["FastAPI Backend\nServerless Python Functions\n/api/* routes"]
    end

    subgraph SUPABASE_DEPLOY["🗄️ Supabase"]
        PG["PostgreSQL DB\nTransaction Pooler\n(5432 / 6543)"]
        PGVEC["pgvector Extension\nEmbedding Search"]
    end

    EXT["🌍 External Services\n• Google Gemini API\n• Google OAuth 2.0\n• iyzipay Payments"]

    DEV -->|"git push"| GH
    GH -->|"Auto Deploy"| VERCEL_DEPLOY
    VBE -->|"DATABASE_URL\n(env var)"| PG
    VBE -->|"Vector Search"| PGVEC
    VBE -->|"API Keys\n(env vars)"| EXT
    VFE -->|"NEXT_PUBLIC_API_URL=/api"| VBE

    style GH fill:#0d1117,color:#e6edf3,stroke:#30363d
    style VERCEL_DEPLOY fill:#0f0f23,color:#818cf8,stroke:#4f46e5
    style SUPABASE_DEPLOY fill:#0f2a1a,color:#4ade80,stroke:#16a34a
    style EXT fill:#1c1917,color:#fb923c,stroke:#ea580c
```

---

## 🔐 Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Next.js Frontend
    participant BE as FastAPI Backend
    participant DB as Supabase DB
    participant G as Google OAuth

    Note over U,G: Standard Email/Password Login
    U->>FE: Enter email
    FE->>BE: POST /auth/check-email
    BE->>DB: SELECT user WHERE email=?
    DB-->>BE: User found / not found
    BE-->>FE: 200 OK / 404 Not Found
    FE->>U: Show password field
    U->>FE: Enter password
    FE->>BE: POST /auth/login
    BE->>DB: Verify bcrypt hash
    BE-->>FE: JWT Access Token
    FE->>FE: Store token in localStorage

    Note over U,G: Google OAuth Flow
    U->>FE: Click "Continue with Google"
    FE->>G: OAuth Redirect
    G-->>FE: access_token
    FE->>BE: POST /auth/google {access_token}
    BE->>G: GET /oauth2/v3/userinfo
    G-->>BE: {email, name, picture}
    BE->>DB: Upsert user
    BE-->>FE: JWT Access Token
```

---

## 📦 Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | Next.js 16.1.6 + React 19 | SSR, routing, UI |
| **Styling** | Vanilla CSS + CSS Variables | Dark/Light theming |
| **Animations** | Framer Motion | Micro-animations |
| **Backend** | FastAPI (Python 3.11+) | REST API, agent orchestration |
| **AI Models** | Google Gemini 2.0 Flash | LLM inference |
| **AI Framework** | Pydantic-AI + LangGraph | Agent workflows |
| **Database ORM** | SQLAlchemy 2.0 | DB abstraction |
| **Database** | PostgreSQL (Supabase) | Primary data store |
| **Vector Search** | pgvector | RAG knowledge retrieval |
| **Auth** | JWT (PyJWT) + bcrypt | Stateless auth + password hashing |
| **OAuth** | Google OAuth 2.0 | Social login |
| **Payments** | iyzipay | Token billing |
| **Rate Limiting** | SlowAPI | API abuse prevention |
| **Hosting** | Vercel | Frontend + serverless backend |
| **Language** | TypeScript + Python | Type-safe full-stack |

---

## 🗂️ Monorepo Structure

```
turkgateway/
├── src/app/                    # Next.js frontend (App Router)
│   ├── chat/                   # Main AI chat interface
│   ├── services/               # Service selector page
│   ├── dashboard/              # User dashboard
│   ├── admin/                  # Admin panel
│   ├── components/             # Shared UI components
│   │   ├── Navbar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── LoginModal.tsx
│   │   └── ThemeToggle.tsx
│   ├── context/                # React Context providers
│   │   ├── AuthContext.tsx
│   │   └── LanguageContext.tsx
│   └── utils/
│       ├── api.ts              # Deduplicated fetch + offline detection
│       └── translations.ts     # i18n (EN / TR / AR)
│
├── backend/                    # FastAPI backend
│   ├── main.py                 # App entry point + all API routes
│   ├── database.py             # SQLAlchemy engine (SQLite → PostgreSQL)
│   ├── models/                 # ORM models
│   │   ├── user.py
│   │   ├── chat.py             # ChatSession, ChatMessage, LearningResponse
│   │   ├── knowledge_base.py
│   │   └── schemas.py
│   ├── agents/                 # Agent knowledge libraries
│   │   ├── permit/             # responses.json + learned/
│   │   ├── student/            # responses.json + learned/
│   │   ├── lawyer/             # responses.json + learned/
│   │   └── general/            # Greetings, identity responses
│   ├── smart_router/           # 5-layer intelligence pipeline
│   │   ├── __init__.py         # Main router orchestrator
│   │   ├── keyword_router.py   # Regex intent detection (0 tokens)
│   │   ├── cache.py            # In-memory LRU response cache
│   │   ├── learning_cache.py   # AI response persistence + fuzzy retrieval
│   │   ├── context_engine.py   # Session state, slot filling, history
│   │   ├── ai_fallback.py      # Gemini API calls (last resort)
│   │   ├── rag.py              # Vector similarity search
│   │   └── template_engine.py  # Response template rendering
│   └── utils/
│       └── protocol.py         # Deterministic roadmap step builders
│
├── api/
│   └── index.py                # Vercel serverless entrypoint
│
├── vercel.json                 # Vercel routing config
├── requirements.txt            # Python dependencies
└── package.json                # Node dependencies
```

---

## ⚡ Key Design Decisions

| Decision | Rationale |
|---|---|
| **Serverless (Vercel)** | Zero-cost scaling, no CPU instance needed, ephemeral execution |
| **PostgreSQL (Supabase)** | Replaces SQLite for data persistence across serverless invocations |
| **5-Layer Smart Router** | Aggressively reduces Gemini API token costs — most queries answered from cache/keywords |
| **Learning Cache → DB** | AI responses are saved to PostgreSQL so they survive Vercel's read-only filesystem |
| **File writes disabled on Vercel** | `VERCEL` env var gates all local JSON writes to prevent runtime errors |
| **Monorepo** | Frontend + Backend in one repo for unified deployment on Vercel |
| **Deterministic Roadmaps** | `protocol.py` generates step-by-step guides without LLM calls for known service types |
| **i18n (EN/TR/AR)** | Supports English, Turkish, and Arabic for Istanbul's international user base |
