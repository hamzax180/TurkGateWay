"""
smart_router/__init__.py
------------------------
Public entry point for the Smart Router module.

Priority order (highest to lowest cost):
  1. Cache hit          → 0 tokens
  2. Keyword match      → 0 tokens  (picks random variation from response_library)
  3. AI fallback        → ≤100 tokens (only when 1 & 2 both fail)

Usage in main.py:
    from smart_router import smart_router_handle

    result = await smart_router_handle(
        query=query_text,
        assistant_type=assistant_type,
        user_name=user.full_name if user else "",
        gemini_model=gemini_model,
        student_model=student_model,
        lawyer_model=lawyer_model,
    )
    if result is not None:
        # Serve immediately — skip orchestrators
        return {"role": "assistant", "content": result}
    # else: fall through to existing permit/student/lawyer pipeline
"""

import random
import json
import os
import re
from typing import Optional, Tuple
from difflib import SequenceMatcher

from .keyword_router import detect_intent
from .template_engine import render, build_variables
from . import cache as response_cache
from .ai_fallback import ai_fallback_response
from .learning_cache import learn as learn_response, set_live_library as _set_live_library, find_learned_response as _find_learned
from .context_engine import handle_with_context, get_augmented_query

# RAG retrieval (DB-backed, falls back gracefully to JSON library if unavailable)
try:
    from .rag import retrieve_chunks, generate_rag_response
    _RAG_AVAILABLE = True
    print("[SmartRouter] RAG retrieval module loaded.")
except Exception as _rag_err:
    _RAG_AVAILABLE = False
    print(f"[SmartRouter] RAG not available (falling back to JSON library): {_rag_err}")

# ---------------------------------------------------------------------------
# Load response libraries for multiple languages
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "agents")
_library: dict = {"en": {}, "ar": {}, "tr": {}}

for lang in ["en", "ar", "tr"]:
    suffix = f"_{lang}" if lang != "en" else ""
    try:
        # Load core agents
        for agent in ["permit", "student", "lawyer"]:
            file_path = os.path.join(_AGENTS_DIR, agent, f"responses{suffix}.json")
            if os.path.exists(file_path):
                with open(file_path, "r", encoding="utf-8") as f:
                    _library[lang][agent] = json.load(f)
            elif lang != "en":
                # Fallback to English if localized file is missing
                _library[lang][agent] = _library["en"].get(agent, {})

        # Load general responses
        gen_file = os.path.join(_AGENTS_DIR, "general", f"responses{suffix}.json")
        if os.path.exists(gen_file):
            with open(gen_file, "r", encoding="utf-8") as f:
                gen_data = json.load(f)
                for k, v in gen_data.items():
                    _library[lang][k] = v
        elif lang != "en":
             # Fallback general keys from English
             for k, v in _library["en"].items():
                 if k not in ["permit", "student", "lawyer"]:
                     _library[lang][k] = v

        # Load learned responses from separate learned.json files
        for agent in ["permit", "student", "lawyer"]:
            learned_file = os.path.join(_AGENTS_DIR, agent, "learned", f"{lang}.json")
            if os.path.exists(learned_file):
                with open(learned_file, "r", encoding="utf-8") as f:
                    learned_data = json.load(f)
                    # Merge learned entries into the agent's in-memory library
                    if agent in _library[lang] and isinstance(_library[lang][agent], dict):
                        for k, v in learned_data.items():
                            if k not in _library[lang][agent]:
                                _library[lang][agent][k] = v
                            elif isinstance(v, list):
                                _library[lang][agent][k].extend(v)

        print(f"[SmartRouter] Handlers for '{lang}' loaded successfully.")
    except Exception as e:
        print(f"[SmartRouter] WARNING: Failed to load '{lang}' response libraries: {e}")

# Share live library with learning cache so learned responses take effect immediately
_set_live_library(_library)


# ---------------------------------------------------------------------------
# Patterns that signal a NEW CONSULTATION — always route to orchestrator.
# These queries need the full structured dashboard, not a canned reply.
# ---------------------------------------------------------------------------

_NEW_CONSULTATION_PATTERNS = [
    # "I want to open / start / launch X" — user has stated a clear intent to start something
    r"\b(i want to|i'd like to|i plan to|i'm planning to|i am planning to|how (do i|can i|to))\b.{0,30}\b(open|start|launch|set up|setup|register|create)\b",
    # "open a restaurant/cafe/shop in X" — specific business + location mentioned
    r"\bopen (a |an |my )?[\w\s]{1,30}(in|at|near)\b",
    # "want to open" used with a real noun following (filtered by context)
    r"\bwant to (open|start|register|set up)\b",
    # "how do I open / start / register"
    r"\bhow (do i|can i|to) (open|start|register|set up|get a permit|apply for)\b",
    # "I need a permit for X" — user is asking for a permit for something specific
    r"\b(need|get|apply for|obtain) (a |an )?(permit|ruhsat|lisans|licence|license) (for|to)\b",
    # Student: enroll at / register for university
    r"\b(enroll|register|apply) (at|for|to|in) (a |the |my )?(university|uni)\b",
    # Lawyer: I need legal help for / I need to form a company
    r"\b(form|create|register|incorporate|set up) (a |my |an )?(company|business|firm|ltd|a\u015f)\b",
    r"\b(i need|i have|i got) (a |an )?(legal|contract|lawyer|employment) (problem|issue|dispute|case|question|matter)\b",
    # Chip buttons that carry SPECIFIC INTENT (business type is clear from the label)
    r"^(i want to obtain a business permit)$",
    r"^(i want to know the steps)$",
    r"^(how to get a work permit\??)$",
    # Lawyer chip buttons — these each imply a specific legal engagement
    r"^(contract review|company formation|employment law|legal disputes|legal timelines|residency/permit|residency permit)$",
    r"\b(review (my |a |the )?(contract|agreement|nda|clause)|check (my |this )?(contract|agreement))\b",
    r"\b(form|open|start|register|incorporate) (a |my )?(company|ltd|limited \u015firket|anonim \u015firket|business|firm)\b",
    r"\b(fired|wrongfully dismissed|termination|severance pay|k\u0131dem tazminat|employment dispute|labour court|i\u015f mahkemesi)\b",
    r"\b(work permit|residence permit|ikamet (ba\u015fvuru|application)|\u00e7al\u0131\u015fma izni|stay in turkey legally|legal to work)\b",
    r"\b(legal dispute|lawsuit|mediation|arabuluculuk|ihtarname|file a claim|take to court|sue (someone|my|the))\b",
    r"\b(buy|sell|rent|purchase|lease) (a |my )?(house|property|apartment|flat|commercial|real estate|tapu)\b",
    r"\b(police|arrest|arrested|criminal|charge|jail|prison|detained|prosecutor|drug|drugs|narcotic|narcotics|weed|cocaine|hashish|theft|robbery|fraud|assault|violence|caught with)\b",
    r"\b(debt|unpaid|invoice|money owed|icra|haciz|collection)\b",
    r"\b(how long (does|will|do)).{0,40}(company|permit|contract|court|case|formation|residency|ikamet)\b",
    # Naked location changes mid-session ("cafe in besiktas")
    r"\b(cafe|kafe|restaurant|restoran|retail|office|ofis|pharmacy|eczane|bakery|f[\u0131i]r[\u0131i]n|barber|berber|gym|spor|shop|store|company|ma[\u011fg]aza|d[\u00fcu]kkan) (in|at) \b",
    # ID Renewal / Replacement
    r"\b(renew|replace).{1,15}(id|kimlik|student id)\b",
    # Student chip buttons
    r"^(student id renewal|university registration|student visas|öğrenci ikameti|üniversite kaydı)$"
]

# Meta-questions about the system or process that should go to AI orchestrator
# NOTE: These only trigger if NO keyword match is found first.
_META_QUERY_PATTERNS = [
    r"\b(information|details|explain|tell me more|help me with|question about|step [0-9]|understand)\b",
    r"\b(where is the dashboard|how it works)\b",
]

_ISOLATED_ANSWER_PATTERNS = [
    r"^(cafe|kafe|restaurant|restoran|retail|bakery|f[\u0131i]r[\u0131i]n|pharmacy|eczane|gym|spor|barber|berber|office|ofis|tech)$",
    r"^(adalar|arnavutkoy|atasehir|avcilar|bagcilar|bahcelievler|bakirkoy|basaksehir|bayrampasa|besiktas|beykoz|beylikduzu|beyoglu|buyukcekmece|catalca|cekmekoy|esenler|esenyurt|eyup|fatih|gaziosmanpasa|gungoren|kadikoy|kagithane|kartal|kucukcekmece|maltepe|pendik|sancaktepe|sariyer|sile|silivri|sisli|sultanbeyli|sultangazi|tuzla|umraniye|uskudar|zeytinburnu)$"
]

_NEW_CONSULTATION_RE = re.compile("|".join(_NEW_CONSULTATION_PATTERNS), flags=re.IGNORECASE)
_ISOLATED_ANSWER_RE = re.compile("|".join(_ISOLATED_ANSWER_PATTERNS), flags=re.IGNORECASE)
_META_QUERY_RE = re.compile("|".join(_META_QUERY_PATTERNS), flags=re.IGNORECASE)

# ---------------------------------------------------------------------------
# Fuzzy matching for typos (e.g. "bacheveler" → "bahcelievler")
# ---------------------------------------------------------------------------

_ALL_DISTRICTS = [
    "adalar", "arnavutkoy", "atasehir", "avcilar", "bagcilar", "bahcelievler",
    "bakirkoy", "basaksehir", "bayrampasa", "besiktas", "beykoz", "beylikduzu",
    "beyoglu", "buyukcekmece", "catalca", "cekmekoy", "esenler", "esenyurt",
    "eyup", "eyupsultan", "fatih", "gaziosmanpasa", "gungoren", "kadikoy",
    "kagithane", "kartal", "kucukcekmece", "maltepe", "pendik", "sancaktepe",
    "sariyer", "sile", "silivri", "sisli", "sultanbeyli", "sultangazi",
    "tuzla", "umraniye", "uskudar", "zeytinburnu",
    "yenibosna", "sirinevler", "sirineveler", "taksim", "istiklal", "florya", "yesilkoy",
    "maslak", "tarabya", "etiler", "levent", "bebek", "mecidiyekoy", "nisantasi",
    "karakoy", "galata", "cihangir", "moda", "suadiye", "caddebostan", "bostanci",
    "eminonu", "sultanahmet", "balat", "kayasehir", "kayashier"
]

_ALL_BUSINESS_TYPES = [
    "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis",
    "pharmacy", "eczane", "bakery", "barber", "berber", "gym", "shop",
    "store", "company", "clothing", "hotel", "clinic", "school",
]

_UNI_MAP = {
    "boğaziçi": "Boğaziçi University", "bogazici": "Boğaziçi University", "boğaziçi uni": "Boğaziçi University", "boğaziçi üni": "Boğaziçi University", "boun": "Boğaziçi University", "boga": "Boğaziçi University", "boğa": "Boğaziçi University", "bogaz": "Boğaziçi University", "boğaz": "Boğaziçi University",
    "metu": "METU (ODTÜ)", "odtü": "METU (ODTÜ)", "odtu": "METU (ODTÜ)", "met": "METU (ODTÜ)",
    "istanbul university": "Istanbul University", "istanbul üniversitesi": "Istanbul University", "istanbul uni": "Istanbul University", "istanbul üni": "Istanbul University", "istanbul": "Istanbul University", "iu": "Istanbul University", "iü": "Istanbul University",
    "itü": "İTÜ (Istanbul Technical)", "itu": "İTÜ (Istanbul Technical)", "istanbul teknik": "İTÜ (Istanbul Technical)", "istanbul technical": "İTÜ (Istanbul Technical)",
    "hacettepe": "Hacettepe University", "hacettepe uni": "Hacettepe University", "hacettepe üni": "Hacettepe University", "hacett": "Hacettepe University", "hu": "Hacettepe University",
    "koç": "Koç University", "koc": "Koç University", "koç uni": "Koç University", "koç üni": "Koç University", "kocu": "Koç University",
    "sabancı": "Sabancı University", "sabanci": "Sabancı University", "sabancı uni": "Sabancı University", "sabancı üni": "Sabancı University", "su": "Sabancı University",
    "bilkent": "Bilkent University", "bilkent uni": "Bilkent University", "bilkent üni": "Bilkent University", "bil": "Bilkent University",
    "ankara university": "Ankara University", "ankara üniversitesi": "Ankara University", "ankara uni": "Ankara University", "ankara üni": "Ankara University", "ankara": "Ankara University", "au": "Ankara University",
    "ege university": "Ege University", "ege üniversitesi": "Ege University", "ege uni": "Ege University", "ege üni": "Ege University", "ege": "Ege University", "eu": "Ege University",
    "altınbaş": "Altınbaş University", "altinbas": "Altınbaş University", "altınbaş uni": "Altınbaş University", "altınbaş üni": "Altınbaş University", "altunbas": "Altınbaş University", "altn": "Altınbaş University",
    "aydin": "Istanbul Aydın University", "aydın": "Istanbul Aydın University", "aydin university": "Istanbul Aydın University", "aydın üniversitesi": "Istanbul Aydın University", "iau": "Istanbul Aydın University",
    "بوغازيتشي": "Boğaziçi University", "الشرق الأوسط": "METU (ODTÜ)", "إسطنبول": "Istanbul University", "جامعة إسطنبول": "Istanbul University",
    "كوتش": "Koç University", "سابانجي": "Sabancı University", "بيلكنت": "Bilkent University", 
    "أنقرة": "Ankara University", "حاجيتييبي": "Hacettepe University", "ألتن باش": "Altınbaş University", "أيدن": "Istanbul Aydın University"
}

_UNI_DEADLINES = {
    "Boğaziçi University": {"en": "Mid-July", "tr": "Temmuz Ortası", "ar": "منتصف يوليو"},
    "METU (ODTÜ)": {"en": "Early July", "tr": "Temmuz Başı", "ar": "أوائل يوليو"},
    "Istanbul University": {"en": "August", "tr": "Ağustos", "ar": "أغسطس"},
    "İTÜ (Istanbul Technical)": {"en": "Early August", "tr": "Ağustos Başı", "ar": "أوائل أغسطس"},
    "Hacettepe University": {"en": "Mid-July", "tr": "Temmuz Ortası", "ar": "منتصف يوليو"},
    "Koç University": {"en": "Early July", "tr": "Temmuz Başı", "ar": "أوائل يوليو"},
    "Sabancı University": {"en": "Mid-August", "tr": "Ağustos Ortası", "ar": "منتصف أغسطس"},
    "Bilkent University": {"en": "Mid-July", "tr": "Temmuz Ortası", "ar": "منتصف يوليو"},
    "Ankara University": {"en": "August", "tr": "Ağustos", "ar": "أغسطس"},
    "Ege University": {"en": "Early August", "tr": "Ağustos Başı", "ar": "أوائل أغسطس"},
    "Altınbaş University": {"en": "Mid-August", "tr": "Ağustos Ortası", "ar": "منتصف أغسطس"},
    "Istanbul Aydın University": {"en": "Late August", "tr": "Ağustos Sonu", "ar": "أواخر أغسطس"}
}

_UNI_LOCATIONS = {
    "Boğaziçi University": {
        "en": "The main campuses are in **Bebek/Rumelihisarı**, Beşiktaş. (European Side)",
        "tr": "Ana kampüsler **Bebek/Rumelihisarı**, Beşiktaş'tadır. (Avrupa Yakası)",
        "ar": "الحرم الجامعي الرئيسي يقع في **بيبيك/روملي حصار**، بشكتاش. (الجانب الأوروبي)"
    },
    "METU (ODTÜ)": {
        "en": "The main campus is in **Çankaya**, Ankara.",
        "tr": "Ana kampüs **Çankaya**, Ankara'dadır.",
        "ar": "الحرم الجامعي الرئيسي يقع في **تشانكايا**، أنقرة."
    },
    "Istanbul University": {
        "en": "The main historical campus is in **Beyazıt Square, Fatih**.",
        "tr": "Tarihi ana kampüs **Beyazıt Meydanı, Fatih**'tedir.",
        "ar": "الحرم الجامعي التاريخي الرئيسي يقع في **ميدان بيازيد، فاتح**."
    },
    "İTÜ (Istanbul Technical)": {
        "en": "The primary campus (Ayazaga) is in **Maslak**, Sariyer.",
        "tr": "Ana kampüs (Ayazağa) **Maslak**, Sarıyer'dedir.",
        "ar": "الحرم الجامعي الرئيسي (أيازاغا) يقع في **مسلك**، ساريير."
    },
    "Koç University": {
        "en": "The main campus is in **Rumelifeneri**, Sariyer.",
        "tr": "Ana kampüs **Rumelifeneri**, Sarıyer'dedir.",
        "ar": "الحرم الجامعي الرئيسي يقع في **روملي فنار**، ساريير."
    },
    "Altınbaş University": {
        "en": "Main campus (Mahmutbey) is in **Bağcılar**. Medical is in **Bakırköy**. Management is in **Gayrettepe**.",
        "tr": "Ana kampüs (Mahmutbey) **Bağcılar**'dadır. Tıp **Bakırköy**'de, İşletme **Gayrettepe**'dedir.",
        "ar": "الحرم الجامعي الرئيسي (محمود بيه) يقع في **باغجلار**. الطب في **بكر كوي**. الإدارة في **غيريت تبه**."
    },
    "Istanbul Aydın University": {
        "en": "The main campus is located in **Florya**, Küçükçekmece.",
        "tr": "Ana kampüs **Florya**, Küçükçekmece'de yer almaktadır.",
        "ar": "الحرم الجامعي الرئيسي يقع في **فلوريا**، كوتشوك تشيكميجة."
    }
}

def _fuzzy_match(word: str, candidates: list, threshold: float = 0.75) -> str | None:
    """Return the best candidate if similarity >= threshold, else None."""
    word = word.lower().strip()
    if len(word) < 2:
        return None
    best, best_score = None, 0.0
    for c in candidates:
        if abs(len(c) - len(word)) > 10:
            continue
        score = SequenceMatcher(None, word, c).ratio()
        if score > best_score:
            best, best_score = c, score
    return best if best_score >= threshold else None


# ---------------------------------------------------------------------------
# Internal: pick a random response from the library (language aware)
# ---------------------------------------------------------------------------

def _pick_response(intent_group: Optional[str], sub_intent: Optional[str], language: str = "en") -> Optional[str]:
    if not intent_group:
        return None
    
    lang_lib = _library.get(language, _library["en"])
    
    if intent_group in lang_lib and isinstance(lang_lib[intent_group], list):
        picked = random.choice(lang_lib[intent_group])
        # Handle both string entries (curated) and dict entries (learned)
        return picked if isinstance(picked, str) else picked.get("r", picked)
    
    group_data = lang_lib.get(intent_group)
    if isinstance(group_data, dict) and sub_intent:
        options = group_data.get(sub_intent)
        if options:
            picked = random.choice(options)
            return picked if isinstance(picked, str) else picked.get("r", picked)
            
    if language != "en":
        return _pick_response(intent_group, sub_intent, "en")
        
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def smart_router_handle(
    query: str,
    assistant_type: str = "permit",
    user_name: str = "",
    language: str = "en",
    gemini_model=None,
    student_model=None,
    lawyer_model=None,
    history_text: str = "",
    can_learn: bool = True,
    subscription_status: str = "free"
) -> Tuple[Optional[str], Optional[dict], Optional[str]]:
    import asyncio
    
    # --- PHASE 1: Start Thinking ---
    wait_task = asyncio.create_task(asyncio.sleep(1.0))
    
    query = query.strip()
    
    # Pre-compute last_assistant_msg early so all phases can use it
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1].strip() if "[assistant]:" in history_text.lower() else ""
    # Pre-detect if the assistant is currently asking a clarifying question
    # (district, business type, university). If so, short answers like "retail"
    # or "sisli" must skip the caches and go straight to roadmap builder.
    _is_clarifying_for_roadmap = False
    if last_assistant_msg:
        _clarify_markers = [
            "what type of business", "hangi tür işletme", "ما هو نوع العمل",
            "which district", "hangi ilçesinde", "في أي منطقة",
            "which university", "hangi üniversite", "في أي جامعة",
            "type the name", "planning to open", "açacaksın", "ستفتح",
            "what type", "which type"
        ]
        _is_clarifying_for_roadmap = any(k in last_assistant_msg for k in _clarify_markers)

    cached = response_cache.get(query, assistant_type, language)
    if cached and not _is_clarifying_for_roadmap:
        await wait_task
        print(f"\n[Smart Router] 🚀 Response served from IN-MEMORY EXACT CACHE")
        return cached, None, "In-Memory Exact Cache"

    # --- PHASE 0.05: AI Form Generation (High Priority) ---
    _form_keywords = [
        "generate form", "write petition", "dilekçe yaz", "dilekce olustur", "application form", 
        "create form", "write my form", "generate my form", "write a petition", "create a petition", 
        "dilekce yaz", "form oluştur", "generate petition", "generate a petition", "generate my petition",
        "make a petition", "make a form", "petition generator", "form generator"
    ]
    if any(k in query.lower() for k in _form_keywords):
        from utils.pdf_generator import generate_petition_pdf
        from .ai_fallback import ai_fallback_response
        
        print(f"[SmartRouter] Generating AI PDF Form for query: {query}")
        
        # Check for premium status
        if subscription_status != "active":
            msg = {
                "en": "📄 **Form Generation** is a Premium feature.\n\nPlease upgrade to the **Premium** or **Max** plan to generate official petitions and application forms instantly!",
                "tr": "📄 **Dilekçe Oluşturma** bir Premium özelliktir.\n\nResmi dilekçe ve başvuru formlarını anında oluşturmak için lütfen **Premium** veya **Max** plana yükseltin!",
                "ar": "📄 **إنشاء النماذج** هي ميزة ممتازة (Premium).\n\nيرجى الترقية إلى خطة **Premium** أو **Max** لإنشاء الالتماسات ونماذج الطلبات الرسمية على الفور!"
            }.get(language, "Please upgrade to Premium to generate forms.")
            await wait_task
            return msg, None, "Smart Router (Form Restricted)"

        form_prompt = (
            "You are a strict Turkish legal and administrative expert. The user wants to generate an official "
            "petition (dilekçe) or application form based on the conversation history. "
            "Write ONLY the text of the formal Turkish petition. Do not include greetings, markdown, or chat. "
            "Use placeholders like [AD SOYAD], [TARİH], [ADRES] if info is missing. "
            "Always start with the addressed institution in ALL CAPS."
        )
        
        form_content = await ai_fallback_response(
            query=form_prompt,
            assistant_type=assistant_type,
            gemini_model=gemini_model,
            student_model=student_model,
            lawyer_model=lawyer_model,
            history_text=history_text,
            language="tr" 
        )
        
        if not form_content or len(form_content) < 20:
            form_content = "İLGİLİ MAKAMA,\n\nKonu ile ilgili gereğinin yapılmasını arz ederim.\n\nTarih: [TARİH]\n\nAd Soyad: [AD SOYAD]\nİmza:"
            
        pdf_url = generate_petition_pdf("Resmi Dilekce", form_content)
        
        # We assume backend is running on 8003
        download_btn_md = f"\n\n[📄 **Download your official document (PDF)**](http://localhost:8003{pdf_url})"
        
        msg = {
            "en": f"I've generated your official Turkish application form/petition based on our conversation! You can download it below, fill in any placeholders, and print it.{download_btn_md}",
            "tr": f"Konuşmamıza dayanarak resmi dilekçenizi oluşturdum! Aşağıdan indirebilir, boşlukları doldurup imzalayabilirsiniz.{download_btn_md}",
            "ar": f"لقد قمت بإنشاء نموذج طلبك الرسمي بناءً على محادثتنا! يمكنك تنزيله من الأسفل، وملء الفراغات، وطباعته.{download_btn_md}"
        }.get(language, f"Here is your form:{download_btn_md}")
        
        await wait_task
        return msg, None, "Smart Router (Form Generator)"

    # --- PHASE 0.1: Context Engine Local Resolution (0 tokens) ---
    # Handles follow-up questions like "apply from riyadh" by understanding conversation state
    # SKIP when clarifying — let roadmap builder handle short answers
    if history_text and not _is_clarifying_for_roadmap:
        context_answer = handle_with_context(query, history_text, assistant_type, language)
        if context_answer:
            print(f"\n[Smart Router] 🧩 Response served from LOCAL CONTEXT ENGINE")
            response_cache.set(query, context_answer, assistant_type, language)
            await wait_task
            return context_answer, None, "Local Context Engine"

    # --- PHASE 0.2: Learning Cache Check ---
    # SKIP when clarifying — "retail", "sisli" etc. must reach the roadmap builder
    if not _is_clarifying_for_roadmap:
        learned = _find_learned(query, assistant_type, language, context_text=last_assistant_msg)
    else:
        learned = None
        print(f"[SmartRouter] Skipping cache/learning — clarifying for roadmap (query: '{query}')")

    if learned:
        learned_text = learned[0] if isinstance(learned, tuple) else learned
        learned_state = learned[1] if isinstance(learned, tuple) else None
        
        response_cache.set(query, learned_text, assistant_type, language)
        print(f"\n[Smart Router] 🧠 Response served from LEARNING CACHE (backend/agents/{assistant_type}/learned/{language}.json)")
        await wait_task
        return learned_text, learned_state, "Learning Cache (Learned Database)"

    # --- PHASE 0.5: Contextual Affirmative Check (Handle 'yes' to deadlines) ---
    lower_q = query.lower().strip().replace("?", "").replace(".", "").replace("!", "")

    affirmative = ["yes", "yeah", "yep", "sure", "ok", "okay", "evet", "tamam", "olur", "\u0646\u0639\u0645", "\u0627\u064a\u0648\u0647", "\u0623\u062c\u0644", "\u0637\u0628\u0631\u0627", "\u0637\u0628\u0631\u0627\u064b", "\u0645\u0627\u0634\u064a", "please", "go ahead", "show me", "show", "give me", "do it", "let's go", "let's", "yalla", "\u064a\u0644\u0644\u0627", "send", "continue", "devam", "devam et", "\u0627\u0643\u0645\u0644"]
    if lower_q in affirmative and last_assistant_msg:
        if any(marker in last_assistant_msg for marker in ["check the current registration calendar", "registration calendar", "university deadline", "kay\u0131t takvimi", "moaud", "\u0645\u0648\u0639\u062f", "announcements", "duyurular", "major schools"]):
            prompt = {
                "en": "Great! \ud83c\udf93 Which university are you targeting? Please type the name (e.g., Bo\u011fazi\u00e7i, METU, Istanbul University) and I'll find their specific deadline for you.",
                "tr": "Harika! \ud83c\udf93 Hangi \u00fcniversite ile ilgileniyorsun? L\u00fctfen ad\u0131n\u0131 yaz (\u00f6rne\u011fin Bo\u011fazi\u00e7i, ODT\u00dc, \u0130stanbul \u00fcniversitesi), senin i\u00e7in g\u00fcncel takvime bakay\u0131m.",
                "ar": "\u0645\u0645\u062a\u0627\u0632! \ud83c\udf93 \u0645\u0627 \u0647\u064a \u0627\u0644\u062c\u0627\u0645\u0639\u0629 \u0627\u0644\u062a\u064a \u062a\u0648\u062f \u0627\u0644\u0627\u0633\u062a\u0641\u0633\u0627\u0631 \u0639\u0646\u0647\u0627\u061f \u064a\u0631\u062c\u0649 \u0643\u062a\u0627\u0628\u0629 \u0627\u0633\u0645\u0647\u0627 (\u0645\u062b\u0644\u0627\u064b \u062c\u0627\u0645\u0639\u0629 \u0625\u0633\u0637\u0646\u0628\u0648\u0644\u060b \u0628\u0648\u063a\u0627\u0632\u064a\u062a\u0634\u064a\u060b ODT\u00dc) \u0648\u0633\u0623\u0628\u062d\u062b \u0644\u0643 \u0639\u0646 \u0645\u0648\u0639\u062f\u0647\u0627 \u0627\u0644\u0645\u062d\u062f\u062f."
            }.get(language, "Great! Which university are you targeting?")
            await wait_task
            return prompt, None, "Contextual Affirmative (Deadlines)"

        # --- Contextual Affirmative: user said yes to a PERMIT checklist / steps offer ---
        _checklist_markers = [
            "want the checklist", "checklist?", "want the steps", "shall i generate",
            "show you the", "fire compliance", "itfaiye", "baca certificate", "same permit",
            "same requirement", "fire safety", "municipality", "gıda sicil",
            "let me pull up", "should i generate", "want me to generate",
            "shall i prepare", "want a full roadmap", "full roadmap",
            "want your roadmap", "roadmap?", "adım adım", "yol harita",
            "İzinler gerekiyor", "ruhsat", "permit", "show the steps",
            "\u0647\u0644 \u062a\u0631\u064a\u062f", "\u0627\u0644\u062e\u0637\u0648\u0627\u062a", "\u0627\u0644\u0642\u0627\u0626\u0645\u0629", "\u0627\u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a"
        ]
        if any(marker in last_assistant_msg for marker in _checklist_markers):
            # Extract business type + district from conversation history
            from utils.protocol import get_localized_steps, _detect_type
            from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan, AgentStep
            from datetime import datetime

            _hist_lower = (history_text or "").lower()
            # Find district in history
            _found_district = "Istanbul"
            for d in _ALL_DISTRICTS:
                if d in _hist_lower:
                    _found_district = d.title()
                    break
            # Find business type in history
            _found_btype_raw = "general"
            for bt in _ALL_BUSINESS_TYPES:
                if bt in _hist_lower:
                    _found_btype_raw = bt
                    break
            _found_btype = _detect_type(_found_btype_raw)

            step_specs = get_localized_steps(language, _found_btype)
            details, steps_list, agent_steps = [], [], []
            for spec in step_specs:
                id_val, title, resp, note = spec[0], spec[1], spec[2], spec[3]
                step_docs = list(spec[4]) if len(spec) > 4 else []
                details.append(StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note, docs=step_docs))
                steps_list.append(title)
                agent_steps.append(AgentStep(title=title, description=note, documents=step_docs))

            _timeline = {"food": 45, "retail": 35, "service": 30}.get(_found_btype, 40)
            _permits = {"food": ["İşyeri Açma Ruhsatı", "Gıda Sicil Belgesi", "İtfaiye Raporu"],
                        "retail": ["İşyeri Açma Ruhsatı", "Vergi Levhası"],
                        "service": ["İşyeri Açma Ruhsatı", "Mesleki Yeterlilik"]}.get(_found_btype, ["İşyeri Açma Ruhsatı"])
            _agencies = {"food": ["Municipality", "İtfaiye", "Tarım Bakanlığı", "Vergi Dairesi"],
                         "retail": ["Municipality", "Vergi Dairesi", "Ticaret Odası"],
                         "service": ["Municipality", "Vergi Dairesi", "Mesleki Kuruluş"]}.get(_found_btype, ["Municipality", "Vergi Dairesi"])
            _docs = {"food": ["Lease Agreement", "Tax Number", "Company Docs", "Gıda Sicil Formu", "İtfaiye Raporu", "Baca Belgesi"],
                     "retail": ["Lease Agreement", "Tax Number", "Company Docs", "Vergi Levhası"],
                     "service": ["Lease Agreement", "Tax Number", "Company Docs", "Mesleki Belge"]}.get(_found_btype, ["Lease Agreement", "Tax Number", "Company Docs"])

            _summ = {
                "en": f"Here's your complete {_found_btype_raw} permit roadmap for {_found_district}! Follow these {len(steps_list)} steps to open legally.",
                "tr": f"İşte {_found_district} için {_found_btype_raw} ruhsat yol haritanız! Yasal olarak açmak için bu {len(steps_list)} adımı takip edin.",
                "ar": f"إليك خارطة طريق رخصة {_found_btype_raw} في {_found_district}! اتبع هذه الخطوات الـ {len(steps_list)} لفتح نشاطك التجاري قانونياً.",
            }.get(language, f"Here's your {_found_btype_raw} roadmap for {_found_district}!")
            _labels = {"en": {"ag": "Agencies", "dc": "Documents", "st": "Steps", "tm": "Timeline", "dy": "days"},
                       "tr": {"ag": "Kurumlar", "dc": "Belgeler", "st": "Adımlar", "tm": "Tahmini Süre", "dy": "gün"},
                       "ar": {"ag": "الجهات", "dc": "المستندات", "st": "الخطوات", "tm": "المدة", "dy": "يوم"}}.get(language, {"ag": "Agencies", "dc": "Documents", "st": "Steps", "tm": "Timeline", "dy": "days"})

            combined = CombinedPermitResult(permits=_permits, agencies=_agencies, documents=_docs, steps=agent_steps, timeline_days=_timeline, summary=_summ, location=_found_district, business_type=_found_btype)
            state = PermitState(business_profile={"raw_query": query, "language": language}, combined_result=combined, permit_plan=PermitPlan(permits=_permits, agencies=_agencies, documents=_docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Planner"]), last_updated=datetime.now())
            out_str = (f"💬 {_summ}\n\n📋 **{_labels['ag']}:** {', '.join(_agencies)}\n📄 **{_labels['dc']}:** {', '.join(_docs[:5])}\n✅ **{_labels['st']}:**\n"
                       + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list))
                       + f"\n\n⏱️ **{_labels['tm']}:** {_timeline} {_labels['dy']}")
            dashboard_dump = state.model_dump()
            if hasattr(dashboard_dump.get("last_updated"), "isoformat"):
                dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
            print(f"[Smart Router] ✅ Contextual Affirmative → direct permit roadmap for '{_found_btype_raw}' in '{_found_district}'")
            await wait_task
            return out_str, dashboard_dump, "Contextual Affirmative (Permit Steps)"
    # --- PHASE 0.5a: Contextual Negative Check ---
    # Intercepts "no/nope/nah/hayır/لا" BEFORE AI fallback so the agent never
    # resets and greets the user fresh (fixes the "Hi! Let's get things moving" bug).
    _negatives = {
        "no", "nope", "nah", "not really", "no thanks", "no thank you",
        "hayir", "hayır", "yok", "olmaz",
        "\u0644\u0627", "\u0644\u0627 \u0634\u0643\u0631\u0627", "\u0644\u0627 \u064a\u0648\u062c\u062f", "\u0645\u0627 \u0639\u0646\u062f\u064a", "\u0645\u0648 \u0645\u062d\u062a\u0627\u062c",
    }
    if lower_q in _negatives and last_assistant_msg:
        _was_outdoor  = any(w in last_assistant_msg for w in ["outdoor", "terrace", "kaldirim", "sidewalk"])
        _was_alcohol  = any(w in last_assistant_msg for w in ["alcohol", "tapdk", "wine", "beer", "bar", "liquor"])
        _was_music    = any(w in last_assistant_msg for w in ["music", "live music", "band", "entertainment"])
        _was_yes_no   = any(w in last_assistant_msg for w in [
            "do you", "will you", "are you", "planning", "have you", "did you",
            "is there", "would you", "want", "shall i", "should i"
        ])

        _neg_reply = None
        if _was_outdoor:
            _neg_reply = {
                "en": "Got it, no outdoor seating! \ud83d\udc4d No Kaldirim Isgaliye permit needed then. Is there anything else about your setup you'd like to go over?",
                "tr": "Anla\u015ft\u0131k, d\u0131\u015f mekan yok! \ud83d\udc4d Kald\u0131r\u0131m i\u015fgaliyesine gerek olmayacak. Ba\u015fka sormak istedi\u011fin bir \u015fey var m\u0131?",
                "ar": "\u062a\u0645\u0627\u0645! \u0644\u0627 \u062c\u0644\u0633\u0627\u062a \u062e\u0627\u0631\u062c\u064a\u0629. \ud83d\udc4d \u0644\u0646 \u062a\u062d\u062a\u0627\u062c \u062a\u0635\u0631\u064a\u062d \u0627\u0644\u0643\u0644\u062f\u0631\u064a\u0645. \u0647\u0644 \u0647\u0646\u0627\u0643 \u0634\u064a\u0621 \u0622\u062e\u0631 \u062a\u0648\u062f \u0645\u0639\u0631\u0641\u062a\u0647\u061f",
            }.get(language, "Got it, no outdoor seating! No Kaldirim Isgaliye permit needed. Anything else?")
        elif _was_alcohol:
            _neg_reply = {
                "en": "No alcohol \u2014 noted! \ud83d\udc4d No TAPDK license needed, which saves you time and paperwork. Ready to move to the next step?",
                "tr": "Alkol yok \u2014 tamam! \ud83d\udc4d TAPDK lisans\u0131na gerek olmayacak. S\u0131radaki ad\u0131ma ge\u00e7elim mi?",
                "ar": "\u0644\u0627 \u0643\u062d\u0648\u0644 \u2014 \u062a\u0645\u0627\u0645! \ud83d\udc4d \u0644\u0646 \u062a\u062d\u062a\u0627\u062c \u0625\u0644\u0649 \u062a\u0631\u062e\u064a\u0635 TAPDK. \u0647\u0644 \u0646\u0643\u0645\u0644 \u0628\u0627\u0642\u064a \u0627\u0644\u062e\u0637\u0648\u0627\u062a\u061f",
            }.get(language, "No alcohol \u2014 noted! No TAPDK license needed. Ready for the next step?")
        elif _was_music:
            _neg_reply = {
                "en": "No live music \u2014 got it! \ud83d\udc4d No Canl\u0131 M\u00fczik \u0130zni needed. What else would you like to know?",
                "tr": "Canl\u0131 m\u00fczik yok \u2014 anla\u015ft\u0131k! \ud83d\udc4d Canl\u0131 m\u00fczik izni gerekmeyecek. Ba\u015fka sorun var m\u0131?",
                "ar": "\u0644\u0627 \u0645\u0648\u0633\u064a\u0642\u0649 \u062d\u064a\u0629 \u2014 \u062a\u0645\u0627\u0645! \ud83d\udc4d \u0644\u0646 \u062a\u062d\u062a\u0627\u062c \u062a\u0635\u0631\u064a\u062d \u0627\u0644\u0645\u0648\u0633\u064a\u0642\u0649. \u0647\u0644 \u0647\u0646\u0627\u0643 \u0634\u064a\u0621 \u0622\u062e\u0631\u061f",
            }.get(language, "No live music \u2014 noted! No Canl\u0131 M\u00fczik \u0130zni needed. Anything else?")
        elif _was_yes_no:
            _neg_reply = {
                "en": "No worries! \ud83d\udc4d What would you like to cover next?",
                "tr": "Sorun de\u011fil! \ud83d\udc4d Devam etmek istedi\u011fin bir konu var m\u0131?",
                "ar": "\u0644\u0627 \u0628\u0623\u0633! \ud83d\udc4d \u0645\u0627\u0630\u0627 \u062a\u0631\u064a\u062f \u0623\u0646 \u062a\u0639\u0631\u0641 \u0628\u0639\u062f\u0647\u0627\u061f",
            }.get(language, "No worries! What would you like to cover next?")

        if _neg_reply:
            print(f"[Smart Router] Contextual Negative -> handled locally (query='{lower_q}')")
            await wait_task
            return _neg_reply, None, "Contextual Negative Handler"

    # --- PHASE 0.5b: Contextual University Reply ---

    _was_asking_uni = any(marker in last_assistant_msg for marker in [
        "which university", "hangi \u00fcniversite", "\u0641\u064a \u0623\u064a \u062c\u0627\u0645\u0639\u0629",
        "register at", "kay\u0131t yapt\u0131rmak", "\u0627\u0644\u062a\u0633\u062c\u064a\u0644",
        "type the name", "please type the name"
    ])
    
    _reply_uni = None
    if assistant_type == "student" and len(query.split()) <= 5:
        for key, val in _UNI_MAP.items():
            if key == lower_q or (f" {key} " in f" {lower_q} "):
                _reply_uni = val
                break
        if not _reply_uni and len(lower_q) >= 3:
            for key, val in _UNI_MAP.items():
                if _fuzzy_match(lower_q, [key], threshold=0.85):
                    _reply_uni = val
                    break

    if (_was_asking_uni or _reply_uni) and assistant_type == "student":
        if not _reply_uni:
            for key, val in _UNI_MAP.items():
                if key in lower_q:
                    _reply_uni = val
                    break
        
        if not _reply_uni:
            for key, val in _UNI_MAP.items():
                for word in lower_q.split():
                    if len(word) >= 3 and _fuzzy_match(word, [key], threshold=0.75):
                        _reply_uni = val
                        break
                if _reply_uni: break
            

        if _reply_uni:
            from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan, AgentStep
            from utils.protocol import get_localized_steps
            from datetime import datetime
            deadline_info = _UNI_DEADLINES.get(_reply_uni, {}).get(language, "August")
            prompt_summ = {
                "en": f"Perfect! \ud83c\udf93 Here's your complete registration roadmap for **{_reply_uni}**! The general registration window is around **{deadline_info}**.",
                "tr": f"Harika! \ud83c\udf93 **{_reply_uni}** i\u00e7in kay\u0131t yol haritan\u0131 haz\u0131rlad\u0131m! Genel kay\u0131t d\u00f6nemi yakla\u015f\u0131k **{deadline_info}**.",
                "ar": f"\u0645\u0645\u062a\u0627\u0632! \ud83c\udf93 \u0625\u0644\u064a\u0643 \u062e\u0627\u0631\u0637\u0629 \u0637\u0631\u064a\u0642 \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0643\u0627\u0645\u0644\u0629 \u0644\u062c\u0627\u0645\u0639\u0629 **{_reply_uni}**! \u0646\u0627\u0641\u0630\u062f \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u0639\u0627\u0645\u0629 \u062a\u0643\u0648\u0646 \u062d\u0648\u0644 **{deadline_info}**."
            }.get(language, f"Perfect! \ud83c\udf93 Here's your registration roadmap for **{_reply_uni}**!")
            _bt = "student.register_uni"
            step_specs = get_localized_steps(language, _bt)
            details, steps_list, agent_steps = [], [], []
            for spec in step_specs:
                id_val, title, resp, note = spec[0], spec[1], spec[2], spec[3]
                step_docs = list(spec[4]) if len(spec) > 4 else []
                details.append(StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note, docs=step_docs))
                steps_list.append(title)
                agent_steps.append(AgentStep(title=title, description=note, documents=step_docs))
            labels = {"en": {"ag": "Key Institutions", "dc": "Essential Documents", "st": "Registration Steps"}, "tr": {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Kayıt Adımları"}, "ar": {"ag": "\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a", "dc": "\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629", "st": "\u062e\u0637\u0648\u0627\u062a \u0627\u0644\u062a\u0633\u062c\u064a\u0644"}}.get(language, {"ag": "Agencies", "dc": "Docs", "st": "Steps"})
            agencies = ["University Registrar", "Portal / OBS", "MEB (Denklik)"]
            docs = ["Admission Letter", "Passport", "Original Diploma", "Apostille", "Photos"]
            combined = CombinedPermitResult(permits=[f"{_reply_uni} Registration"], agencies=agencies, documents=docs, steps=agent_steps, timeline_days=15, summary=prompt_summ, location=_reply_uni, business_type=_bt)
            state = PermitState(business_profile={"raw_query": query, "language": language, "university": _reply_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[_reply_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Agent"]), last_updated=datetime.now())
            loc_data = _UNI_LOCATIONS.get(_reply_uni, {}).get(language, "")
            loc_block = f"📍 **Location:** {loc_data}\n\n" if loc_data else ""
            out_str = f"{loc_block}💬 {prompt_summ}\n\n📋 **{labels['ag']}:** {', '.join(agencies)}\n📄 **{labels['dc']}:** {', '.join(docs)}\n✅ **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list))
            dashboard_dump = state.model_dump()
            if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
            await wait_task
            return out_str, dashboard_dump, "Smart Router (Uni Shortcut)"


    user_blocks = re.findall(r"\[user\]:([\s\S]*?)(?=\[assistant\]:|\[user\]:|-{5,}|$)", history_text.lower())
    user_history_text = " ".join(b.strip() for b in user_blocks)
    combined_context = f"{user_history_text} {query}".lower()
    
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1] if "[assistant]:" in history_text.lower() else ""
    is_clarifying = any(k in last_assistant_msg for k in [
        "what type of business", "hangi t\u00fcr i\u015fletme", "\u0645\u0627 \u0647\u0648 \u064bd\u0648\u0639 \u0627\u0644\u0639\u0645\u0644",
        "which district", "hangi il\u00e7esinde", "\u0641\u064a \u0623\u064a \u0645\u0646\u0637\u0642\u0629",
        "which university", "hangi \u00fcniversite", "\u0641\u064a \u0623\u064a \u062c\u0627\u0645\u0639\u0629"
    ])
    
    has_relevant_kw = any(w in query.lower() for w in [
        "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis", "pharmacy", "eczane", "bakery", "fırın", "barber", "berber", "gym", "spor", "shop", "store", "company", "mağaza", "dükkan",
        "adalar", "arnavutkoy", "arnavutköy", "atasehir", "ataşehir", "avcilar", "avcılar", "bagcilar", "bağcılar", "bahcelievler", "bahçelievler", "bakirkoy", "bakırköy", "basaksehir", "başakşehir", "bayrampasa", "bayrampaşa", "besiktas", "beşiktaş", "beykoz", "beylikduzu", "beylikdüzü", "beyoglu", "beyoğlu", "buyukcekmece", "büyükçekmece", "catalca", "çatalca", "cekmekoy", "çekmeköy", "esenler", "esenyurt", "eyup", "eyüp", "eyüpsultan", "fatih", "gaziosmanpasa", "gaziosmanpaşa", "gungoren", "güngören", "kadikoy", "kadıköy", "kagithane", "kağıthane", "kartal", "kucukcekmece", "küçükçekmece", "maltepe", "pendik", "sancaktepe", "sariyer", "sarıyer", "sile", "şile", "silivri", "sisli", "şişli", "sultanbeyli", "sultangazi", "tuzla", "umraniye", "ümraniye", "uskudar", "ücküdar", "zeytinburnu",
        "yenibosna", "sirinevler", "sirineveler", "şirinevler", "taksim", "istiklal", "florya", "yesilkoy", "yeşilköy", "maslak", "tarabya", "etiler", "levent", "bebek", "mecidiyekoy", "mecidiyeköy", "nisantasi", "nişantaşı", "karakoy", "karaköy", "galata", "cihangir", "moda", "suadiye", "caddebostan", "bostanci", "eminonu", "eminönü", "sultanahmet", "balat", "kayasehir", "kayashier", "kayaşehir"
    ])
    
    fuzzy_district_match = None
    fuzzy_business_match = None
    
    _has_exact_district = any(w in query.lower() for w in _ALL_DISTRICTS)
    _has_exact_business = any(w in query.lower() for w in _ALL_BUSINESS_TYPES)

    for word in query.lower().split():
        if not _has_exact_district and not fuzzy_district_match:
            fuzzy_district_match = _fuzzy_match(word, _ALL_DISTRICTS)
        if not _has_exact_business and not fuzzy_business_match:
            fuzzy_business_match = _fuzzy_match(word, _ALL_BUSINESS_TYPES)

    if fuzzy_district_match or fuzzy_business_match:
        has_relevant_kw = True
        if fuzzy_district_match:
            combined_context += f" {fuzzy_district_match}"
        if fuzzy_business_match:
            combined_context += f" {fuzzy_business_match}"
    
    early_intent_group, early_sub_intent, early_confidence = detect_intent(query, assistant_type, context_text=last_assistant_msg)
    
    # --- SMART VISA CLARIFICATION (Student-only, runs before keyword matching) ---
    # GUARD: If user's query clearly signals university registration, skip visa flow
    _registration_signals = ["register", "enroll", "university", "uni ", "uni?", "uni\n", "registration", "how to register", "how can i register"]
    _is_registration_query = any(s in query.lower() for s in _registration_signals)
    
    if assistant_type == "student" and early_intent_group == "student" and early_sub_intent == "visa" and not _is_registration_query:
        from .context_engine import parse_context, ConversationState
        
        print(f"[SmartRouter DEBUG] Visa query detected: '{query}'")
        print(f"[SmartRouter DEBUG] History available: {bool(history_text)}")
        
        context_state = parse_context(history_text) if history_text else ConversationState()
        
        print(f"[SmartRouter DEBUG] visa_asked_clarify={context_state.visa_asked_clarify}, visa_status={context_state.visa_status}")
        
        # First mention of visa in this conversation → ask clarifying question
        if not context_state.visa_asked_clarify:
            visa_clarify_response = _library.get(language, {}).get("student", {}).get("visa_clarify")
            print(f"[SmartRouter DEBUG] Fetching visa_clarify: {visa_clarify_response is not None}")
            if visa_clarify_response:
                clarify_choice = random.choice(visa_clarify_response) if isinstance(visa_clarify_response, list) else visa_clarify_response
                response_cache.set(query, clarify_choice, assistant_type, language)
                await wait_task
                print(f"\n[Smart Router] 🎓 VISA CLARIFICATION: Asking status before providing info")
                return clarify_choice, None, "Visa Status Clarification"
        
        # User already answered clarifying question → detect their answer
        lower_q = query.lower().strip()
        
        # Check if they said YES (already have visa)
        if any(word in lower_q for word in ["yes", "yeah", "yep", "already have", "got it", "i have", "obtained", "approved", "evet", "aldım", "var", "نعم", "حصلت", "عندي"]):
            next_steps = _library.get(language, {}).get("student", {}).get("visa_already_have")
            if next_steps:
                response = random.choice(next_steps) if isinstance(next_steps, list) else next_steps
                response_cache.set(query, response, assistant_type, language)
                await wait_task
                print(f"\n[Smart Router] 🎓 USER HAS VISA: Guiding to residence permit next steps")
                return response, None, "Visa – Already Approved"
        
        # Check if they said NO (haven't applied yet)
        elif any(word in lower_q for word in ["no", "not yet", "haven't", "need to apply", "not applied", "still applying", "hayır", "almadım", "yok", "لا", "لم", "ما عندي"]):
            not_applied = _library.get(language, {}).get("student", {}).get("visa_not_applied")
            if not_applied:
                response = random.choice(not_applied) if isinstance(not_applied, list) else not_applied
                response_cache.set(query, response, assistant_type, language)
                await wait_task
                print(f"\n[Smart Router] 🎓 USER NEEDS VISA: Asking which consulate")
                return response, None, "Visa – Not Applied"
        
        # Check if they mentioned a specific consulate location
        from .context_engine import _CITY_ALIASES
        for city, canonical in _CITY_ALIASES.items():
            if city in lower_q and any(word in lower_q for word in ["apply", "from", "consulate", "embassy"]):
                # Build the consulate response key (e.g., "visa_consulate_riyadh")
                city_key = city.replace(" ", "_").replace(",", "").lower()
                consulate_key = f"visa_consulate_{city_key.split()[0]}"
                
                consulate_response = _library.get(language, {}).get("student", {}).get(consulate_key)
                if consulate_response:
                    response = random.choice(consulate_response) if isinstance(consulate_response, list) else consulate_response
                    response_cache.set(query, response, assistant_type, language)
                    await wait_task
                    print(f"\n[Smart Router] 🎓 CONSULATE DETECTED: {canonical}")
                    return response, None, f"Visa – {canonical} Consulate Info"
                break
    
    if early_confidence == 0 and _META_QUERY_RE.search(query) and len(query.split()) > 4:
        print(f"[SmartRouter] Meta-query detected with no keyword match ('{query[:30]}...'). Bypassing for AI orchestrator.")
        return None, None, "Meta-Query Bypass"

    # --- PHASE 0.6: Process Redirects BEFORE Roadmap Builder ---
    if early_confidence > 0 and early_intent_group == "redirect":
        target_agent = early_sub_intent.split(":", 1)[0] if early_sub_intent and ":" in early_sub_intent else early_sub_intent
        if target_agent == "lawyer": suffix = {"tr": "Bu konu hukuki uzmanl\u0131k gerektirmektedir. L\u00fctfen yukar\u0131dan **Avukat Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u064a\u062a\u0637\u0644\u0628 \u062e\u0628\u0631\u0629 \u0642\u0627\u0646\u0648\u0646\u064a\u0629. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0627\u0644\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u0642\u0627\u0646\u0648\u0646\u064a** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "This topic requires legal expertise. Please switch to **Lawyer Agent** mode."}.get(language, "Switch to Lawyer mode.")
        elif target_agent == "student": suffix = {"tr": "\u00d6\u011frenci prosed\u00fcrleri i\u00e7in l\u00fctfen yukar\u0131dan **\u00d6\u011frenci Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0627\u0644\u0637\u0644\u0627\u0628\u064a\u0629\u060b \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0627\u0644\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u0637\u0644\u0627\u0628\u064a** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "For student procedures, please switch to **Student Agent** mode."}.get(language, "Switch to Student mode.")
        else: suffix = {"tr": "\u0130\u015fletme ruhsat\u0131 i\u015flemleri i\u00e7in l\u00fctfen yukar\u0131dan **Ruhsat Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u062a\u0631\u0627\u062e\u064a\u0636 \u0627\u0644\u0623\u0639\u0645\u0627\u0644\u060b \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u062a\u0631\u0627\u062e\u064a\u0636** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "For business permit procedures, please switch to **Permit Agent** mode."}.get(language, "Switch to Permit mode.")
        # Guard: Student agent asking about university registration should NEVER
        # be redirected to the Permit Agent, even if a district name appears.
        _student_reg_signals = ["register", "enroll", "university", "uni ", "apply", "admission", "registration"]
        _is_student_reg_query = assistant_type == "student" and any(s in query.lower() for s in _student_reg_signals)
        if _is_student_reg_query and target_agent == "permit":
            print(f"[SmartRouter] Suppressing permit redirect — student is asking about university registration.")
        else:
            # Add special action keyword 'REDIRECT_NEW_CHAT:target|message' so the frontend opens a new chat with correct agent
            msg = f"REDIRECT_NEW_CHAT:{target_agent}|{suffix}"
            await wait_task
            return msg, None, f"Smart Router (Redirect to {target_agent})"

    if _NEW_CONSULTATION_RE.search(query) or _ISOLATED_ANSWER_RE.match(query) or is_clarifying:
        from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan, AgentStep
        from utils.protocol import get_localized_steps
        from datetime import datetime

        _is_plan = any(m in last_assistant_msg for m in ["\u2705", "\ud83d\udccb", "\ud83d\udcc4", "\u23f1\ufe0f", "Kurumlar", "Institutions", "\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a"])
        has_completed_roadmap = bool(last_assistant_msg and len(last_assistant_msg) > 100 and _is_plan and not is_clarifying)
        
        if _NEW_CONSULTATION_RE.search(query) and has_completed_roadmap:
            if user_name:
                msg = {
                    "en": "REDIRECT_NEW_CHAT: \u26a0\ufe0f It looks like you want to start a new procedure! Opening a **New Chat** automatically to keep your current progress safe...",
                    "tr": "REDIRECT_NEW_CHAT: \u26a0\ufe0f G\u00f6r\u00fcn\u00fc\u015fe g\u00f6re yeni bir i\u015fleme ba\u015flamak istiyorsun! Mevcut \u00e7al\u0131\u015fma alan\u0131n\u0131 kaybetmemek i\u00e7in otomatik olarak **Yeni Sohbet** a\u00e7\u0131l\u0131yor...",
                    "ar": "REDIRECT_NEW_CHAT: \u26a0\ufe0f \u064a\u0628\u062f\u0648 \u0623\u0646\u0643 \u062a\u0631\u064a\u062f \u0628\u062f\u0621 \u0625\u062c\u0631\u0627\u0621 \u062c\u062f\u064a\u062f! \u062c\u0627\u0631\u064a \u0641\u062a\u062d **\u062f\u0631\u062f\u0634\u0629 \u062c\u062f\u064a\u062f\u0629** \u062a\u0644\u0642\u0627\u0626\u064a\u0627\u064b \u0644\u0644\u062d\u0641\u0627\u0638 \u0639\u0644\u0649 \u062a\u0642\u062f\u0645\u0643 \u0627\u0644\u062d\u0627\u0644\u064a \u0641\u064a \u0623\u0645\u0627\u0646..."
                }.get(language, "REDIRECT_NEW_CHAT: Opening a New Chat for this procedure.")
            else:
                msg = {
                    "en": "REDIRECT_NEW_CHAT: \ud83c\udf93 Let's start fresh! I'll open a **New Chat** for your new request so we can map out a clean roadmap for you.",
                    "tr": "REDIRECT_NEW_CHAT: \ud83c\udf93 Temiz bir ba\u015flang\u0131\u00e7 yapal\u0131m! Yeni iste\u011fin i\u00e7in **Yeni Sohbet** a\u00e7\u0131yorum, her \u015feyi ba\u015ftan planlayabilmemiz i\u00e7in.",
                    "ar": "REDIRECT_NEW_CHAT: \ud83c\udf93 \u0644\u0646\u0628\u062f\u0623 \u0645\u0646 \u062c\u062f\u064a\u062f! \u0633\u0623\u0641\u062a\u062d **\u062f\u0631\u062f\u0634\u0629 \u062c\u062f\u064a\u062f\u0629** \u0644\u0637\u0644\u0628\u0643 \u0627\u0644\u062c\u062f\u064a\u062f \u062d\u062a\u064a \u064b\u062a\u0645\u0643\u0646 \u0645\u0646 \u0631\u0633\u0645 \u062e\u0631\u064a\u0637\u0629 \u0637\u0631\u064a\u0642 \u0646\u0638\u064a\u0641\u0629 \u0644\u0643."
                }.get(language, "REDIRECT_NEW_CHAT: Opening a New Chat for your new request.")
            await wait_task
            return msg, None, "Smart Router (Topic Redirect)"

        if assistant_type == "permit":
            _BUSINESS_KEYWORDS = [
                (["restaurant", "restoran", "lokanta", "dining", "dinner", "resteruant", "resteraunt"], "Restaurant", "Restoran", "\u0645\u0637\u0639\u0645"),
                (["cafe", "kafe", "coffee shop", "kahve", "pastane", "tea house", "caffe", "cafee"], "Caf\u00e9", "Kafe", "\u0645\u0642\u0627\u0647\u064a"),
                (["bakery", "f\u0131r\u0131n", "fir\u0131n", "bread", "pastry", "cafetaria"], "Bakery", "F\u0131r\u0131n", "\u0645\u062e\u0628\u0632"),
                (["pharmacy", "eczane", "chemist", "drugstore"], "Pharmacy", "Eczane", "\u0635\u064a\u062f\u0644\u064a\u0629"),
                (["barber", "berber", "hair salon", "kuaf\u00f6r", "kuafor", "beauty", "g\u00fczellik", "spa"], "Hair Salon / Beauty", "Kuaf\u00f6r / G\u00fczellik Salonu", "\u0635\u0627\u0644\u0648\u0646 \u062d\u0644\u0627\u0642\u0629 / \u062a\u062c\u0645\u064a\u0644"),
                (["gym", "fitness", "spor salonu", "crossfit"], "Gym / Fitness Centre", "Spor Salonu / Fitness", "\u0635\u0627\u0644\u0629 \u0623\u0644\u0639\u0627\u0628 \u0631\u064a\u0627\u0636\u064a\u0629"),
                (["clothing", "giyim", "boutique", "apparel", "fashion", "ma\u011faza", "d\u00fckkan"], "Clothing Store", "Giyim Ma\u011fazas\u0131", "\u0645\u062a\u062c\u0631 \u0645\u0644\u0627\u0628\u0633"),
                (["retail", "shop", "store", "market", "grocery", "bakkal"], "Retail Shop", "Perakende Ma\u011faza", "\u0645\u062a\u062c\u0631 \u062a\u062c\u0632\u0626\u0629"),
                (["office", "ofis", "consulting", "dan\u0131\u015fmanl\u0131k", "agency", "b\u00fcro"], "Office / Consultancy", "Ofis / Dan\u0131\u015fmanl\u0131k", "\u0645\u0643\u062a\u0628 / \u0627\u0633\u062a\u0634\u0627\u0631\u0627\u062a"),
                (["tech", "software", "yaz\u0131l\u0131m", "startup"], "Tech / Software Company", "Teknoloji / Yaz\u0131l\u0131m \u015eirketi", "\u0634\u0631\u0643\u0629 \u062a\u0642\u0646\u064a\u0629 / \u0628\u0631\u0645\u062c\u064a\u0627\u062a"),
                (["hotel", "hostel", "accommodation", "konaklama"], "Hotel / Accommodation", "Otel / Konaklama", "\u0641\u0646\u062f\u0642 / \u0625\u0642\u0627\u0645\u0629"),
                (["clinic", "klinik", "medical", "dental", "doctor", "doktor", "di\u015f"], "Medical Clinic", "T\u0131bbi Klinik", "\u0639\u064a\u0627\u062f\u0629 \u0637\u0628\u064a\u0629"),
                (["school", "okul", "education", "dershane", "kurs"], "Educational Centre", "E\u011fitim Merkezi", "\u0645\u0631\u0643\u0632 \u062a\u0639\u0644\u064a\u0645\u064a"),
            ]
            
            business_type_en, business_type_tr, business_type_ar = "Business", "\u0130\u015fletme", "\u0639\u0645\u0644"
            for kw_list, en_n, tr_n, ar_n in _BUSINESS_KEYWORDS:
                if any(kw in query.lower() for kw in kw_list):
                    business_type_en, business_type_tr, business_type_ar = en_n, tr_n, ar_n
                    break
            if business_type_en == "Business":
                for kw_list, en_n, tr_n, ar_n in _BUSINESS_KEYWORDS:
                    hist_lower = user_history_text.lower()
                    if any(kw in hist_lower for kw in kw_list):
                        business_type_en, business_type_tr, business_type_ar = en_n, tr_n, ar_n
                        break
            
            business_type = {"ar": business_type_ar, "tr": business_type_tr, "en": business_type_en}.get(language, business_type_en)
            if business_type == "Business" and fuzzy_business_match:
                for kw_list, en_n, tr_n, ar_n in _BUSINESS_KEYWORDS:
                    if fuzzy_business_match in kw_list:
                        business_type = {"ar": ar_n, "tr": tr_n, "en": en_n}.get(language, en_n)
                        break

            _DISTRICT_INFO = {
                "adalar":      ("Adalar",      "Adalar Municipality",      "Permits in the Princes' Islands involve strict environmental and coastal regulations.",  "Adalar Belediyesi",      "Prens Adalar\u0131'ndaki izinler s\u0131k\u0131 \u00e7evresel ve k\u0131y\u0131 d\u00fczenlemeleri i\u00e7erir.",   "\u0628\u0644\u062f\u064a\u0629 \u0623\u062f\u0627\u0644\u0627\u0631",          "\u062a\u062a\u0636\u0645\u0646 \u0627\u0644\u062a\u0635\u0627\u0631\u064a\u062d \u0641\u064a \u062c\u0632\u0631 \u0627\u0644\u0623\u0645\u064a\u0631\u0627\u062a \u0644\u0648\u0627\u0626\u062d \u0628\u064a\u0626\u064a\u0629 \u0648\u0633\u0627\u062d\u0644\u064a\u0629 \u0635\u0627\u0631\u0645\u0629."),
                "arnavutkoy":  ("Arnavutk\u00f6y",  "Arnavutk\u00f6y Municipality",  "New airport area growth district.",                                                     "Arnavutk\u00f6y Belediyesi",  "Yeni havaliman\u0131 b\u00f6lgesinde b\u00fcy\u00fck il\u00e7e.",                                        "\u0628\u0644\u062f\u064a\u0629 \u0623\u0631\u0646\u0627\u0648\u0648\u0637 \u0643\u064a",    "\u0645\u0646\u0637\u0642\u0629 \u0646\u0645\u0648 \u0628\u062c\u0648\u0627\u0631 \u0627\u0644\u0645\u0637\u0627\u0631 \u0627\u0644\u062c\u062f\u064a\u062f."),
                "atasehir":    ("Ata\u015fehir",    "Ata\u015fehir Municipality",    "Modern business district, fast permit processing.",                                    "Ata\u015fehir Belediyesi",    "Modern i\u015f b\u00f6lgesi, h\u0131zl\u0131 ruhsat i\u015flemleri.",                                    "\u0628\u0644\u062f\u064a\u0629 \u0623\u062a\u0627\u0634\u0647\u064a\u0631",      "\u0645\u0646\u0637\u0642\u0629 \u0623\u0639\u0645\u0627\u0644 \u062d\u062f\u064a\u062b\u0629\u060c \u0645\u0639\u0627\u0645\u0644\u0627\u062a \u0633\u0631\u064a\u0639\u0629."),
                "avcilar":     ("Avc\u0131lar",     "Avc\u0131lar Municipality",     "University area, affordable rents.",                                                    "Avc\u0131lar Belediyesi",     "\u00dcniversite b\u00f6lgesi, uygun kiralar.",                                                "\u0628\u0644\u062f\u064a\u0629 \u0623\u0641\u062c\u0644\u0627\u0631",       "\u0645\u0646\u0637\u0642\u0629 \u062c\u0627\u0645\u0639\u064a\u0629\u060c \u0625\u064a\u062c\u0627\u0631\u0627\u062a \u0645\u0639\u0642\u0648\u0644\u0629."),
                "bagcilar":    ("Ba\u011fc\u0131lar",    "Ba\u011fc\u0131lar Municipality",    "Textile hub, busy commercial area.",                                                    "Ba\u011fc\u0131lar Belediyesi",    "Tekstil merkezi, yo\u011fun ticari alan.",                                              "\u0628\u0644\u062f\u064a\u0629 \u0628\u0627\u063a\u062c\u0644\u0627\u0631",      "\u0645\u0631\u0643\u0632 \u0627\u0644\u0646\u0633\u064a\u062c\u060c \u0645\u0646\u0637\u0642\u0629 \u062a\u062c\u0627\u0631\u064a\u0629 \u0645\u0632\u062f\u062d\u0645\u0629."),
                "bahcelievler":("Bah\u00e7elievler", "Bah\u00e7elievler Municipality", "Residential area, growing commercial scene.",                                           "Bah\u00e7elievler Belediyesi", "Konut alan\u0131, b\u00fcy\u00fcyen ticaret.",                                                    "\u0628\u0644\u062f\u064a\u0629 \u0628\u0647\u062c\u0644\u064a \u0627\u064a\u0641\u0644\u0631",  "\u0645\u0646\u0637\u0642\u0629 \u0633\u0643\u0646\u064a\u0629\u060c \u0646\u0634\u0627\u0637 \u062a\u062c\u0627\u0631\u064a \u0645\u062a\u0646\u0627\u0645\u064a."),
                "bakirkoy":    ("Bak\u0131rk\u00f6y",    "Bak\u0131rk\u00f6y Municipality",    "Premium commercial district, strict regulations.",                                     "Bak\u0131rk\u00f6y Belediyesi",    "Premium ticari b\u00f6lge, s\u0131k\u0131 d\u00fczenlemeler.",                                        "\u0628\u0644\u062f\u064a\u0629 \u0628\u0643\u0631\u0643\u0648\u064a",       "\u0645\u0646\u0637\u0642\u0629 \u062a\u062c\u0627\u0631\u064a\u0629 \u0645\u0645\u062a\u0627\u0632\u0629\u060c \u0644\u0648\u0627\u0626\u062d \u0635\u0627\u0631\u0645\u0629."),
                "basaksehir":  ("Ba\u015fak\u015fehir",  "Ba\u015fak\u015fehir Municipality",  "Modern suburban district, new hospital area.",                                         "Ba\u015fak\u015fehir Belediyesi",  "Modern yerle\u015fim, yeni hastane b\u00f6lgesi.",                                           "\u0628\u0644\u062f\u064a\u0629 \u0628\u0627\u0634\u0627\u0643 \u0634\u0647\u064a\u0631",   "\u0645\u0646\u0637\u0642\u0629 \u0636\u0648\u0627\u062d\u064a \u062d\u062f\u064a\u062b\u0629\u060c \u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0645\u0633\u062a\u0634\u0641\u0649 \u0627\u0644\u062c\u062f\u064a\u062f."),
                "besiktas":    ("Be\u015fikta\u015f",    "Be\u015fikta\u015f Municipality",    "Strict signage & frontage rules.",                                                     "Be\u015fikta\u015f Belediyesi",    "S\u0131k\u0131 tabela ve cephe kurallar\u0131.",                                                  "\u0628\u0644\u062f\u064a\u0629 \u0628\u0634\u0643\u062a\u0627\u0634",       "\u0644\u0648\u0627\u0626\u062d \u0635\u0627\u0631\u0645\u0629 \u0644\u0644\u0627\u0641\u062a\u0627\u062a \u0648\u0627\u0644\u0648\u0627\u062c\u0647\u0627\u062a."),
                "beykoz":      ("Beykoz",      "Beykoz Municipality",      "Green area, environmental permits required.",                                           "Beykoz Belediyesi",      "Ye\u015fil alan, \u00e7evre izinleri gerekli.",                                                "\u0628\u0644\u062f\u064a\u0629 \u0628\u064a\u0643\u0648\u0632",         "\u0645\u0646\u0637\u0642\u0629 \u062e\u0636\u0631\u0627\u0621\u060c \u062a\u0635\u0627\u0631\u064a\u062d \u0628\u064a\u0626\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629."),
                "beylikduzu":  ("Beylikd\u00fcz\u00fc",  "Beylikd\u00fcz\u00fc Municipality",  "Affordable, fast-growing commercial zone.",                                            "Beylikd\u00fcz\u00fc Belediyesi",  "Uygun fiyatl\u0131, h\u0131zla b\u00fcy\u00fcyen ticari b\u00f6lge.",                                        "\u0628\u0644\u062f\u064a\u0629 \u0628\u064a\u0644\u064a\u0643 \u062f\u0648\u0632\u0648",  "\u0645\u0646\u0637\u0642\u0629 \u062a\u062c\u0627\u0631\u064a\u0629 \u0628\u0623\u0633\u0639\u0627\u0631 \u0645\u0639\u0642\u0648\u0644\u0629."),
                "beyoglu":     ("Beyo\u011flu",     "Beyo\u011flu Municipality",     "Taksim/Istiklal area, tourism-focused permits.",                                       "Beyo\u011flu Belediyesi",     "Taksim/\u0130stiklal b\u00f6lgesi, turizm odakl\u0131 ruhsatlar.",                                "\u0628\u0644\u062f\u064a\u0629 \u0628\u064a\u0648\u063a\u0644\u0648",       "\u0645\u0646\u0637\u0642\u0629 \u062a\u0642\u0633\u064a\u0645/\u0627\u0633\u062a\u0642\u0644\u0627\u0644\u060c \u062a\u0631\u0627\u062e\u064a\u0635 \u0633\u064a\u0627\u062d\u064a\u0629."),
                "catalca":     ("\u00c7atalca",     "\u00c7atalca Municipality",     "Rural area, agricultural permits.",                                                     "\u00c7atalca Belediyesi",     "K\u0131rsal alan, tar\u0131msal izinler.",                                                     "\u0628\u0644\u062f\u064a\u0629 \u062a\u0634\u0627\u062a\u0627\u0644\u062c\u0627",     "\u0645\u0646\u0637\u0642\u0629 \u0631\u064a\u0641\u064a\u0629\u060c \u062a\u0635\u0627\u0631\u064a\u062d \u0632\u0631\u0627\u0639\u064a\u0629."),
                "esenler":     ("Esenler",     "Esenler Municipality",     "Bus terminal area, wholesale business hub.",                                            "Esenler Belediyesi",     "Otogar b\u00f6lgesi, toptan ticaret merkezi.",                                            "\u0628\u0644\u062f\u064a\u0629 \u0627\u0633\u0646\u0644\u0631",        "\u0645\u0646\u0637\u0642\u0629 \u0645\u062d\u0637\u0629 \u0627\u0644\u062d\u0627\u0641\u0644\u0627\u062a\u060c \u0645\u0631\u0643\u0632 \u062a\u062c\u0627\u0631\u0629 \u062c\u0645\u0644\u0629."),
                "esenyurt":    ("Esenyurt",    "Esenyurt Municipality",    "Largest population, competitive rents, busy permit office.",                            "Esenyurt Belediyesi",    "En kalabal\u0131k il\u00e7e, rekabet\u00e7i kiralar.",                                            "\u0628\u0644\u062f\u064a\u0629 \u0627\u0633\u0646\u064a\u0648\u0631\u062a",      "\u0623\u0643\u0628\u0631 \u0639\u062f\u062f \u0633\u0643\u0627\u0646\u060c \u0625\u064a\u062c\u0627\u0631\u0627\u062a \u062a\u0646\u0627\u0641\u0633\u064a\u0629."),
                "eyup":        ("Ey\u00fcp",        "Ey\u00fcp Municipality",        "Historical area, heritage permit requirements.",                                       "Ey\u00fcp Belediyesi",        "Tarihi alan, miras izin gereksinimleri.",                                           "\u0628\u0644\u062f\u064a\u0629 \u0623\u064a\u0648\u0628",          "\u0645\u0646\u0637\u0642\u0629 \u062a\u0627\u0631\u064a\u062e\u064a\u0629\u060c \u0645\u062a\u0637\u0644\u0628\u0627\u062a \u062a\u0631\u0627\u062e\u064a\u0635 \u062a\u0631\u0627\u062b\u064a\u0629."),
                "fatih":       ("Fatih",       "Fatih Municipality",       "Strict sit site protocols.",                                                            "Fatih Belediyesi",       "S\u0131k\u0131 sit alan\u0131 protokolleri.",                                                        "\u0628\u0644\u062f\u064a\u0629 \u0641\u0627\u062a\u062d",          "\u0628\u0631\u0648\u062a\u0648\u0643\u0648\u0644\u0627\u062a \u0645\u0646\u0627\u0637\u0642 \u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0623\u062b\u0631\u064a\u0629."),
                "gaziosmanpasa":("Gaziosmanpa\u015fa","Gaziosmanpa\u015fa Municipality","Residential-commercial mix.",                                                         "Gaziosmanpa\u015fa Belediyesi","Konut-ticaret kar\u0131\u015f\u0131m\u0131.",                                                           "\u0628\u0644\u062f\u064a\u0629 \u063a\u0627\u0632\u064a \u0639\u062b\u0645\u0627\u0646 \u0628\u0627\u0634\u0627","\u0645\u0632\u064a\u062c \u0633\u0643\u0646\u064a-\u062a\u062c\u0627\u0631\u064a."),
                "gungoren":    ("G\u00fcng\u00f6ren",    "G\u00fcng\u00f6ren Municipality",    "Textile and small business hub.",                                                       "G\u00fcng\u00f6ren Belediyesi",    "Tekstil ve k\u00fc\u00e7\u00fck i\u015fletme merkezi.",                                                  "\u0628\u0644\u062f\u064a\u0629 \u063a\u0648\u0646\u063a\u0648\u0631\u0646",      "\u0645\u0631\u0643\u0632 \u0627\u0644\u0646\u0633\u064a\u062c \u0648\u0627\u0644\u0623\u0639\u0645\u0627\u0644 \u0627\u0644\u0635\u063a\u064a\u0631\u0629."),
                "kadikoy":     ("Kad\u0131k\u00f6y",     "Kad\u0131k\u00f6y Municipality",     "Foreigner investment support, vibrant area.",                                          "Kad\u0131k\u00f6y Belediyesi",     "Yabanc\u0131 yat\u0131r\u0131mc\u0131 deste\u011fi, canl\u0131 b\u00f6lge.",                                          "\u0628\u0644\u062f\u064a\u0629 \u0643\u0627\u062f\u064a\u0643\u0648\u064a",      "\u062f\u0639\u0645 \u0627\u0644\u0645\u0633\u062a\u062b\u0645\u0631\u064a\u0646 \u0627\u0644\u0623\u062c\u0627\u0646\u0628\u060c \u0645\u0646\u0637\u0642\u0629 \u0646\u0627\u0628\u0636\u0629 \u0628\u0627\u0644\u062d\u064a\u0627\u0629."),
                "kagithane":   ("Ka\u011f\u0131thane",   "Ka\u011f\u0131thane Municipality",   "Rapidly developing, modern business centers.",                                         "Ka\u011f\u0131thane Belediyesi",   "H\u0131zla geli\u015fen, modern i\u015f merkezleri.",                                               "\u0628\u0644\u062f\u064a\u0629 \u0643\u0627\u063a\u062a\u0647\u0627\u0646\u0629",    "\u062a\u0637\u0648\u0631 \u0633\u0631\u064a\u0639\u060c \u0645\u0631\u0627\u0643\u0632 \u0623\u0639\u0645\u0627\u0644 \u062d\u062f\u064a\u062b\u0629."),
                "kartal":      ("Kartal",      "Kartal Municipality",      "Asian side hub, good transport links.",                                                 "Kartal Belediyesi",      "Anadolu yakas\u0131 merkezi, iyi ula\u015f\u0131m.",                                             "\u0628\u0644\u062f\u064a\u0629 \u0643\u0627\u0631\u062a\u0627\u0644",       "\u0645\u0631\u0643\u0632 \u0627\u0644\u062c\u0627\u0646\u0628 \u0627\u0644\u0622\u0633\u064a\u0648\u064a\u060c \u0631\u0648\u0627\u0628\u0637 \u0646\u0642\u0644 \u062c\u064a\u062f\u0629."),
                "kucukcekmece":("K\u00fc\u00e7\u00fck\u00e7ekmece","K\u00fc\u00e7\u00fck\u00e7ekmece Municipality","Lakeside commercial area.",                                                             "K\u00fc\u00e7\u00fck\u00e7ekmece Belediyesi","G\u00f6l kenar\u0131 ticari alan.",                                                            "\u0628\u0644\u062f\u064a\u0629 \u0643\u0648\u062a\u0634\u0648\u0643 \u062a\u0634\u0643\u0645\u062c\u0629","\u0645\u0646\u0637\u0642\u0629 \u062a\u062c\u0627\u0631\u064a\u0629 \u0639\u0644\u0649 \u0627\u0644\u0628\u062d\u064a\u0631\u0629."),
                "maltepe":     ("Maltepe",     "Maltepe Municipality",     "Asian side, growing business area.",                                                    "Maltepe Belediyesi",     "Anadolu yakas\u0131, b\u00fcy\u00fcyen i\u015f alan\u0131.",                                                "\u0628\u0644\u062f\u064a\u0629 \u0645\u0627\u0644\u062a\u0628\u0629",       "\u0627\u0644\u062c\u0627\u0646\u0628 \u0627\u0644\u0622\u0633\u064a\u0648\u064a\u060c \u0645\u0646\u0637\u0642\u0629 \u0623\u0639\u0645\u0627\u0644 \u0645\u062a\u0646\u0627\u0645\u064a\u0629."),
                "pendik":      ("Pendik",      "Pendik Municipality",      "Sabiha G\u00f6k\u00e7en airport area, logistics hub.",                                                "Pendik Belediyesi",      "Sabiha G\u00f6k\u00e7en havaliman\u0131 b\u00f6lgesi, lojistik merkezi.",                                "\u0628\u0644\u062f\u064a\u0629 \u0628\u0646\u062f\u064a\u0643",        "\u0645\u0646\u0637\u0642\u0629 \u0645\u0637\u0627\u0631 \u0635\u0628\u064a\u062d\u0629 \u063a\u0648\u0643\u062a\u0634\u0646\u060c \u0645\u0631\u0643\u0632 \u0644\u0648\u062c\u0633\u062a\u064a."),
                "sancaktepe":  ("Sancaktepe",  "Sancaktepe Municipality",  "New development area, affordable.",                                                     "Sancaktepe Belediyesi",  "Yeni geli\u015fim alan\u0131, uygun fiyatl\u0131.",                                                "\u0628\u0644\u062f\u064a\u0629 \u0633\u0646\u062c\u0627\u0642 \u062a\u0628\u0647",   "\u0645\u0646\u0637\u0642\u0629 \u062a\u0637\u0648\u064a\u0631 \u062c\u062f\u064a\u062f\u0629\u060c \u0623\u0633\u0639\u0627\u0631 \u0645\u0639\u0642\u0648\u0644\u0629."),
                "sariyer":     ("Sar\u0131yer",     "Sar\u0131yer Municipality",     "Bosphorus area, environmental restrictions.",                                           "Sar\u0131yer Belediyesi",     "Bo\u011faz b\u00f6lgesi, \u00e7evresel k\u0131s\u0131tlamalar.",                                               "\u0628\u0644\u062f\u064a\u0629 \u0633\u0627\u0631\u064a\u064a\u0631",       "\u0645\u0646\u0637\u0642\u0629 \u0627\u0644\u0628\u0648\u0633\u0641\u0648\u0631\u060c \u0642\u064a\u0648\u062f \u0628\u064a\u0626\u064a\u0629."),
                "silivri":     ("Silivri",     "Silivri Municipality",     "Rural-suburban, agricultural and tourism.",                                             "Silivri Belediyesi",     "K\u0131rsal-varos, tar\u0131m ve turizm.",                                                    "\u0628\u0644\u062f\u064a\u0629 \u0633\u064a\u0644\u064a\u0641\u0631\u064a",      "\u0631\u064a\u0641\u064a-\u0636\u0627\u062d\u0648\u064a\u060c \u0632\u0631\u0627\u0639\u0629 \u0648\u0633\u064a\u0627\u062d\u0629."),
                "sisli":       ("\u015ei\u015fli",       "\u015ei\u015fli Municipality",       "Major business center, Mecidiyek\u00f6y/Levent office hubs.",                                   "\u015ei\u015fli Belediyesi",       "B\u00fcy\u00fck i\u015f merkezi, Mecidiyek\u00f6y/Levent ofis b\u00f6lgeleri.",                                 "\u0628\u0644\u062f\u064a\u0629 \u0634\u064a\u0634\u0644\u064a",         "\u0645\u0631\u0643\u0632 \u0623\u0639\u0645\u0627\u0644 \u0631\u0626\u064a\u0633\u064a\u060c \u0645\u062c\u064a\u062f\u064a\u0629 \u0643\u0648\u064a/\u0644\u064a\u0641\u0646\u062a."),
                "sultanbeyli": ("Sultanbeyli", "Sultanbeyli Municipality", "Affordable area, growing commercial zone.",                                             "Sultanbeyli Belediyesi", "Uygun fiyatl\u0131, geli\u015fen ticari b\u00f6lge.",                                               "\u0628\u0644\u062f\u064a\u0629 \u0633\u0644\u0637\u0627\u0646 \u0628\u064a\u0644\u064a",   "\u0645\u0646\u0637\u0642\u0629 \u0628\u0623\u0633\u0639\u0627\u0631 \u0645\u0639\u0642\u0648\u0644\u0629\u060c \u0646\u0645\u0648 \u062a\u062c\u0627\u0631\u064a."),
                "sultangazi":  ("Sultangazi",  "Sultangazi Municipality",  "Residential with growing retail.",                                                      "Sultangazi Belediyesi",  "Konut alan\u0131, b\u00fcy\u00fcyen perakende.",                                                   "\u0628\u0644\u062f\u064a\u0629 \u0633\u0644\u0637\u0627\u0646 \u063a\u0627\u0632\u064a",   "\u0645\u0646\u0637\u0642\u0629 \u0633\u0643\u0646\u064a\u0629 \u0645\u0639 \u0646\u0645\u0648 \u0641\u064a \u0627\u0644\u062a\u062c\u0632\u0626\u0629."),
                "tuzla":       ("Tuzla",       "Tuzla Municipality",       "Industrial zone, shipyard area.",                                                       "Tuzla Belediyesi",       "End\u00fcstri b\u00f6lgesi, tersane alan\u0131.",                                                    "\u0628\u0644\u062f\u064a\u0629 \u062a\u0648\u0632\u0644\u0627",         "\u0645\u0646\u0637\u0642\u0629 \u0635\u0646\u0627\u0639\u064a\u0629\u060c \u0645\u0646\u0637\u0642\u0629 \u0623\u062d\u0648\u0627\u0636."),
                "umraniye":    ("\u00dcmraniye",    "\u00dcmraniye Municipality",    "Growing Asian side tech hub.",                                                          "\u00dcmraniye Belediyesi",    "B\u00fcy\u00fcyen Anadolu yakas\u0131 teknoloji merkezi.",                                          "\u0628\u0644\u062f\u064a\u0629 \u0623\u0648\u0645\u0631\u0627\u0646\u064a\u0629",     "\u0645\u0631\u0643\u0632 \u062a\u0643\u0646\u0648\u0644\u0648\u062c\u064a\u0627 \u0645\u062a\u0646\u0627\u0645\u064a \u0641\u064a \u0627\u0644\u062c\u0627\u0646\u0628 \u0627\u0644\u0622\u0633\u064a\u0648\u064a."),
                "uskudar":     ("\u00dcsk\u00fcdar",     "\u00dcsk\u00fcdar Municipality",     "Historical Asian side, heritage area rules.",                                          "\u00dcsk\u00fcdar Belediyesi",     "Tarihi Anadolu yakas\u0131, miras alan\u0131 kurallar\u0131.",                                     "\u0628\u0644\u062f\u064a\u0629 \u0623\u0633\u0643\u0648\u062f\u0627\u0631",      "\u0627\u0644\u062c\u0627\u0646\u0628 \u0627\u0644\u0622\u0633\u064a\u0648\u064a \u0627\u0644\u062a\u0627\u0631\u064a\u062e\u064a\u060c \u0642\u0648\u0627\u0639\u062f \u0627\u0644\u062a\u0631\u0627\u062b."),
                "zeytinburnu": ("Zeytinburnu", "Zeytinburnu Municipality", "Leather and textile district, busy commercial area.",                                   "Zeytinburnu Belediyesi", "Deri ve tekstil bölgesi, yoğun ticaret alanı.",                                      "بلدية زيتون بورنو",  "منطقة الجلود والنسيج، منطقة تجارية مزدحمة."),
            }
            # Neighborhood to District Mapping
            _NB_MAP = {
                "kayasehir": "basaksehir", "kayashier": "basaksehir", "kayaşehir": "basaksehir",
                "yenibosna": "bahcelievler", "sirinevler": "bahcelievler", "sirineveler": "bahcelievler", "şirinevler": "bahcelievler",
                "taksim": "beyoglu", "istiklal": "beyoglu",
                "florya": "bakirkoy", "yesilkoy": "bakirkoy",
                "maslak": "sariyer", "tarabya": "sariyer",
                "etiler": "besiktas", "levent": "besiktas", "bebek": "besiktas"
            }

            # Dynamic fallback: detect district from query even if not in _DISTRICT_INFO
            _ALL_DISTRICT_NAMES = [
                "adalar", "arnavutkoy", "atasehir", "avcilar", "bagcilar", "bahcelievler",
                "bakirkoy", "basaksehir", "bayrampasa", "besiktas", "beykoz", "beylikduzu",
                "beyoglu", "buyukcekmece", "catalca", "cekmekoy", "esenler", "esenyurt",
                "eyup", "fatih", "gaziosmanpasa", "gungoren", "kadikoy", "kagithane",
                "kartal", "kucukcekmece", "maltepe", "pendik", "sancaktepe", "sariyer",
                "silivri", "sisli", "sultanbeyli", "sultangazi", "sile", "tuzla",
                "umraniye", "uskudar", "zeytinburnu"
            ]

            district_en = "Istanbul"
            district_display = None
            mun_name_en = "Your District Municipality"
            district_note = ""

            query_lower = query.lower()
            if fuzzy_district_match:
                query_lower += f" {fuzzy_district_match}"
            if fuzzy_business_match:
                query_lower += f" {fuzzy_business_match}"
            # Strip common prefixes like "in", "i said", "it is", "it's"
            _stripped = re.sub(r"^(i said |it is |it's |its |in |at |from |the )", "", query_lower).strip()
            
            for key, data in _DISTRICT_INFO.items():
                # Check direct district keys OR mapped neighborhood keys
                _matched_key = None
                if key in query_lower or key in _stripped:
                    _matched_key = key
                else:
                    # Check if any neighborhood maps to this district
                    for nb_key, dist_target in _NB_MAP.items():
                        if dist_target == key and (nb_key in query_lower or nb_key in _stripped):
                            _matched_key = key
                            break
                
                if _matched_key:
                    dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                    district_en = dname
                    district_display = dname
                    if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                    elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                    else: mun_name_en, district_note = mun_en, note_en
                    break
                    
            # Fallback: check entire history for district mentions
            if district_display is None:
                _full_hist_lower = history_text.lower() if history_text else ""
                for key, data in _DISTRICT_INFO.items():
                    if key in _full_hist_lower:
                        dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                        district_en = dname
                        district_display = dname
                        if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                        elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                        else: mun_name_en, district_note = mun_en, note_en
                        break

            # Semt / Neighborhood fallback
            if district_display is None:
                _NEIGHBORHOODS = {
                    "yenibosna": "bahcelievler", "sirinevler": "bahcelievler", "\u015firinevler": "bahcelievler",
                    "maslak": "sariyer", "levent": "besiktas", "etiler": "besiktas", "bebek": "besiktas",
                    "mecidiyekoy": "sisli", "mecidiyek\u00f6y": "sisli", "nisantasi": "sisli", "ni\u015fanta\u015f\u0131": "sisli",
                    "taksim": "beyoglu", "karakoy": "beyoglu", "karak\u00f6y": "beyoglu", "galata": "beyoglu", "cihangir": "beyoglu",
                    "florya": "bakirkoy", "yesilkoy": "bakirkoy", "ye\u015filk\u00f6y": "bakirkoy",
                    "moda": "kadikoy", "suadiye": "kadikoy", "caddebostan": "kadikoy", "bostanci": "kadikoy",
                    "eminonu": "fatih", "emin\u00f6n\u00fc": "fatih", "sultanahmet": "fatih", "balat": "fatih"
                }
                combined_text = f"{query_lower} {_stripped} {user_history_text}"
                for hood, parent_id in _NEIGHBORHOODS.items():
                    is_match = hood in combined_text
                    if not is_match:
                        for word in query_lower.split():
                            if len(word) >= 5 and _fuzzy_match(word, [hood], threshold=0.8):
                                is_match = True
                                break
                    if is_match:
                        if parent_id in _DISTRICT_INFO:
                            data = _DISTRICT_INFO[parent_id]
                            dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                            district_en = dname
                            district_display = dname
                            if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                            elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                            else: mun_name_en, district_note = mun_en, note_en
                            break

            # Last-resort fallback: if a district name appears but has no detailed data
            if district_display is None:
                combined_text = f"{query_lower} {_stripped} {user_history_text}"
                for d in _ALL_DISTRICT_NAMES:
                    if d in combined_text:
                        district_display = d.title()
                        district_en = d.title()
                        mun_name_en = f"{d.title()} Municipality"
                        district_note = ""
                        break

            no_district = district_display is None
            missing_items = []
            if business_type == "Business": missing_items.append("business")
            if no_district: missing_items.append("district")

            if missing_items:
                import random
                ack_business = business_type if business_type != "Business" else None
                ack_district = district_display if not no_district else None

                vars_en_b = random.choice(["Great choice \u2014", "Awesome \u2014", "Excellent \u2014"])
                vars_en_d = random.choice(["Got it \u2014", "Perfect \u2014", "Understood \u2014"])
                vars_tr_b = random.choice(["Harika,", "Mükemmel,", "Çok iyi,"])
                vars_tr_d = random.choice(["Tamam,", "Anlaşıldı,", "Harika,"])

                if language == "tr":
                    if ack_business and "district" in missing_items: msg = f"{vars_tr_b} **{ack_business}** iyi bir seçim! 👍 Şimdi tam yol haritanı oluşturabilmem için: **İstanbul'un hangi ilçesinde** açacaksın?"
                    elif ack_district and "business" in missing_items: msg = f"{vars_tr_d} **{ack_district}** bölgesini not aldım! 📍 Şimdi: **Hangi tür işletme** (Kafe, Mağaza vb.) açacaksın?"
                    else:
                        msg = "Sana tam ve doğru bir yol haritası çizebilmem için lütfen şunları belirt: "
                        if "business" in missing_items: msg += "**Hangi tür işletme** (Kafe, Mağaza vb.) açacaksın? "
                        if "district" in missing_items: msg += "**İstanbul'un hangi ilçesinde** açacaksın?"
                elif language == "ar":
                    if ack_business and "district" in missing_items: msg = f"**{ack_business}**، خيار موفق للبدء في عالم الأعمال! 👍 الآن لكي أرسم لك خريطة طريق مهنية: **في أي منطقة (بلدية) في إسطنبول** تخطط للافتتاح؟"
                    elif ack_district and "business" in missing_items: msg = f"رائع، لقد سجلت منطقة **{ack_district}**! 📍 الآن سؤالي: **ما هو النشاط التجاري** (مقهى، متجر، إلخ) الذي تود ممارسته؟"
                    else:
                        msg = "لكي أتمكن من رسم خريطة طريق دقيقة لعملك، يرجى تزويدي بالآتي: "
                        if "business" in missing_items: msg += "**ما هو نوع النشاط التجاري**؟ "
                        if "district" in missing_items: msg += "**في أي منطقة في إسطنبول** ستفتح؟"
                else:
                    if ack_business and "district" in missing_items: msg = f"{vars_en_b} **{ack_business}**! 👍 Now, to build your full roadmap: **Which district of Istanbul** are you opening in?"
                    elif ack_district and "business" in missing_items: msg = f"{vars_en_d} **{ack_district}** noted! 📍 Now: **What type of business** are you planning to open (e.g., Cafe, Retail, Restaurant)?"
                    else:
                        msg = "To map out your exact roadmap, could you please tell me: "
                        if "district" in missing_items: msg += "**Which district of Istanbul** are you opening in?"
                await wait_task
                return msg, None, "Smart Router (Business/District Clarification)"

            district = district_display
            mun_name = mun_name_en

            if language == "tr":
                permits, agencies, docs = [f"{district} \u0130\u015fyeri A\u00e7ma ve \u00c7al\u0131\u015fma Ruhsat\u0131"], [mun_name, "Vergi Dairesi"], ["Kimlik", "Kira S\u00f6zle\u015fmesi", "Vergi Levhas\u0131", "NACE Kodu Belgesi"]
                summ, labels = f"M\u00fckemmel se\u00e7im! {district}'de {business_type} a\u00e7mak i\u00e7in bilmeniz gereken her \u015feyi haz\u0131rlad\u0131m. \ud83c\udf89 \u00d6nemli not: {district_note} A\u015fa\u011f\u0131daki yol haritas\u0131n\u0131 takip edin ve merak etti\u011finizi sorun!", {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Ad\u0131mlar", "tm": "Tahmini S\u00fcre", "dy": "g\u00fcn"}
            elif language == "ar":
                permits, agencies, docs = [f"\u0631\u062e\u0635\u0629 \u0641\u062a\u062d \u0648\u062a\u0634\u063a\u064a\u0644 \u0645\u0646 \u0628\u0644\u062f\u064a\u0629 {district}"], [mun_name, "\u0645\u0643\u062a\u0628 \u0627\u0644\u0636\u0631\u0627\u0626\u0628 (Vergi Dairesi)"], ["\u0628\u0637\u0627\u0642\u062f \u0627\u0644\u0647\u0648\u064a\u0629/\u062c\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631", "\u0639\u0642\u062f \u0627\u0644\u0625\u064a\u062c\u0627\u0631 (\u0645\u0648\u062b\u0642)", "\u0627\u0644\u0644\u0648\u062d\u0629 \u0627\u0644\u0636\u0631\u0627\u0626\u0628\u064a\u0629 (Vergi Levhas\u0131)", "\u0648\u062b\u064a\u0642\u0629 \u0631\u0645\u0632 NACE"]
                summ, labels = f"\u0627\u062e\u062a\u064a\u0627\u0631 \u0645\u0647\u0646\u064a \u0645\u0648\u0641\u0642! \u0644\u0642\u062f \u0642\u0645\u062a \u0628\u0625\u0639\u062f\u0627\u062f \u062e\u0631\u064a\u0637\u0629 \u0637\u0631\u064a\u0642 \u0645\u062a\u0643\u0627\u0645\u0644\u0629 \u0644\u0627\u0641\u062a\u062a\u0627\u062d **{business_type}** \u0641\u064a \u0645\u0646\u0637\u0642\u0629 **{district}**. \ud83c\udf89 \u0645\u0644\u0627\u062d\u0638\u0629 \u0647\u0627\u0645\u0629: {district_note} \u064a\u0631\u062c\u0649 \u0627\u062a\u0628\u0627\u0639 \u0627\u0644\u062e\u0637\u0648\u0627\u062a \u0623\u062f\u0646\u0627\u0647\u060b \u0648\u0623\u0646\u0627 \u0647\u0623\u064b \u0644\u0644\u0625\u062c\u0627\u0628\u0629 \u0639\u0644\u0649 \u0623\u064a \u0627\u0633\u062a\u0641\u0633\u0627\u0631 \u0642\u0627\u0646\u0648\u0646\u064a \u0623\u0648 \u0625\u062c\u0631\u0627\u0626\u064a.", {"ag": "\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a \u0648\u0627\u0644\u0647\u064a\u0626\u0627\u062a", "dc": "\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629", "st": "\u062e\u0637\u0648\u0627\u062a \u0627\u0644\u0639\u0645\u0644", "tm": "\u0627\u0644\u062c\u062f\u0648\u0644 \u0627\u0644\u0632\u0645\u0646\u064a \u0627\u0644\u0645\u062a\u0648\u0642\u0639", "dy": "\u064a\u0648\u0645"}
            else:
                permits, agencies, docs = [f"{district} Workplace Operating License"], [mun_name, "Tax Office (Vergi Dairesi)"], ["ID / Passport", "Lease Agreement", "Tax Plate", "NACE Code Certificate"]
                summ, labels = f"Great choice \u2014 I've put together your complete roadmap for opening a {business_type} in {district}! \ud83d\ude80 \ud83d\udccd **{district} note:** {district_note} Follow the steps below and feel free to ask me anything along the way.", {"ag": "Institutions / Agencies", "dc": "Documents You'll Need", "st": "Your Action Steps", "tm": "Estimated Timeline", "dy": "days"}

            timeline = 30
            if any(kw in combined_context for kw in ["restaurant", "restoran", "cafe", "kafe", "bakery", "f\u0131r\u0131n", "fir\u0131n", "food", "g\u0131da"]):
                timeline = 45
                if language == "tr": permits.extend(["\u0130tfaiye Uygunluk Raporu", "Baca Uygunlu\u011fu"]); docs.extend(["\u0130tfaiye Raporu"]); agencies.extend(["\u0130BB \u0130tfaiye Daire Ba\u015fkanl\u0131\u011f\u0131"])
                elif language == "ar": permits.extend(["\u062a\u0642\u0631\u064a\u0631 \u0627\u0644\u0625\u0637\u0641\u0627\u0621", "\u0645\u0644\u0627\u0621\u0645\u0629 \u0627\u0644\u0645\u062f\u062e\u0646\u0629"]); docs.extend(["\u062a\u0642\u0631\u064a\u0631 \u0627\u0644\u0645\u0637\u0627\u0641\u0626"]); agencies.extend(["\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0625\u0637\u0641\u0627\u0621 \u0641\u064a \u0627\u0644\u0628\u0644\u062f\u064a\u0629"])
                else: permits.extend(["Fire Safety Report", "Chimney Compliance"]); docs.extend(["Fire Report"]); agencies.extend(["Istanbul Fire Department (\u0130BB \u0130tfaiye)"])

        elif assistant_type == "student":
            found_uni = None
            # Sort by longest key first so 'altinbas' matches before 'ist' or 'al'
            for key, val in sorted(_UNI_MAP.items(), key=lambda x: len(x[0]), reverse=True):
                if key in query.lower() or key in user_history_text:
                    found_uni = val
                    break
            
            is_renew_check = any(w in query.lower() for w in ["renew", "replace", "uzat", "\u062a\u062c\u062f\u064a\u062f", "ikamet", "kimlik", "residence"])
            if not found_uni and not is_renew_check:
                reg_keywords = ["register", "enroll", "enrol", "registration", "enrollment", "kay\u0131t", "y\u00f6ks", "\u062a\u0633\u062c\u064a\u0644", "\u0642\u0628\u0648\u0644", "i want to register", "before deadline", "deadline"]
                if any(kw in query.lower() for kw in reg_keywords):
                    which_uni_msg = {"en": "\ud83c\udf93 Of course! Before I build your roadmap, could you tell me: **Which university are you looking to register at?**\n\n(e.g., Bo\u011fazi\u00e7i, METU, Istanbul University, Ko\u00e7, Alt\u0131nba\u015f\u2026)", "tr": "\ud83c\udf93 Tabii ki! Sana \u00f6zel bir yol haritas\u0131 haz\u0131rlayabilmem i\u00e7in \u00f6nce \u015funu s\u00f6yler misin: **Hangi \u00fcniversiteye kay\u0131t yapt\u0131rmak istiyorsun?**\n\n(\u00f6rn. Bo\u011fazi\u00e7i, ODT\u00dc, \u0130stanbul \u00fcniversitesi, Ko\u00e7, Alt\u0131nba\u015f\u2026)", "ar": "\ud83c\udf93 \u0628\u0643\u0644 \u0633\u0631\u0648\u0631! \u0642\u0628\u0644 \u0623\u0646 \u0623\u0639\u062f \u0644\u0643 \u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u0637\u0631\u064a\u0642\u060b \u0623\u062e\u0628\u0631\u0646\u064a: **\u0641\u064a \u0623\u064a \u062c\u0627\u0645\u0639\u0629 \u062a\u0631\u064a\u062f \u0627\u0644\u062a\u0633\u062c\u064a\u0644\u061f**\n\n(\u0645\u062b\u0644\u0627\u064b: \u0628\u0648\u063a\u0627\u0632\u064a\u062a\u0634\u064a\u060b ODT\u00dc\u060b \u062c\u0627\u0645\u0639\u0629 \u0625\u0633\u0637\u0646\u0628\u0648\u0644\u060b \u0643\u0648\u062a\u0634\u060b \u0623\u0644\u062a\u0646 \u0628\u0627\u0634\u2026)"}.get(language, "\ud83c\udf93 Of course! **Which university are you looking to register at?**")
                    await wait_task
                    return which_uni_msg, None, "Smart Router (Uni Clarification)"

            if found_uni and not is_renew_check:
                deadline_info = _UNI_DEADLINES.get(found_uni, {}).get(language, "August")
                prompt_summ = {"en": f"Found it! \ud83c\udf93 The deadline for **{found_uni}** is **{deadline_info}**. I've also generated your step-by-step registration roadmap in the dashboard!", "tr": f"Buldum! \ud83c\udf93 **{found_uni}** i\u00e7in son tarih **{deadline_info}**. Ayr\u0131ca senin i\u00e7in haz\u0131rlad\u0131\u011f\u0131m kay\u0131t yol haritas\u0131n\u0131 panelde g\u00f6rebilirsin!", "ar": f"\u0648\u062c\u062f\u062a\u0647\u0627! \ud83c\udf93 \u0627\u0644\u0645\u0648\u0639\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0644\u062c\u0627\u0645\u0639\u0629 **{found_uni}** \u0647\u0648 **{deadline_info}**. \u0644\u0642\u062f \u0642\u0645\u062a \u0623\u064a\u0636\u0627\u064b \u0628\u0625\u0646\u0634\u0627\u0621 \u062e\u0627\u0631\u0637\u0629 \u0637\u0631\u064a\u0642 \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062e\u0627\u0635\u0629 \u0628\u0643 \u0641\u064a \u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u062d\u0643\u0645!"}.get(language, f"Found it! The deadline for {found_uni} is {deadline_info}")
                business_type, agencies, docs = "student.register_uni", ["University Registrar", "Portal / OBS", "MEB (Denklik)"], ["Admission Letter", "Passport", "Original Diploma", "Apostille", "Photos"]
                step_specs = get_localized_steps(language, business_type); details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]; steps_list = [title for id_val, title, resp, note in step_specs]; labels = {"en": {"ag": "Key Institutions", "dc": "Documents", "st": "Steps"}, "tr": {"ag": "Kurumlar", "dc": "Belgeler", "st": "Ad\u0131mlar"}, "ar": {"ag": "\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a", "dc": "\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a", "st": "\u062e\u0637\u0648\u0627\u062a"}}.get(language, {"ag": "Agencies", "dc": "Docs", "st": "Steps"})
                agent_steps = [AgentStep(title=title, description=note, documents=[]) for id_val, title, resp, note in step_specs]
                combined = CombinedPermitResult(permits=[f"{found_uni} Registration"], agencies=agencies, documents=docs, steps=agent_steps, timeline_days=15, summary=prompt_summ, location=found_uni, business_type=business_type); state = PermitState(business_profile={"raw_query": query, "language": language, "university": found_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[found_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Agent"]), last_updated=datetime.now())
                out_str, dashboard_dump = f"\ud83d\udcac {prompt_summ}\n\n\ud83d\udccb **{labels['ag']}:** {', '.join(agencies)}\n\ud83d\udcc4 **{labels['dc']}:** {', '.join(docs)}\n\u2705 **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)), state.model_dump()
                if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
                await wait_task
                return out_str, dashboard_dump, "Smart Router (Registration Roadmap)"
            

            _q = query.lower()
            _is_kimlik_new  = any(s in _q for s in [
                "get a id", "get an id", "get my id", "want a id", "want an id",
                "need an id", "need a id", "apply for id", "apply for an id",
                "apply for kimlik", "get kimlik", "want kimlik", "need kimlik",
                "get id card", "id application", "kimlik application",
                "student id", "first time id", "first kimlik", "obtain id",
                "obtain kimlik", "new id", "new kimlik",
            ])
            is_renew = (
                "renew" in _q or "replace" in _q or "uzat" in _q or "\u062a\u062c\u062f\u064a\u062f" in _q
            ) and "kimlik" not in _q
            # First-time kimlik application → same 9-step roadmap as renewal
            if _is_kimlik_new:
                is_renew = True
            business_type, district, timeline = ("student_renew" if is_renew else "Student"), "Istanbul", (10 if is_renew else 30)
            if language == "tr": permits, agencies, docs, summ = (["\u00d6\u011frenci \u0130kamet \u0130zni Uzatmas\u0131"], ["G\u00f6\u00e7 \u0130daresi", "Noter", "Sigorta \u015eirketi"], ["Sa\u011fl\u0131k Sigortas\u0131", "Noter Onayl\u0131 Kira S\u00f6zle\u015fmesi", "\u00d6\u011frenci Belgesi", "Biyometrik Foto\u011fraf"], "Sorun de\u011fil, hemen organize edelim! \ud83c\udf93 \u0130kamet yenileme s\u00fcreci birka\u00e7 ad\u0131mdan olu\u015fuyor.") if is_renew else (["\u00d6\u011frenci Kayd\u0131", "\u00d6\u011frenci \u0130kamet \u0130zni"], ["\u00d6\u011frenci \u0130\u015fleri", "G\u00f6\u00e7 \u0130daresi", "SGK"], ["Pasaport", "Kabul Mektubu", "Sa\u011fl\u0131k Sigortas\u0131"], "T\u00fcrkiye'de \u00f6\u011frenci olmak heyecan verici \u2014 tebrikler! \ud83c\udf93"); labels = {"ag":"Kurumlar", "dc":"Belgeler", "st":"Ad\u0111mlar", "tm":"Tahmini S\u00fcre", "dy":"g\u00fcn"}
            elif language == "ar": permits, agencies, docs, summ = (["\u062a\u0645\u062f\u064a\u062f \u0625\u0642\u0627\u0645\u0629 \u0627\u0644\u0637\u0627\u0644\u0628"], ["\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0647\u062c\u0631\u0629", "\u0627\u0644\u0639\u062f\u0644 (\u0627\u0644\u0646\u0648\u062a\u0631)", "\u0634\u0631\u0643\u0629 \u0627\u0644\u062a\u0623\u0645\u064a\u0646"], ["\u0627\u0644\u062a\u0623\u0645\u064a\u0646 \u0627\u0644\u0635\u062d\u064a", "\u0639\u0642\u062f \u0625\u064a\u062c\u0627\u0631 \u0645\u0648\u062b\u0642", "\u0634\u0647\u0627\u062f\u0629 \u0637\u0627\u0644\u0628", "\u0635\u0648\u0631 \u0634\u062e\u0635\u064a\u0629"], "\u0644\u0627 \u062a\u0642\u0644\u0642\u060b \u0633\u0646\u0631\u062a\u0628 \u0643\u0644 \u0634\u064a\u0621! \ud83c\udf93") if is_renew else (["\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062c\u0627\u0645\u0639\u0629", "\u0625\u0642\u0627\u0645\u0629 \u0627\u0644\u0637\u0627\u0644\u0628"], ["\u0634\u0624\u0648\u0646 \u0627\u0644\u0637\u0644\u0627\u0628", "\u0625\u062f\u0627\u0631\u0629 \u0627\u0644\u0627\u0647\u062c\u0631\u0629", "SGK"], ["\u062c\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631", "\u062e\u0637\u0627\u0628 \u0627\u0644\u0642\u0628\u0648\u0644", "\u0627\u0644\u062a\u0623\u0645\u064a\u0646 \u0627\u0644\u0635\u062d\u064a"], "\u062a\u0647\u0627\u0646\u064a\u0646\u0627 \u0639\u0644\u0649 \u0642\u0628\u0648\u0644\u0643 \u0641\u064a \u0627\u0644\u062c\u0627\u0645\u0639\u0629! \ud83c\udf93"); labels = {"ag":"\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a", "dc":"\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a", "st":"\u062e\u0637\u0648\u0627\u062a\u0643", "tm":"\u0627\u0644\u0645\u062f\u0629", "dy":"\u064a\u0648\u0645"}
            else: permits, agencies, docs, summ = (["Student Residence Permit Extension"], ["Migration Office", "Notary Public", "Insurance Provider"], ["Health Insurance Policy", "Notarized Lease Agreement", "Student Certificate", "Photos"], "No stress \u2014 let's sort this out together! \ud83c\udf93") if is_renew else (["University Registration", "Student Residence Permit"], ["Student Affairs", "Migration Directorate", "SGK"], ["Passport", "Acceptance Letter", "Health Insurance"], "Welcome to Turkey \u2014 exciting times ahead! \ud83c\udf93"); labels = {"ag":"Agencies", "dc":"Documents", "st":"Steps", "tm":"Time", "dy":"days"}

        elif assistant_type == "lawyer":
            query_lower, hist_lower = query.lower(), combined_context
            def get_subtype(text):
                if any(k in text for k in ["contract", "s\u00f6zle\u015fme", "nda", "agreement", "clause", "signing"]): return "lawyer_contract"
                if any(k in text for k in ["company", "formation", "ltd", "a.\u015f", "\u015firket", "business registration"]): return "lawyer_company"
                if any(k in text for k in ["fired", "dismissed", "termination", "severance", "employment", "i\u015ften \u00e7\u0131kar", "k\u0131dem"]): return "lawyer_employment"
                if any(k in text for k in ["work permit", "residence permit", "ikamet", "stay in turkey", "\u00e7al\u0131\u015fma izni"]): return "lawyer_residency"
                if any(k in text for k in ["lawsuit", "court", "mediation", "arabuluculuk", "ihtarname"]): return "lawyer_dispute"
                if any(k in text for k in ["buy", "sell", "rent", "house", "property", "apartment", "real estate", "tapu"]): return "lawyer_real_estate"
                if any(k in text for k in ["police", "arrest", "criminal", "charge", "jail", "su\u00e7", "drugs", "theft", "marijuana", "possession", "caught"]): return "lawyer_criminal"
                if any(k in text for k in ["debt", "unpaid", "invoice", "icra", "haciz", "collection"]): return "lawyer_debt"
                return None
            lawyer_subtype = get_subtype(query_lower) or get_subtype(hist_lower)
            if not lawyer_subtype: return None, None, "Lawyer Intent Not Resolved"
            district, business_type = "Turkey", lawyer_subtype
            if lawyer_subtype == "lawyer_contract":
                timeline = 14
                if language == "tr": permits, agencies, docs = ["S\u00f6zle\u015fme \u0130ncelemesi"], ["Avukat/Hukuk B\u00fcrosu", "Noter"], ["S\u00f6zle\u015fme", "Kimlik"]; summ, labels = "\u0130mzalamadan \u00f6nce durman\u0131z \u00e7ok do\u011fru bir karar! \u2696\ufe0f Maddeleri inceliyoruz.", {"ag":"Kurumlar", "dc":"Belgeler", "st":"Ad\u0131mlar", "tm":"S\u00fcre", "dy":"g\u00fcn"}
                elif language == "ar": permits, agencies, docs = ["\u0645\u0631\u0627\u062c\u0639\u0629 \u0627\u0644\u0639\u0642\u062f"], ["\u0645\u062d\u0627\u0645\u064d / \u0645\u0643\u062a\u0628 \u0642\u0627\u0646\u0648\u0646\u064a", "\u0643\u0627\u062a\u0628 \u0627\u0644\u0639\u062f\u0644"], ["\u0627\u0644\u0639\u0642\u062f", "\u0648\u062b\u064a\u0642\u0629 \u0647\u0648\u064a\u0629"]; summ, labels = "\u0642\u0631\u0627\u0631 \u0635\u0627\u0626\u0628 \u0623\u0646 \u062a\u0648\u0642\u0641 \u0642\u0628\u0644 \u0627\u0644\u062a\u0648\u0642\u064a\u0639! \u2696\ufe0f \u0633\u0623\u0631\u0627\u062c\u0639 \u0627\u0644\u0639\u0642\u062f \u0628\u0639\u0646\u0627\u064a\u0629.", {"ag":"\u0627\u0644\u0645\u0627\u0633\u0633\u0627\u062a", "dc":"\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a", "st":"\u062e\u0637\u0648\u0627\u062a", "tm":"\u0627\u0644\u0645\u062f\u0629", "dy":"\u064a\u0648\u0645"}
                else: permits, agencies, docs = ["Contract Review"], ["Lawyer / Law Firm", "Notary Public"], ["Contract", "ID"]; summ, labels = "Smart move to pause before signing! \u2696\ufe0f", {"ag":"Agencies", "dc":"Docs", "st":"Steps", "tm":"Time", "dy":"days"}
            elif lawyer_subtype == "lawyer_company":
                timeline = 10
                if language == "tr": permits, agencies, docs = ["Ltd. \u015eirket Tescili"], ["Ticaret Sicili", "Vergi Dairesi"], ["Pasaport", "Ana S\u00f6zle\u015fme"]; summ, labels = "Harika bir karar! \ud83c\udfe2 T\u00fcrkiye'de \u015firket kurmak kolayd\u0131r.", {"ag":"Kurumlar", "dc":"Belgeler", "st":"Ad\u0111mlar", "tm":"S\u00fcre", "dy":"g\u00fcn"}
                elif language == "ar": permits, agencies, docs = ["\u062a\u0623\u0633\u064a\u0633 \u0634\u0631\u0643\u0629"], ["\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u062a\u062c\u0627\u0631\u064a", "\u0645\u0643\u062a\u0628 \u0627\u0644\u0636\u0631\u0627\u0626\u0628"], ["\u062c\u0648\u0627\u0632 \u0627\u0644\u0633\u0641\u0631", "\u0646\u0638\u0627\u0645 \u0627\u0644\u0634\u0631\u0643\u0629"]; summ, labels = "\u0642\u0631\u0627\u0631 \u0631\u0627\u0626\u0639! \ud83c\udfe2 \u062a\u0623\u0633\u064a\u0633 \u0634\u0631\u0643\u0629 \u0641\u064a \u062a\u0631\u0643\u064a\u0627 \u0623\u0631\u064a\u062d \u0645\u0645\u0627 \u062a\u062a\u0648\u0642\u0639.", {"ag":"\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a", "dc":"\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a", "st":"\u062e\u0637\u0648\u0627\u062a", "tm":"\u0627\u0644\u0645\u062f\u0629", "dy":"\u064a\u0648\u0645"}
                else: permits, agencies, docs = ["Company Registration"], ["Trade Registry", "Tax Office"], ["Passport", "Lease Agreement"]; summ, labels = "Great decision! \ud83c\udfe2 Straightforward process.", {"ag":"Agencies", "dc":"Docs", "st":"Steps", "tm":"Time", "dy":"days"}
            else: timeline, permits, agencies, docs, summ, labels = 20, ["Legal Consultation"], ["Court"], ["Evidence"], "Legal guidance requested.", {"ag":"Agencies", "dc":"Docs", "st":"Steps", "tm":"Time", "dy":"days"}
        else: return None, None, "Assistant Type Mismatch"

        step_specs = get_localized_steps(language, business_type)
        details = []
        steps_list = []
        agent_steps_list = []
        for spec in step_specs:
            id_val, title, resp, note = spec[0], spec[1], spec[2], spec[3]
            step_docs = list(spec[4]) if len(spec) > 4 else []
            details.append(StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note, docs=step_docs))
            steps_list.append(title)
            agent_steps_list.append(AgentStep(title=title, description=note, documents=step_docs))
        agent_steps = agent_steps_list
        combined = CombinedPermitResult(permits=permits, agencies=agencies, documents=docs, steps=agent_steps, timeline_days=timeline, summary=summ, location=district, business_type=business_type); state = PermitState(business_profile={"raw_query": query, "language": language}, combined_result=combined, permit_plan=PermitPlan(permits=permits, agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Planner"]), last_updated=datetime.now())
        out_str, dashboard_dump = f"\ud83d\udcac {summ}\n\n\ud83d\udccb **{labels['ag']}:** {', '.join(agencies)}\n\ud83d\udcc4 **{labels['dc']}:** {', '.join(docs[:6])}\n\u2705 **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) + f"\n\n\u23f1\ufe0f **{labels['tm']}:** {timeline} {labels['dy']}", state.model_dump()
        if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
        await wait_task
        return out_str, dashboard_dump, "Smart Router (Legal/Student Roadmap)"

    intent_group, sub_intent, confidence = early_intent_group, early_sub_intent, early_confidence
    if confidence > 0:

        if assistant_type == "student" and sub_intent == "register_uni":
            _funi = any(k in query.lower() or k in user_history_text for k in _UNI_MAP)
            _iren = any(w in query.lower() for w in ["renew", "replace", "uzat", "ikamet", "kimlik"])
            if not _funi and not _iren:
                msg = {"en": "\ud83c\udf93 Of course! Before I build your roadmap, could you tell me: **Which university are you looking to register at?**", "tr": "\ud83c\udf93 Tabii ki! Sana \u00f6zel bir yol haritas\u0131 haz\u0131rlayabilmem i\u00e7in \u00f6nce \u015funu s\u00f6yler misin: **Hangi \u00fcniversiteye kay\u0131t yapt\u0131rmak istiyorsun?**", "ar": "\ud83c\udf93 \u0628\u0643\u0644 \u0633\u0631\u0648\u0631! \u0642\u0628\u0644 \u0623\u0646 \u0623\u0639\u062f \u0644\u0643 \u062e\u0631\u064a\u0637\u0629 \u0627\u0644\u0637\u0631\u064a\u0642\u060b \u0623\u062e\u0628\u0631\u0646\u064a: **\u0641\u064a \u0623\u064a \u062c\u0627\u0645\u0639\u0629 \u062a\u0631\u064a\u062f \u0627\u0644\u062a\u0633\u062c\u064a\u0644\u061f**"}.get(language, "Which university?")
                await wait_task
                return msg, None, "Smart Router (Uni Clarification)"

        raw_response = _pick_response(intent_group, sub_intent, language=language)
        if raw_response:
            variables = build_variables(user_name=user_name); response = render(raw_response, variables)
            print(f"\n[Smart Router] Response served from STATIC KNOWLEDGE BASE ({assistant_type})")
            if intent_group not in {"greeting", "smalltalk", "farewell", "thanks", "identity", "capabilities"}:
                response_cache.set(query, response, assistant_type, language)
            await wait_task
            return response, None, "Static Knowledge Base"

    if intent_group in {"permit", "student", "lawyer"} and _RAG_AVAILABLE:
        try:
            rag_chunks = await retrieve_chunks(query, assistant_type, language, top_k=3)
            if rag_chunks and rag_chunks[0].get("similarity", 0) > 0.45:
                model = gemini_model if assistant_type == "permit" else (student_model if assistant_type == "student" else lawyer_model)
                rag_response = await generate_rag_response(query=query, agent_type=assistant_type, language=language, gemini_model=model, retrieved_chunks=rag_chunks)
                if rag_response:
                    # Append transparent citations
                    sources = []
                    for c in rag_chunks:
                        title = c.get("title", "").strip()
                        if title and title not in sources:
                            sources.append(title)
                    
                    if sources:
                        lbl = {"en": "Sources", "tr": "Kaynaklar", "ar": "المصادر"}.get(language, "Sources")
                        rag_response += f"\n\n*_{lbl}: {', '.join(sources)} _*"

                    response_cache.set(query, rag_response, assistant_type, language)
                    if can_learn: learn_response(query, rag_response, assistant_type, language, intent_hint=sub_intent)
                    await wait_task
                    return rag_response, None, "Smart Router (RAG Knowledge)"
        except Exception: pass

    ai_response = await ai_fallback_response(query=query, assistant_type=assistant_type, gemini_model=gemini_model, student_model=student_model, lawyer_model=lawyer_model, rag_context=[], language=language, history_text=history_text)
    await wait_task
    if ai_response:
        # Cache the AI response so repeat queries get instant hits
        response_cache.set(query, ai_response, assistant_type, language)
        if can_learn: learn_response(query, ai_response, assistant_type, language, intent_hint=sub_intent)
        return ai_response, None, f"AI Fallback ({assistant_type} agent)"

    fallback_msg = {
        "en": "Hi! \ud83d\udc4b Let's get things moving. What kind of venture or procedure are we looking into today?",
        "tr": "Selam! \ud83d\udc4b Hadi ba\u015flayal\u0131m. Bug\u00fcn hangi t\u00fcr bir i\u015flem veya proje ile ilgileniyoruz?",
        "ar": "\u064a\u0627 \u0623\u0647\u0644\u0627\u064b! \ud83d\udc4b \u0644\u0646\u0628\u062f\u0623 \u0627\u0644\u0639\u0645\u0644. \u0645\u0627 \u0647\u0648 \u0627\u0644\u0646\u0634\u0627\u0637 \u0623\u0648 \u0627\u0644\u0625\u062c\u0631\u0627\u0622 \u0627\u0644\u0630\u064a \u062a\u0631\u064a\u062f \u0627\u0644\u0628\u062f\u0621 \u0628\u0647 \u0627\u0644\u064a\u0648\u0645\u061f"
    }.get(language, "Hi! Let's get started.")
    return fallback_msg, None, "Hardcoded Orchestrator Fallback"
