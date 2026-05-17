<div align="center">

# 🇹🇷 TurkGateWay

**AI-powered bureaucratic guidance for navigating Turkey — business permits, student residency, and legal support, all in one place.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python%203.11-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-000?logo=vercel)](https://vercel.com)
[![Gemini](https://img.shields.io/badge/AI-Google%20Gemini%202.0-4285F4?logo=google)](https://ai.google.dev)

[Live Demo](https://turkgateway.vercel.app) · [Architecture Docs](ARCHITECTURE.md) · [Report a Bug](https://github.com/hamzax180/TurkGateWay/issues)

</div>

---

## 📖 What is TurkGateWay?

TurkGateWay is a multilingual AI platform (English · Turkish · Arabic) that helps foreigners, students, and entrepreneurs navigate Turkey's bureaucratic processes. Instead of spending weeks deciphering government websites, users chat with a specialized AI agent and receive a precise, numbered roadmap — documents, costs, office locations, and timelines included.

**Three specialized agents cover the most critical use cases:**

| Agent | Handles |
|---|---|
| 🏢 **Permit Agent** | Business licenses for all 39 Istanbul districts — restaurants, cafes, clinics, pharmacies, gyms, hotels, and more |
| 🎓 **Student Agent** | University registration, Student ID (Kimlik / İkamet), visas, scholarships, dorms, equivalency (Denklik) |
| ⚖️ **Lawyer Agent** | Company formation, contracts, employment law, criminal cases, real estate, debt collection |

---

## ✨ Features

- **🤖 Smart Router** — A 5-layer intelligence pipeline that answers most queries with **zero AI tokens** using keyword matching, LRU caching, and fuzzy-matched learned responses.
- **📋 Deterministic Roadmaps** — Structured, step-by-step permit and residency guides generated without LLM hallucination.
- **🧠 Self-Learning Cache** — AI responses are saved to PostgreSQL and reused on future similar queries, reducing costs over time.
- **🌍 Trilingual** — Full UI and agent responses in English, Turkish, and Arabic.
- **🔐 Secure Auth** — Email/password with bcrypt, MFA (TOTP), and Google OAuth 2.0.
- **🌙 Dark / Light Mode** — System-aware theming with smooth transitions.
- **📱 Mobile-First** — Fully responsive across all screen sizes.

---

## 🏗️ Architecture Overview

```
User Message
    │
    ▼
┌─────────────────────────────────────────────────┐
│              Smart Router Pipeline              │
│                                                 │
│  ① LRU Cache (6h TTL)        → 0 tokens        │
│  ② Keyword Router (regex)    → 0 tokens        │
│  ③ Learning Cache (fuzzy DB) → 0 tokens        │
│  ④ RAG / Vector Search       → 0 tokens        │
│  ⑤ Gemini 2.0 Flash (AI)     → tokens used ← saves to DB
└─────────────────────────────────────────────────┘
    │
    ▼
Context Engine → Slot Filling → Protocol Engine → Roadmap
```

> See [ARCHITECTURE.md](ARCHITECTURE.md) for full Mermaid diagrams covering the deployment topology, database schema, auth flow, and agent system.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16.1.6, React 19, TypeScript |
| **Animations** | Framer Motion |
| **Backend** | FastAPI (Python 3.11+) |
| **AI Engine** | Google Gemini 2.0 Flash |
| **AI Framework** | Pydantic-AI, LangGraph |
| **Database** | PostgreSQL via Supabase + pgvector |
| **ORM** | SQLAlchemy 2.0 |
| **Auth** | JWT (PyJWT), bcrypt, Google OAuth 2.0 |
| **Payments** | iyzipay |
| **Hosting** | Vercel (Frontend + Serverless API) |
| **Rate Limiting** | SlowAPI |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Python 3.11+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google Gemini API Key](https://ai.google.dev)

### 1. Clone the repository

```bash
git clone https://github.com/hamzax180/TurkGateWay.git
cd TurkGateWay
```

### 2. Configure environment variables

```bash
# Copy the example and fill in your values
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Supabase PostgreSQL connection string |
| `GEMINI_API_KEY` | Google AI API key |
| `JWT_SECRET` | Random secret string for JWT signing |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `NEXT_PUBLIC_API_URL` | Set to `/api` for Vercel, or `http://localhost:8003` for local dev |

### 3. Install dependencies

```bash
# Frontend
npm install

# Backend
pip install -r requirements.txt
```

### 4. Run locally

```bash
# Starts both Next.js (port 3000) and FastAPI (port 8003)
npm run server
```

Open [http://localhost:3000](http://localhost:3000)

---

## 📁 Project Structure

```
turkgateway/
├── src/app/                    # Next.js frontend (App Router)
│   ├── chat/                   # Main AI chat interface
│   ├── services/               # Agent selector page
│   ├── dashboard/              # User dashboard
│   ├── admin/                  # Admin panel
│   ├── components/             # Navbar, Sidebar, LoginModal, ThemeToggle
│   ├── context/                # AuthContext, LanguageContext
│   └── utils/api.ts            # Fetch utility with offline detection
│
├── backend/
│   ├── main.py                 # FastAPI entry point + all routes
│   ├── database.py             # DB engine (auto-detects SQLite vs PostgreSQL)
│   ├── models/                 # SQLAlchemy ORM models
│   ├── agents/                 # Knowledge libraries (permit / student / lawyer)
│   ├── smart_router/           # 5-layer query pipeline
│   │   ├── keyword_router.py   # Regex intent detection
│   │   ├── cache.py            # In-memory LRU cache
│   │   ├── learning_cache.py   # DB-backed learned responses
│   │   ├── context_engine.py   # Slot filling + history compression
│   │   ├── ai_fallback.py      # Gemini API calls (last resort)
│   │   └── rag.py              # pgvector similarity search
│   └── utils/protocol.py       # Deterministic roadmap step builders
│
├── api/index.py                # Vercel serverless entrypoint
├── vercel.json                 # Vercel routing configuration
└── ARCHITECTURE.md             # Full system architecture diagrams
```

---

## ☁️ Deploy to Vercel

1. Push this repo to GitHub.
2. Import the project on [vercel.com](https://vercel.com).
3. Add the environment variables from the table above in **Project Settings → Environment Variables**.
4. Deploy — Vercel will automatically build the Next.js frontend and expose the FastAPI backend under `/api/*`.

> **Note:** The `DATABASE_URL` must point to a PostgreSQL database (Supabase recommended). SQLite is only supported for local development.

---

## 🌍 Supported Languages

| Language | UI | Agent Responses |
|---|---|---|
| 🇬🇧 English | ✅ | ✅ |
| 🇹🇷 Turkish | ✅ | ✅ |
| 🇸🇦 Arabic | ✅ | ✅ |

---

## ⚖️ Legal Disclaimer

TurkGateWay provides informational guidance only and does not constitute legal advice. All information should be verified with the relevant Turkish government authorities (municipality, immigration office, etc.) before taking action. Permit requirements and fees are subject to change.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">
  Built with ❤️ for Istanbul's international community
</div>
