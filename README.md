# TurkGateway AI 🚀

TurkGateway AI is a professional permit consulting platform designed to simplify the complex process of obtaining business licenses in Istanbul. It leverages AI agents to provide personalized, district-specific guidance for various business types (Restaurant, Cafe, Retail, etc.) across all 39 districts of Istanbul.

## 🌟 Key Features

- **AI-Powered Consultation**: Real-time chat with a specialized permit agent to generate a customized 14-step permit path.
- **Dynamic Dashboard**: A state-of-the-art interface that tracks compliance scores and workflow progress.
- **District-Agnostic Support**: Intelligent detection and support for all 39 districts in Istanbul (e.g., Beşiktaş, Kadıköy, Bakırköy, Zeytinburnu).
- **Industry-Specific Logic**: Tailored permit requirements for Restaurants, Cafes, and Retail businesses.
- **Automation Ready**: Built-in (legal-approval-pending) support for e-Devlet and MERSİS automation via RPA bots.
- **Multi-Language Support**: Fully localized in English, Turkish, and Arabic.

## 🛠️ Technical Stack

- **Frontend**: Next.js, Framer Motion, Tailwind CSS / Vanilla CSS.
- **Backend**: FastAPI, SQLAlchemy, LangGraph (for agent orchestration).
- **AI Engine**: Google Gemini 2.5 Flash / Pro.
- **Automation**: Playwright for e-Devlet/MERSİS bot integration.
- **Database**: SQLite (SQLAlchemy).

## 🚀 Getting Started

1.  **Backend**:
    ```bash
    cd backend
    npm run server
    ```
2.  **Frontend**:
    ```bash
    npm run dev
    ```

## ⚖️ Legal Disclaimer

The bot automation features are currently disabled pending legal and law approval. Users can view the automated steps but must approve and wait for regulatory clearance before final execution.
