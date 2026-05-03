"""
seed_knowledge.py — Migrate JSON responses to PostgreSQL knowledge base + add new content.
Run: python seed_knowledge.py
"""

import asyncio
import json
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal, Base
from models.knowledge_base import KnowledgeArticle, KnowledgeChunk, AgentContext
from sqlalchemy import text


# ── Ensure pgvector extension exists ──
def init_pgvector():
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    print("[Seed] pgvector extension ready.")


# ── Create tables ──
def create_tables():
    Base.metadata.create_all(bind=engine)
    print("[Seed] Knowledge tables created.")


# ── Load existing JSON files ──
def load_json_responses():
    agents_dir = os.path.join(os.path.dirname(__file__), "agents")
    data = {}
    for agent in ["permit", "student", "lawyer", "general"]:
        path = os.path.join(agents_dir, agent, "responses.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data[agent] = json.load(f)
            print(f"[Seed] Loaded {agent}/responses.json ({len(data[agent])} intents)")
    return data


# ── Extra knowledge articles (NEW content not in JSON files) ──
EXTRA_ARTICLES = [
    # ── PERMIT: New topics ──
    {"agent_type": "permit", "category": "foreign_ownership", "title": "Foreign Business Ownership Rules in Turkey",
     "content": "Great news — Turkey allows 100% foreign ownership for most business types! 🎉 Unlike many countries, you don't need a local partner to start a company here. The most popular structure for foreigners is the Ltd. Şirket (LLC), which requires minimum 10,000 TL capital. You'll need at least one director (can be foreign), and there's no residency requirement for shareholders. The entire process — from MERSİS registration to getting your tax plate — typically takes 5-10 business days. The one thing to watch out for: certain regulated sectors (defense, media, aviation) have ownership restrictions. But for cafes, restaurants, retail, tech, and most services — you're completely free to own 100%. Want me to walk you through the formation steps?",
     "tags": ["foreign", "ownership", "LLC", "company", "100%"]},
    {"agent_type": "permit", "category": "mersis", "title": "MERSİS Registration Portal Guide",
     "content": "MERSİS is the online gateway for company registration in Turkey. Think of it as the government's single window for all company formation steps. Here's what you do: First, go to mersis.ticaret.gov.tr and create an account. Then reserve your company name — this usually gets approved in 1-2 business days. After that, you'll fill in your Articles of Association (şirket sözleşmesi) directly in the system. MERSİS generates a unique reference number that follows your application through notarization and Trade Registry. Pro tip: have your NACE code ready before starting — you'll need to select your business activity during registration. The whole MERSİS portion is free and can be done from your laptop. What type of business are you registering?",
     "tags": ["mersis", "registration", "portal", "company", "name_reservation"]},
    {"agent_type": "permit", "category": "trade_registry", "title": "Trade Registry (Ticaret Sicili) Process",
     "content": "After MERSİS and notarization, the Trade Registry is where your company officially comes to life! 🏛️ You'll submit your notarized Articles of Association, capital deposit receipt, and director signatures to the Istanbul Trade Registry Office (İstanbul Ticaret Sicili Müdürlüğü). Processing takes 1-3 business days. Once registered, you get your Tax Plate (Vergi Levhası) and can open a corporate bank account. The fee is around 1,000-2,000 TL depending on your company type. Important: you need to publish your registration in the Turkish Trade Registry Gazette (Türkiye Ticaret Sicili Gazetesi) — this is done automatically by the registry office. After this step, you're officially a Turkish company! Ready for the next step — your municipal operating permit?",
     "tags": ["trade_registry", "ticaret_sicili", "registration", "gazette"]},
    {"agent_type": "permit", "category": "accounting", "title": "Finding an Accountant (Mali Müşavir) in Istanbul",
     "content": "Here's a truth nobody tells you upfront: in Turkey, you NEED a certified accountant (SMMM — Serbest Muhasebeci Mali Müşavir) from day one! 📊 It's not optional — the tax office requires all companies to have a registered accountant. Your accountant handles monthly SGK declarations, quarterly VAT filings, and your annual corporate tax return. Costs range from 2,000-5,000 TL/month depending on transaction volume. My advice: find one who speaks English and specializes in foreign-owned companies. Many offer a startup package (company formation + first year accounting) for a flat fee. Ask them about e-Defter (electronic ledger) and e-Fatura (electronic invoicing) — both are mandatory for most companies now. Need recommendations for English-speaking accountants in Istanbul?",
     "tags": ["accountant", "SMMM", "tax", "bookkeeping", "mali_musavir"]},
    {"agent_type": "permit", "category": "bank_account", "title": "Opening a Corporate Bank Account in Istanbul",
     "content": "Opening a corporate bank account is step 11 of your journey, right after Trade Registry! 🏦 Turkish banks that are most foreigner-friendly include İş Bankası, Garanti BBVA, Yapı Kredi, and Akbank. You'll need: your company's Trade Registry certificate, tax plate, Articles of Association, and the directors' passports/IDs. Some banks require a minimum opening deposit (usually 1,000-5,000 TL). The process takes 1-3 business days. Pro tip: apply to 2-3 banks simultaneously — approval rates vary and some are faster than others. Many banks now offer mobile banking in English, which makes life much easier. One thing to note: your initial capital deposit must be made within 24 months of company formation. Which bank are you considering?",
     "tags": ["bank", "account", "corporate", "deposit", "capital"]},
    {"agent_type": "permit", "category": "signage", "title": "Business Signage Permit (Tabela Ruhsatı)",
     "content": "Planning a storefront sign? You'll need a Tabela Ruhsatı (Signage Permit) from your district municipality! 🪧 This often catches people off guard — you can't just put up any sign you want. The municipality regulates sign size, illumination, placement, and style. The fee is usually 500-2,000 TL depending on sign dimensions. Submit your application with a photo of the proposed sign, your İşyeri Açma Ruhsatı, and the building's consent letter. Processing takes 1-2 weeks. Fun fact: some historic districts like Beyoğlu and Sultanahmet have extra restrictions on sign aesthetics to preserve the neighborhood character. What district is your business in?",
     "tags": ["signage", "sign", "tabela", "storefront", "permit"]},

    # ── STUDENT: New topics ──
    {"agent_type": "student", "category": "turkish_language", "title": "Turkish Language Courses (TÖMER) for Students",
     "content": "Learning Turkish will absolutely transform your experience here! 🇹🇷 Most universities have a TÖMER (Turkish Language Center) that offers structured courses from A1 to C1. If you won a Türkiye Bursları scholarship, you get one year of TÖMER for free! Otherwise, expect to pay 5,000-15,000 TL per level (each level is about 2-3 months). Some universities require a minimum B1 Turkish for programs taught in Turkish. Even if your program is in English, I highly recommend at least A2 level — it makes daily life, bureaucracy, and making friends SO much easier. Many private language schools also offer flexible evening and weekend courses. Have you started learning any Turkish yet?",
     "tags": ["turkish", "language", "TOMER", "course", "learning"]},
    {"agent_type": "student", "category": "bank_account", "title": "Opening a Student Bank Account in Turkey",
     "content": "Getting a Turkish bank account is super important for rent, bills, and Istanbulkart loading! 💳 As a student, you can open an account at most major banks with just your passport and student certificate. İş Bankası, Ziraat Bankası, and Halkbank are popular with international students. You'll get a debit card and can set up mobile banking right away. Some banks (especially Ziraat as a state bank) offer zero-fee student accounts — definitely ask about that! You'll also need a Turkish phone number for SMS verification. Pro tip: download Papara or ininal as a backup digital wallet — they're super popular among students for splitting bills and online shopping. Which city are you studying in?",
     "tags": ["bank", "account", "student", "debit_card", "money"]},
    {"agent_type": "student", "category": "phone_sim", "title": "Getting a Turkish SIM Card as a Student",
     "content": "You'll definitely need a Turkish phone number for e-Devlet, bank verification, and just life in general! 📱 The big three carriers are Turkcell, Vodafone, and Türk Telekom. As a foreigner, you can buy a prepaid SIM with just your passport — head to any official carrier store (not resellers). Important catch: if you use your foreign phone with a Turkish SIM for more than 120 days, you need to register it through e-Devlet (costs around 20,000 TL!) or buy a local phone. Many students buy an affordable local phone to avoid the registration fee. Student plans are usually 100-200 TL/month for decent data. Want to know the best student plans available right now?",
     "tags": ["SIM", "phone", "number", "turkcell", "vodafone"]},
    {"agent_type": "student", "category": "part_time_jobs", "title": "Part-Time Job Options for International Students",
     "content": "Looking for work while studying? After your first year of Bachelor's, you can work up to 24 hours/week legally! 💼 Popular student jobs include: cafe/restaurant service (especially in tourist areas — your English is a huge asset!), private English/language tutoring (can earn 200-500 TL/hour), campus jobs (library, lab assistant), and freelance translation. For tutoring, platforms like Preply and italki let you teach online. On-campus jobs are handled through Student Affairs. A few warnings: always get a formal work permit through your employer, never work illegally (it can cancel your ikamet!), and make sure your employer registers you with SGK. What kind of work interests you?",
     "tags": ["jobs", "work", "part_time", "tutoring", "employment"]},

    # ── LAWYER: New topics ──
    {"agent_type": "lawyer", "category": "power_of_attorney", "title": "Power of Attorney (Vekalet) in Turkey",
     "content": "A Power of Attorney (Vekaletname) lets someone act on your behalf legally — essential if you can't be physically present for signings, registrations, or court appearances. In Turkey, POAs must be notarized (noter onaylı) to be valid. There are two types: general (genel vekaletname) which covers broad permissions, and special (özel vekaletname) for specific actions like selling property or signing contracts. If you're abroad, you can get a POA from the Turkish consulate in your country. Cost: 500-1,500 TL at a Turkish notary. Critical warning: be very careful with general POAs — they give broad powers. Always specify exactly what actions the attorney can perform. Need help understanding which type you need?",
     "tags": ["power_of_attorney", "vekaletname", "notary", "representation"]},
    {"agent_type": "lawyer", "category": "intellectual_property", "title": "Intellectual Property Protection in Turkey",
     "content": "Protecting your brand in Turkey? Smart thinking! 🛡️ Trademark registration is handled by TÜRKPATENT (Turkish Patent and Trademark Office). The process takes about 6-12 months from application to registration. Filing fee is around 1,500-3,000 TL per class of goods/services. A registered trademark gives you 10 years of protection, renewable indefinitely. For patents, the process is longer (18-24 months) and requires a patent attorney. Copyright is automatic in Turkey — no registration needed, but registering with the Ministry of Culture provides stronger evidence in disputes. If you're launching a brand in Turkey, I strongly recommend filing for trademark protection before announcing publicly. What type of IP do you need to protect?",
     "tags": ["trademark", "patent", "intellectual_property", "TURKPATENT", "brand"]},
    {"agent_type": "lawyer", "category": "tax_obligations", "title": "Corporate Tax Obligations in Turkey",
     "content": "Let's talk taxes — not the most exciting topic, but crucial to get right! 📊 Corporate tax in Turkey is currently 25% on profits. VAT (KDV) is 20% for most goods and services. You'll file monthly VAT returns, quarterly withholding tax (stopaj), and an annual corporate tax return. SGK (social security) contributions for employees are about 37.5% of gross salary — the employer pays 22.5% and the employee 15%. Important deadlines: VAT declarations by the 26th of each month, SGK by the 26th, and corporate tax by April 30th. Late filings attract penalties automatically. Your accountant handles most of this, but you should understand the basics. Want a breakdown of what to expect for your specific business type?",
     "tags": ["tax", "corporate", "VAT", "KDV", "SGK", "obligations"]},
]


# ── Generate embeddings for all articles ──
async def generate_embeddings(articles_data):
    """Add embeddings to articles using Google text-embedding-004."""
    import google.generativeai as genai

    print(f"[Seed] Generating embeddings for {len(articles_data)} articles...")
    for i, article in enumerate(articles_data):
        try:
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=article["content"][:2000],  # Cap content length
                task_type="retrieval_document",
            )
            article["embedding"] = result["embedding"]
            if (i + 1) % 10 == 0:
                print(f"[Seed] Embedded {i+1}/{len(articles_data)}")
        except Exception as e:
            print(f"[Seed] Embedding error for '{article.get('title', '?')}': {e}")
            article["embedding"] = None
    print(f"[Seed] Embedding complete.")


def json_to_articles(json_data: dict) -> list:
    """Convert existing JSON response files into article format."""
    articles = []

    for agent_type, intents in json_data.items():
        if agent_type == "general":
            continue  # General responses stay in code (greetings, etc.)

        if isinstance(intents, dict):
            for intent_key, responses in intents.items():
                if isinstance(responses, list):
                    # Merge all response variants into one rich article
                    merged = "\n\n".join(responses)
                    articles.append({
                        "agent_type": agent_type,
                        "category": intent_key,
                        "title": f"{intent_key.replace('_', ' ').title()} — {agent_type.title()} Guide",
                        "content": merged,
                        "tags": [intent_key, agent_type],
                        "language": "en",
                    })
                elif isinstance(responses, dict):
                    # Nested (e.g., billing.price)
                    for sub_key, sub_responses in responses.items():
                        if isinstance(sub_responses, list):
                            merged = "\n\n".join(sub_responses)
                            articles.append({
                                "agent_type": "general",
                                "category": f"{intent_key}.{sub_key}",
                                "title": f"{sub_key.replace('_', ' ').title()} — {intent_key.title()}",
                                "content": merged,
                                "tags": [intent_key, sub_key],
                                "language": "en",
                            })
    return articles


async def seed():
    """Main seed function."""
    print("=" * 60)
    print("[Seed] Starting knowledge base seeding...")
    print("=" * 60)

    # 1. Init pgvector & create tables
    init_pgvector()
    create_tables()

    # 2. Load existing JSON
    json_data = load_json_responses()

    # 3. Convert JSON to articles
    json_articles = json_to_articles(json_data)
    print(f"[Seed] Converted {len(json_articles)} articles from JSON files")

    # 4. Combine with extra articles
    all_articles = json_articles + EXTRA_ARTICLES
    print(f"[Seed] Total articles to seed: {len(all_articles)}")

    # 5. Generate embeddings
    await generate_embeddings(all_articles)

    # 6. Insert into DB
    db = SessionLocal()
    try:
        # Clear existing articles
        db.execute(text("DELETE FROM knowledge_chunks"))
        db.execute(text("DELETE FROM knowledge_articles"))
        db.commit()
        print("[Seed] Cleared existing knowledge data")

        inserted = 0
        for article_data in all_articles:
            article = KnowledgeArticle(
                agent_type=article_data.get("agent_type", "permit"),
                category=article_data.get("category", "general"),
                title=article_data.get("title", "Untitled"),
                content=article_data.get("content", ""),
                tags=article_data.get("tags", []),
                language=article_data.get("language", "en"),
                embedding=article_data.get("embedding"),
            )
            db.add(article)
            db.flush()  # Get the article ID

            # Split content into chunks (~300 tokens each)
            content = article_data.get("content", "")
            chunk_size = 800  # ~300 tokens in chars
            chunks = [content[i:i + chunk_size] for i in range(0, len(content), chunk_size)]
            if not chunks:
                chunks = [content]

            for idx, chunk_text in enumerate(chunks):
                chunk = KnowledgeChunk(
                    article_id=article.id,
                    chunk_text=chunk_text,
                    chunk_index=idx,
                    embedding=article_data.get("embedding"),  # Use same embedding for now
                )
                db.add(chunk)

            inserted += 1

        db.commit()
        print(f"[Seed] ✅ Inserted {inserted} articles with chunks")

        # 7. Seed agent context
        context_data = [
            {"agent_type": "permit", "context_key": "districts",
             "data": {"districts": ["Beşiktaş", "Kadıköy", "Şişli", "Bakırköy", "Üsküdar", "Fatih", "Beyoğlu", "Sarıyer", "Ataşehir", "Maltepe", "Kartal", "Pendik", "Zeytinburnu", "Bayrampaşa", "Kağıthane", "Eyüpsultan", "Gaziosmanpaşa", "Esenler", "Bağcılar", "Küçükçekmece", "Bahçelievler", "Güngören", "Başakşehir", "Sultangazi", "Arnavutköy", "Çatalca", "Silivri", "Büyükçekmece", "Esenyurt", "Avcılar", "Beylikdüzü", "Sultanbeyli", "Sancaktepe", "Ümraniye", "Çekmeköy", "Beykoz", "Tuzla", "Adalar", "Şile"]}},
            {"agent_type": "permit", "context_key": "business_types",
             "data": {"types": ["Restaurant", "Cafe", "Retail", "Office", "Barber", "Gym", "Pharmacy", "Bakery", "Clothing", "Tech", "Consulting", "Import/Export", "Market", "Hotel", "Bar"]}},
        ]
        db.execute(text("DELETE FROM agent_context"))
        for ctx in context_data:
            db.add(AgentContext(**ctx))
        db.commit()
        print("[Seed] ✅ Agent context seeded")

    finally:
        db.close()

    print("=" * 60)
    print("[Seed] ✅ Knowledge base seeding COMPLETE!")
    print("=" * 60)


if __name__ == "__main__":
    # Configure API key
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY", ""))

    asyncio.run(seed())
