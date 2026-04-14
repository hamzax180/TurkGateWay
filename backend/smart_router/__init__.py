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
from typing import Optional
from difflib import SequenceMatcher

from .keyword_router import detect_intent
from .template_engine import render, build_variables
from . import cache as response_cache
from .ai_fallback import ai_fallback_response
from .learning_cache import learn as learn_response, set_live_library as _set_live_library, find_learned_response as _find_learned

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
            learned_file = os.path.join(_AGENTS_DIR, agent, f"learned{suffix}.json")
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

# Placeholder to avoid duplicate except block below
_library_loaded = True
if not _library_loaded:
    pass
elif False:
        print(f"[SmartRouter] WARNING: Failed to load '{lang}' response libraries: {e}")


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
    r"\b(enroll|register|apply) (at|for|to|in) (a |the |my )?university\b",
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
    r"\b(fired|wrongfully dismissed|unfair dismissal|severance pay|k\u0131dem tazminat|employment dispute|labour court|i\u015f mahkemesi)\b",
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
]

_ALL_BUSINESS_TYPES = [
    "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis",
    "pharmacy", "eczane", "bakery", "barber", "berber", "gym", "shop",
    "store", "company", "clothing", "hotel", "clinic", "school",
]

_UNI_MAP = {
    "boğaziçi": "Boğaziçi University", "bogazici": "Boğaziçi University", "boğaziçi uni": "Boğaziçi University", "boğaziçi üni": "Boğaziçi University", "boun": "Boğaziçi University", "boga": "Boğaziçi University", "boğa": "Boğaziçi University", "bogaz": "Boğaziçi University", "boğaz": "Boğaziçi University",
    "metu": "METU (ODTÜ)", "odtü": "METU (ODTÜ)", "odtu": "METU (ODTÜ)", "met": "METU (ODTÜ)",
    "istanbul university": "Istanbul University", "istanbul üniversitesi": "Istanbul University", "istanbul uni": "Istanbul University", "istanbul üni": "Istanbul University", "istanbul": "Istanbul University", "iu": "Istanbul University", "iü": "Istanbul University", "ist": "Istanbul University",
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
    "أنقرة": "Ankara University", "حاجيتيبه": "Hacettepe University", "ألتن باش": "Altınbaş University", "أيدن": "Istanbul Aydın University"
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

def _fuzzy_match(word: str, candidates: list, threshold: float = 0.75) -> str | None:
    """Return the best candidate if similarity >= threshold, else None."""
    word = word.lower().strip()
    # Support short abbreviations (like IÜ, ITÜ, AU)
    if len(word) < 2:
        return None
    best, best_score = None, 0.0
    for c in candidates:
        # Heuristic: if it's an abbreviation, it might be much shorter than the full name
        # but for our _UNI_MAP, the candidates ARE the keys (which include short forms)
        # So we can keep a loose length check
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
    
    # Ensure language exists in library
    lang_lib = _library.get(language, _library["en"])
    
    if intent_group in lang_lib and isinstance(lang_lib[intent_group], list):
        return random.choice(lang_lib[intent_group])
    
    group_data = lang_lib.get(intent_group)
    if isinstance(group_data, dict) and sub_intent:
        options = group_data.get(sub_intent)
        if options:
            return random.choice(options)
            
    # Final fallback to English if no match found in localized lib
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
    history_text: str = ""
) -> Optional[str]:
    import asyncio
    
    # --- PHASE 1: Start Thinking ---
    # This task runs in parallel while we calculate the "correctest" answer locally.
    wait_task = asyncio.create_task(asyncio.sleep(3.0))
    
    query = query.strip()
    cached = response_cache.get(query, assistant_type, language)
    if cached:
        await wait_task
        return cached

    # --- PHASE 0.5: Contextual Affirmative Check (Handle 'yes' to deadlines) ---
    lower_q = query.lower().strip().replace("?", "").replace(".", "").replace("!", "")
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1] if "[assistant]:" in history_text.lower() else ""
    
    affirmative = ["yes", "yeah", "yep", "sure", "ok", "okay", "evet", "tamam", "olur", "نعم", "ايوه", "أجل", "طبعا", "طبعاً", "ماشي"]
    if lower_q in affirmative and last_assistant_msg:
        if any(marker in last_assistant_msg for marker in ["check the current registration calendar", "registration calendar", "university deadline", "kayıt takvimi", "moaud", "موعد", "announcements", "duyurular", "major schools"]):
            prompt = {
                "en": "Great! 🎓 Which university are you targeting? Please type the name (e.g., Boğaziçi, METU, Istanbul University) and I'll find their specific deadline for you.",
                "tr": "Harika! 🎓 Hangi üniversite ile ilgileniyorsun? Lütfen adını yaz (örneğin Boğaziçi, ODTÜ, İstanbul Üniversitesi), senin için güncel takvime bakayım.",
                "ar": "ممتاز! 🎓 ما هي الجامعة التي تود الاستفسار عنها؟ يرجى كتابة اسمها (مثلاً جامعة إسطنبول، بوغازيتشي، ODTÜ) وسأبحث لك عن موعدها المحدد."
            }.get(language, "Great! Which university are you targeting?")
            await wait_task
            return prompt

    # --- PHASE 0.5b: Contextual University Reply ---
    # If the bot just asked "which university?" or the user types a university name directly,
    # resolve it and fast-path into the registration roadmap — no AI needed.
    _was_asking_uni = any(marker in last_assistant_msg for marker in [
        "which university", "hangi üniversite", "في أي جامعة",
        "register at", "kayıt yaptırmak", "التسجيل",
        "type the name", "please type the name"
    ])
    
    # ── GLOBAL UNIVERSITY SHORTCUT (for Students) ──
    # If a student types a university name anywhere, we assume they want the roadmap.
    # This bypasses the need for specific intent detection or strict context markers.
    _reply_uni = None
    if assistant_type == "student" and len(query.split()) <= 5:
        # Exact match
        for key, val in _UNI_MAP.items():
            if key == lower_q or (f" {key} " in f" {lower_q} "):
                _reply_uni = val
                break
        # Fuzzy match (only for single words or very short phrases)
        if not _reply_uni and len(lower_q) >= 3:
            for key, val in _UNI_MAP.items():
                if _fuzzy_match(lower_q, [key], threshold=0.85):
                    _reply_uni = val
                    break

    if (_was_asking_uni or _reply_uni) and assistant_type == "student":
        if not _reply_uni:
            # Try matching within the query if not already found by shortcut
            for key, val in _UNI_MAP.items():
                if key in lower_q:
                    _reply_uni = val
                    break
        
        # Extended fuzzy check if still no match
        if not _reply_uni:
            for key, val in _UNI_MAP.items():
                # Word-by-word fuzzy match
                for word in lower_q.split():
                    if len(word) >= 3 and _fuzzy_match(word, [key], threshold=0.75):
                        _reply_uni = val
                        break
                if _reply_uni: break
            
            if not _reply_uni and _was_asking_uni:
                # ONLY show 'not found' if we were explicitly asking. 
                # Otherwise let it fall through to normal AI.
                msg = {
                    "en": "🎓 **UNI NOT FOUND IN OUR DATA.** I currently track the registration calendars for the Top 10 universities in Turkey. Please try one of our supported schools like Boğaziçi, METU, or Altınbaş!",
                    "tr": "🎓 **BU ÜNİVERSİTE VERİLERİMİZDE BULUNAMADI.** Şu anda Türkiye'deki ilk 10 üniversitenin kayıt takvimlerini takip ediyorum. Lütfen Boğaziçi, ODTÜ veya Altınbaş gibi desteklenen okulları deneyin!",
                    "ar": "🎓 **هذه الجامعة غير موجودة في بياناتنا.** أتابع حالياً مواعيد التسجيل لأول 10 جامعات في تركيا. يرجى تجربة إحدى الجامعات المدعومة مثل بوغازيتشي، ODTÜ، أو ألتن باش!"
                }.get(language, "UNI NOT FOUND IN OUR DATA.")
                await wait_task
                return msg

        if _reply_uni:
            # Resume the registration roadmap for this university
            from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan
            from utils.protocol import get_localized_steps
            from datetime import datetime
            deadline_info = _UNI_DEADLINES.get(_reply_uni, {}).get(language, "August")
            prompt_summ = {
                "en": f"Perfect! 🎓 Here's your complete registration roadmap for **{_reply_uni}**! The general registration window is around **{deadline_info}**.",
                "tr": f"Harika! 🎓 **{_reply_uni}** için kayıt yol haritanı hazırladım! Genel kayıt dönemi yaklaşık **{deadline_info}**.",
                "ar": f"ممتاز! 🎓 إليك خارطة طريق التسجيل الكاملة لجامعة **{_reply_uni}**! نافذة التسجيل العامة تكون حول **{deadline_info}**."
            }.get(language, f"Perfect! 🎓 Here's your registration roadmap for **{_reply_uni}**!")
            _bt = "student.register_uni"
            step_specs = get_localized_steps(language, _bt)
            details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]
            steps_list = [title for id_val, title, resp, note in step_specs]
            labels = {"en": {"ag": "Key Institutions", "dc": "Essential Documents", "st": "Registration Steps"}, "tr": {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Kayıt Adımları"}, "ar": {"ag": "المؤسسات", "dc": "المستندات المطلوبة", "st": "خطوات التسجيل"}}.get(language, {"ag": "Agencies", "dc": "Docs", "st": "Steps"})
            agencies = ["University Registrar", "Portal / OBS", "MEB (Denklik)"]
            docs = ["Admission Letter", "Passport", "Original Diploma", "Apostille", "Photos"]
            combined = CombinedPermitResult(permits=[f"{_reply_uni} Registration"], agencies=agencies, documents=docs, steps=steps_list, timeline_days=15, summary=prompt_summ, location=_reply_uni, business_type=_bt)
            state = PermitState(business_profile={"raw_query": query, "language": language, "university": _reply_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[_reply_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Advisor"]), last_updated=datetime.now())
            out_str = f"💬 {prompt_summ}\n\n📋 **{labels['ag']}:** {', '.join(agencies)}\n📄 **{labels['dc']}:** {', '.join(docs)}\n✅ **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list))
            dashboard_dump = state.model_dump()
            if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
            await wait_task
            return out_str, dashboard_dump

    user_blocks = re.findall(r"\[user\]:([\s\S]*?)(?=\[assistant\]:|\[user\]:|-{5,}|$)", history_text.lower())
    user_history_text = " ".join(b.strip() for b in user_blocks)
    combined_context = f"{user_history_text} {query}".lower()
    
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1] if "[assistant]:" in history_text.lower() else ""
    is_clarifying = any(k in last_assistant_msg for k in [
        "what type of business", "hangi tür işletme", "ما هو نوع العمل",
        "which district", "hangi ilçesinde", "في أي منطقة",
        "which university", "hangi üniversite", "في أي جامعة"
    ])
    
    has_relevant_kw = any(w in query.lower() for w in [
        "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis", "pharmacy", "eczane", "bakery", "fırın", "barber", "berber", "gym", "spor", "shop", "store", "company", "mağaza", "dükkan",
        "adalar", "arnavutkoy", "arnavutköy", "atasehir", "ataşehir", "avcilar", "avcılar", "bagcilar", "bağcılar", "bahcelievler", "bahçelievler", "bakirkoy", "bakırköy", "basaksehir", "başakşehir", "bayrampasa", "bayrampaşa", "besiktas", "beşiktaş", "beykoz", "beylikduzu", "beylikdüzü", "beyoglu", "beyoğlu", "buyukcekmece", "büyükçekmece", "catalca", "çatalca", "cekmekoy", "çekmeköy", "esenler", "esenyurt", "eyup", "eyüp", "eyüpsultan", "fatih", "gaziosmanpasa", "gaziosmanpaşa", "gungoren", "güngören", "kadikoy", "kadıköy", "kagithane", "kağıthane", "kartal", "kucukcekmece", "küçükçekmece", "maltepe", "pendik", "sancaktepe", "sariyer", "sarıyer", "sile", "şile", "silivri", "sisli", "şişli", "sultanbeyli", "sultangazi", "tuzla", "umraniye", "ümraniye", "uskudar", "üsküdar", "zeytinburnu"
    ])
    
    fuzzy_district_match = None
    fuzzy_business_match = None
    if not has_relevant_kw:
        for word in query.lower().split():
            if not fuzzy_district_match: fuzzy_district_match = _fuzzy_match(word, _ALL_DISTRICTS)
            if not fuzzy_business_match: fuzzy_business_match = _fuzzy_match(word, _ALL_BUSINESS_TYPES)
        if fuzzy_district_match or fuzzy_business_match:
            has_relevant_kw = True
    
    # --- PHASE 0: Early Keyword Detection ---
    # Run keyword detection BEFORE meta-query bypass so that queries with
    # strong local matches (e.g. "what documents do I need?") get served locally.
    early_intent_group, early_sub_intent, early_confidence = detect_intent(query, assistant_type)
    
    # --- PHASE 0.5b: Meta-Query Bypass (only if NO keyword match) ---
    # If the user is asking a complex question that has no local keyword match,
    # let the full AI orchestrator handle it.
    if early_confidence == 0 and _META_QUERY_RE.search(query) and len(query.split()) > 4:
        print(f"[SmartRouter] Meta-query detected with no keyword match ('{query[:30]}...'). Bypassing for AI orchestrator.")
        return None

    if _NEW_CONSULTATION_RE.search(query) or _ISOLATED_ANSWER_RE.match(query) or (is_clarifying and has_relevant_kw):
        from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan
        from utils.protocol import get_localized_steps
        from datetime import datetime

        # ── GATE: Topic Shift Protection ──
        # If the user asks for a new consultation but they already have a full roadmap 
        # in the current chat, ask them to open a New Chat so they don't overwrite it.
        # We check last_assistant_msg length because boilerplate (steps/checkmarks) is stripped by backend.
        has_completed_roadmap = bool(last_assistant_msg and len(last_assistant_msg) > 30 and not is_clarifying)
        
        if _NEW_CONSULTATION_RE.search(query) and has_completed_roadmap:
            msg = {
                "en": "REDIRECT_NEW_CHAT: ⚠️ It looks like you want to start a new procedure! Opening a **New Chat** automatically to keep your current progress safe...",
                "tr": "REDIRECT_NEW_CHAT: ⚠️ Görünüşe göre yeni bir işleme başlamak istiyorsun! Mevcut çalışma alanını kaybetmemek için otomatik olarak **Yeni Sohbet** açılıyor...",
                "ar": "REDIRECT_NEW_CHAT: ⚠️ يبدو أنك تريد بدء إجراء جديد! جاري فتح **دردشة جديدة** تلقائياً للحفاظ على تقدمك الحالي في أمان..."
            }.get(language, "REDIRECT_NEW_CHAT: Opening a New Chat for this procedure.")
            await wait_task
            return msg
        # ──────────────────────────────────

        if assistant_type == "permit":
            _BUSINESS_KEYWORDS = [
                (["restaurant", "restoran", "lokanta", "dining", "dinner", "resteruant", "resteraunt"], "Restaurant", "Restoran", "مطعم"),
                (["cafe", "kafe", "coffee shop", "kahve", "pastane", "tea house", "caffe", "cafee"], "Café", "Kafe", "مقاهي"),
                (["bakery", "fırın", "firın", "bread", "pastry", "cafetaria"], "Bakery", "Fırın", "مخبز"),
                (["pharmacy", "eczane", "chemist", "drugstore"], "Pharmacy", "Eczane", "صيدلية"),
                (["barber", "berber", "hair salon", "kuaför", "kuafor", "beauty", "güzellik", "spa"], "Hair Salon / Beauty", "Kuaför / Güzellik Salonu", "صالون حلاقة / تجميل"),
                (["gym", "fitness", "spor salonu", "crossfit"], "Gym / Fitness Centre", "Spor Salonu / Fitness", "صالة ألعاب رياضية"),
                (["clothing", "giyim", "boutique", "apparel", "fashion", "mağaza", "dükkan"], "Clothing Store", "Giyim Mağazası", "متجر ملابس"),
                (["retail", "shop", "store", "market", "grocery", "bakkal"], "Retail Shop", "Perakende Mağaza", "متجر تجزئة"),
                (["office", "ofis", "consulting", "danışmanlık", "agency", "büro"], "Office / Consultancy", "Ofis / Danışmanlık", "مكتب / استشارات"),
                (["tech", "software", "yazılım", "startup"], "Tech / Software Company", "Teknoloji / Yazılım Şirketi", "شركة تقنية / برمجيات"),
                (["hotel", "hostel", "accommodation", "konaklama"], "Hotel / Accommodation", "Otel / Konaklama", "فندق / إقامة"),
                (["clinic", "klinik", "medical", "dental", "doctor", "doktor", "diş"], "Medical Clinic", "Tıbbi Klinik", "عيادة طبية"),
                (["school", "okul", "education", "dershane", "kurs"], "Educational Centre", "Eğitim Merkezi", "مركز تعليمي"),
            ]
            
            business_type_en, business_type_tr, business_type_ar = "Business", "İşletme", "عمل"
            for kw_list, en_n, tr_n, ar_n in _BUSINESS_KEYWORDS:
                if any(kw in query.lower() for kw in kw_list):
                    business_type_en, business_type_tr, business_type_ar = en_n, tr_n, ar_n
                    break
            if business_type_en == "Business":
                for kw_list, en_n, tr_n, ar_n in _BUSINESS_KEYWORDS:
                    # Check history more robustly — match whole words or chunks to handle typos like 'resteruant'
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
                "adalar":     ("Adalar", "Adalar Municipality", "Permits in the Princes' Islands involve strict environmental and coastal regulations.", "Adalar Belediyesi", "Prens Adaları'ndaki izinler sıkı çevresel ve kıyı düzenlemeleri içerir.", "بلدية أدالار", "تتضمن التصاريح في جزر الأميرات لوائح بيئية وساحلية صارمة."),
                "arnavutkoy": ("Arnavutköy", "Arnavutköy Municipality", "New airport area growth district.", "Arnavutköy Belediyesi", "Yeni havalimanı bölgesinde büyüyen ilçe.", "بلدية أرناووط كوي", "منطقة نمو بجوار المطار الجديد."),
                "arnavutköy": ("Arnavutköy", "Arnavutköy Municipality", "New airport area growth district.", "Arnavutköy Belediyesi", "Yeni havalimanı bölgesinde büyüyen ilçe.", "بلدية أرناووط كوي", "منطقة نمو بجوار المطار الجديد."),
                "atasehir":   ("Ataşehir", "Ataşehir Municipality", "Financial hub area.", "Ataşehir Belediyesi", "Finans merkezi bölgesi.", "بلدية أتاشهير", "منطقة المركز المالي."),
                "ataşehir":   ("Ataşehir", "Ataşehir Municipality", "Financial hub area.", "Ataşehir Belediyesi", "Finans merkezi bölgesi.", "بلدية أتاشهير", "منطقة المركز المالي."),
                "avcilar":    ("Avcılar", "Avcılar Municipality", "Mixed residential/commercial zone.", "Avcılar Belediyesi", "Karma konut/ticaret bölgesi.", "بلدية أفجيلار", "منطقة سكنية/تجارية مختلطة."),
                "avcılar":    ("Avcılar", "Avcılar Municipality", "Mixed residential/commercial zone.", "Avcılar Belediyesi", "Karma konut/ticaret bölgesi.", "بلدية أفجيلار", "منطقة سكنية/تجارية مختلطة."),
                "bagcilar":   ("Bağcılar", "Bağcılar Municipality", "Major commercial hub.", "Bağcılar Belediyesi", "Büyük ticaret merkezi.", "بلدية باججيلار", "مركز تجاري رئيسي."),
                "bağcılar":   ("Bağcılar", "Bağcılar Municipality", "Major commercial hub.", "Bağcılar Belediyesi", "Büyük ticaret merkezi.", "بلدية باججيلار", "مركز تجاري رئيسي."),
                "bahcelievler": ("Bahçelievler", "Bahçelievler Municipality", "Densely populated trade area.", "Bahçelievler Belediyesi", "Yoğun nüfuslu ticaret bölgesi.", "بلدية باهتشيليفلار", "منطقة تجارية مكتظة بالسكان."),
                "bahçelievler": ("Bahçelievler", "Bahçelievler Municipality", "Densely populated trade area.", "Bahçelievler Belediyesi", "Yoğun nüfuslu ticaret bölgesi.", "بلدية باهتشيليفلار", "منطقة تجارية مكتظة بالسكان."),
                "bakirkoy":   ("Bakırköy", "Bakırköy Municipality", "High traffic retail area.", "Bakırköy Belediyesi", "Yoğun trafikli perakende satış alanı.", "بلدية بكر كوي", "منطقة تجزئة مزدحمة."),
                "bakırköy":   ("Bakırköy", "Bakırköy Municipality", "High traffic retail area.", "Bakırköy Belediyesi", "Yoğun trafikli perakende satış alanı.", "بلدية بكر كوي", "منطقة تجزئة مزدحمة."),
                "basaksehir": ("Başakşehir", "Başakşehir Municipality", "Streamlined industrial zones.", "Başakşehir Belediyesi", "Hızlandırılmış sanayi bölgeleri.", "بلدية باشاك شهير", "مناطق صناعية متطورة."),
                "başakşehir": ("Başakşehir", "Başakşehir Municipality", "Streamlined industrial zones.", "Başakşehir Belediyesi", "Hızlandırılmış sanayi bölgeleri.", "بلدية باشاك شهير", "مناطق صناعية متطورة."),
                "bayrampasa": ("Bayrampaşa", "Bayrampaşa Belediyesi", "Commercial wholesale hub.", "Bayrampaşa Belediyesi", "Ticari toptan satış merkezi.", "بلدية بايرام باشا", "مركز تجاري للجملة."),
                "bayrampaşa": ("Bayrampaşa", "Bayrampaşa Belediyesi", "Commercial wholesale hub.", "Bayrampaşa Belediyesi", "Ticari toptan satış merkezi.", "بلدية بايرام باشا", "مركز تجاري للجملة."),
                "besiktas":   ("Beşiktaş", "Beşiktaş Municipality", "Strict signage & frontage rules.", "Beşiktaş Belediyesi", "Sıkı tabela ve cephe kuralları.", "بلدية بشكتاش", "لوائح صارمة للافتات والواجهات."),
                "beşiktaş":   ("Beşiktaş", "Beşiktaş Municipality", "Strict signage & frontage rules.", "Beşiktaş Belediyesi", "Sıkı tabela ve cephe kuralları.", "بلدية بشكتاش", "لوائح صارمة للافتات والواجهات."),
                "beykoz":     ("Beykoz", "Beykoz Municipality", "Protected Bosphorus zones.", "Beykoz Belediyesi", "Korumalı Boğaziçi bölgeleri.", "بلدية بيكوز", "مناطق البوسفور المحمية."),
                "beylikduzu": ("Beylikdüzü", "Beylikdüzü Belediyesi", "Modern street retail hub.", "Beylikdüzü Belediyesi", "Modern sokak perakende merkezi.", "بلدية بيليك دوزو", "مركز تجزئة حديث."),
                "beylikdüzü": ("Beylikdüzü", "Beylikdüzü Belediyesi", "Modern street retail hub.", "Beylikdüzü Belediyesi", "Modern sokak perakende merkezi.", "بلدية بيليك دوزو", "مركز تجزئة حديث."),
                "beyoglu":    ("Beyoğlu", "Beyoğlu Municipality", "Historic zone restrictions.", "Beyoğlu Belediyesi", "Tarihi bölge kısıtlamaları.", "بلدية بيوغلو", "قيود المناطق التاريخية."),
                "beyoğlu":    ("Beyoğlu", "Beyoğlu Municipality", "Historic zone restrictions.", "Beyoğlu Belediyesi", "Tarihi bölge kısıtlamaları.", "بلدية بيوغلو", "قيود المناطق التاريخية."),
                "buyukcekmece": ("Büyükçekmece", "Büyükçekmece Municipality", "Coastal project priority.", "Büyükçekmece Belediyesi", "Kıyı projesi önceliği.", "بلدية بويوك تشكمجه", "أولوية المشاريع الساحلية."),
                "büyükçekmece": ("Büyükçekmece", "Büyükçekmece Municipality", "Coastal project priority.", "Büyükçekmece Belediyesi", "Kıyı projesi önceliği.", "بلدية بويوك تشكمجه", "أولوية المشاريع الساحلية."),
                "catalca":    ("Çatalca", "Çatalca Municipality", "Agricultural/Logistics zone.", "Çatalca Belediyesi", "Tarım/Lojistik bölgesi.", "بلدية شاتالجا", "منطقة زراعية/لوجستية."),
                "çatalca":    ("Çatalca", "Çatalca Municipality", "Agricultural/Logistics zone.", "Çatalca Belediyesi", "Tarım/Lojistik bölgesi.", "بلدية شاتالجا", "منطقة زراعية/لوجستية."),
                "cekmekoy":   ("Çekmeköy", "Çekmeköy Municipality", "New residential commercial labs.", "Çekmeköy Belediyesi", "Yeni konut ve ticaret laboratuvarları.", "بلدية تشكمه كوي", "مختبرات تجارية وسكنية حديثة."),
                "çekmeköy":   ("Çekmeköy", "Çekmeköy Municipality", "New residential commercial labs.", "Çekmeköy Belediyesi", "Yeni konut ve ticaret laboratuvarları.", "بلدية تشكمه كوي", "مختبرات تجارية وسكنية حديثة."),
                "esenler":    ("Esenler", "Esenler Municipality", "High traffic transport hub.", "Esenler Belediyesi", "Yoğun trafik taşıma merkezi.", "بلدية إيسنلار", "مركز نقل مزدحم."),
                "esenyurt":   ("Esenyurt", "Esenyurt Municipality", "High density population business.", "Esenyurt Belediyesi", "Yüksek yoğunluklu nüfus ve işletmeler.", "بلدية إيسينيورت", "منطقة أعمال ذات كثافة سكانية عالية."),
                "eyup":       ("Eyüpsultan", "Eyüpsultan Municipality", "Heritage site protocols.", "Eyüpsultan Belediyesi", "Miras alanı protokolleri.", "بلدية أيوب سلطان", "بروتوكولات مواقع التراث."),
                "eyüp":       ("Eyüpsultan", "Eyüpsultan Municipality", "Heritage site protocols.", "Eyüpsultan Belediyesi", "Miras alanı protokolleri.", "بلدية أيوب سلطان", "بروتوكولات مواقع التراث."),
                "eyüpsultan": ("Eyüpsultan", "Eyüpsultan Municipality", "Heritage site protocols.", "Eyüpsultan Belediyesi", "Miras alanı protokolleri.", "بلدية أيوب سلطان", "بروتوكولات مواقع التراث."),
                "fatih":      ("Fatih", "Fatih Municipality", "Strict sit site protocols.", "Fatih Belediyesi", "Sıkı sit alanı protokolleri.", "بلدية فاتح", "بروتوكولات مناطق المواقع الأثرية."),
                "gaziosmanpasa": ("Gaziosmanpaşa", "Gaziosmanpaşa Municipality", "Market density permits.", "Gaziosmanpaşa Belediyesi", "Pazar yoğunluklu izinler.", "بلدية غازي عثمان باشا", "تصاريح كثافة الأسواق."),
                "gaziosmanpaşa": ("Gaziosmanpaşa", "Gaziosmanpaşa Municipality", "Market density permits.", "Gaziosmanpaşa Belediyesi", "Pazar yoğunluklu izinler.", "بلدية غازي عثمان باشا", "تصاريح كثافة الأسواق."),
                "gungoren":   ("Güngören", "Güngören Municipality", "Trade & Textile hub.", "Güngören Belediyesi", "Ticaret ve Tekstil merkezi.", "بلدية جونغورين", "مركز التجارة والمنسوجات."),
                "güngören":   ("Güngören", "Güngören Municipality", "Trade & Textile hub.", "Güngören Belediyesi", "Ticaret ve Tekstil merkezi.", "بلدية جونغورين", "مركز التجارة والمنسوجات."),
                "kadikoy":    ("Kadıköy", "Kadıköy Municipality", "Foreigner investment support.", "Kadıköy Belediyesi", "Yabancı yatırımcı desteği.", "بلدية كاديكوي", "دعم المستثمرين الأجانب."),
                "kadıköy":    ("Kadıköy", "Kadıköy Municipality", "Foreigner investment support.", "Kadıköy Belediyesi", "Yabancı yatırımcı desteği.", "بلدية كاديكوي", "دعم المستثمرين الأجانب."),
                "kagithane":  ("Kağıthane", "Kağıthane Municipality", "Emerging tech hub.", "Kağıthane Belediyesi", "Yükselen teknoloji merkezi.", "بلدية كاغيت هانة", "مركز تقني ناشئ."),
                "kağıthane":  ("Kağıthane", "Kağıthane Municipality", "Emerging tech hub.", "Kağıthane Belediyesi", "Yükselen teknoloji merkezi.", "بلدية كاغيت هانة", "مركز تقني ناشئ."),
                "kartal":     ("Kartal", "Kartal Belediyesi", "Large commercial blocks.", "Kartal Belediyesi", "Büyük ticari bloklar.", "بلدية كارتال", "مجمعات تجارية كبرى."),
                "kucukcekmece": ("Küçükçekmece", "Küçükçekmece Municipality", "Zoning audit recommended.", "Küçükçekmece Belediyesi", "İmar denetimi önerilir.", "بلدية كوتشوك تشكمجه", "يوصى بتدقيق تقسيم المناطق."),
                "küçükçekmece": ("Küçükçekmece", "Küçükçekmece Municipality", "Zoning audit recommended.", "Küçükçekmece Belediyesi", "İmar denetimi önerilir.", "بلدية كوتشوك تشكمجه", "يوصى بتدقيق تقسيم المناطق."),
                "maltepe":    ("Maltepe", "Maltepe Belediyesi", "Retail project friendly.", "Maltepe Belediyesi", "Perakende projelerine uygun.", "بلدية مالتبي", "صديقة لمشاريع التجزئة."),
                "pendik":     ("Pendik", "Pendik Municipality", "Logistics/Port proximity.", "Pendik Belediyesi", "Lojistik/Liman yakınlığı.", "بلدية بنديك", "بالقرب من اللوجستيات والميناء."),
                "sancaktepe": ("Sancaktepe", "Sancaktepe Municipality", "New commercial district.", "Sancaktepe Belediyesi", "Yeni ticari bölge.", "بلدية سانجاكتبي", "حي تجاري حديث."),
                "sariyer":    ("Sarıyer", "Sarıyer Municipality", "Business corporate streamlined.", "Sarıyer Belediyesi", "İş ve kurumsal süreçler hızlandırılmış.", "بلدية ساريير", "تبسيط الإجراءات التجارية للشركات."),
                "sarıyer":    ("Sarıyer", "Sarıyer Municipality", "Business corporate streamlined.", "Sarıyer Belediyesi", "İş ve kurumsal süreçler hızlandırılmış.", "بلدية ساريير", "تبسيط الإجراءات التجارية للشركات."),
                "sile":       ("Şile", "Şile Municipality", "Tourism seasonal checks.", "Şile Belediyesi", "Turizm mevsimsel denetimleri.", "بلدية شيليه", "عمليات تفتيش سياحية موسمية."),
                "şile":       ("Şile", "Şile Municipality", "Tourism seasonal checks.", "Şile Belediyesi", "Turizm mevsimsel denetimleri.", "بلدية شيليه", "عمليات تفتيش سياحية موسمية."),
                "silivri":    ("Silivri", "Silivri Municipality", "Agricultural buffer zone.", "Silivri Belediyesi", "Tarım tampon bölgesi.", "بلدية سيليفري", "منطقة عازلة زراعية."),
                "sisli":      ("Şişli", "Şişli Municipality", "Fast-track 'hızlı' desk.", "Şişli Belediyesi", "Hızlandırılmış masa mevcuttur.", "بلدية شيشلي", "مكتب 'هيزلي' (سريع) متاح."),
                "şişli":      ("Şişli", "Şişli Municipality", "Fast-track 'hızlı' desk.", "Şişli Belediyesi", "Hızlandırılmış masa mevcuttur.", "بلدية شيشلي", "مكتب 'هيزلي' (سريع) متاح."),
                "sultanbeyli": ("Sultanbeyli", "Sultanbeyli Municipality", "Competitive rent permits.", "Sultanbeyli Belediyesi", "Rekabetçi kira izinleri.", "بلدية سلطان بيلي", "تصاريح إيجارية تنافسية."),
                "sultangazi": ("Sultangazi", "Sultangazi Municipality", "Workshop/Factory heavy.", "Sultangazi Belediyesi", "Atölye/Fabrika yoğunluklu.", "بلدية سلطان غازي", "كثافة الورش والمصانع."),
                "tuzla":      ("Tuzla", "Tuzla Municipality", "Maritime/Industrial zone.", "Tuzla Belediyesi", "Denizcilik/Sanayi bölgesi.", "بلدية توزلا", "منطقة بحرية/صناعية."),
                "umraniye":   ("Ümraniye", "Ümraniye Municipality", "High volume commercial.", "Ümraniye Belediyesi", "Yüksek hacimli ticari bölge.", "بلدية عمرانية", "منطقة تجارية ضخمة."),
                "ümraniye":   ("Ümraniye", "Ümraniye Municipality", "High volume commercial.", "Ümraniye Belediyesi", "Yüksek hacimli ticari bölge.", "بلدية عمرانية", "منطقة تجارية ضخمة."),
                "uskudar":    ("Üsküdar", "Üsküdar Municipality", "Strict silence zone rules.", "Üsküdar Belediyesi", "Sıkı gürültü yasağı kuralları.", "بلدية أوسكودار", "لوائح صارمة لمناطق الهدوء."),
                "üsküdar":    ("Üsküdar", "Üsküdar Municipality", "Strict silence zone rules.", "Üsküdar Belediyesi", "Sıkı gürültü yasağı kuralları.", "بلدية أوسكودار", "لوائح صارمة لمناطق الهدوء."),
                "zeytinburnu": ("Zeytinburnu", "Zeytinburnu Belediyesi", "Textile hub priorities.", "Zeytinburnu Belediyesi", "Tekstil ve üretim öncelikleri.", "بلدية زيتين بورنو", "أولويات قطاع المنسوجات."),
            }

            district_en = "Istanbul"
            district_display = None
            mun_name_en = "Your District Municipality"
            district_note = ""

            query_lower = query.lower()
            for key, data in _DISTRICT_INFO.items():
                if key in query_lower:
                    dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                    district_en = dname
                    district_display = dname
                    if language == "tr":
                        mun_name_en, district_note = mun_tr, note_tr
                    elif language == "ar":
                        mun_name_en, district_note = mun_ar, note_ar
                    else:
                        mun_name_en, district_note = mun_en, note_en
                    break
                    
            if district_display is None:
                for key, data in _DISTRICT_INFO.items():
                    if key in user_history_text:
                        dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                        district_en = dname
                        district_display = dname
                        if language == "tr":
                            mun_name_en, district_note = mun_tr, note_tr
                        elif language == "ar":
                            mun_name_en, district_note = mun_ar, note_ar
                        else:
                            mun_name_en, district_note = mun_en, note_en
                        break
            
            if district_display is None and fuzzy_district_match in _DISTRICT_INFO:
                dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = _DISTRICT_INFO[fuzzy_district_match]
                district_en = dname
                district_display = dname
                if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                else: mun_name_en, district_note = mun_en, note_en

            no_district = district_display is None
            missing_items = []
            if business_type == "Business": missing_items.append("business")
            if no_district: missing_items.append("district")

            if missing_items:
                ack_business = business_type if business_type != "Business" else None
                ack_district = district_display if not no_district else None
                if language == "tr":
                    if ack_business and "district" in missing_items: msg = f"Harika, **{ack_business}** iyi bir seçim! 👍 Şimdi tam yol haritanı oluşturabilmem için: **İstanbul'un hangi ilçesinde** açacaksın?"
                    elif ack_district and "business" in missing_items: msg = f"Tamam, **{ack_district}** bölgesini not aldım! 📍 Şimdi: **Hangi tür işletme** (Kafe, Mağaza vb.) açacaksın?"
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
                    if ack_business and "district" in missing_items: msg = f"Great choice — **{ack_business}**! 👍 Now, to build your full roadmap: **Which district of Istanbul** are you opening in?"
                    elif ack_district and "business" in missing_items: msg = f"Got it — **{ack_district}** noted! 📍 Now: **What type of business** are you planning to open (e.g., Cafe, Retail, Restaurant)?"
                    else:
                        msg = "To map out your exact roadmap, could you please tell me: "
                        if "district" in missing_items: msg += "**Which district of Istanbul** are you opening in?"
                await wait_task
                return msg

            district = district_display
            mun_name = mun_name_en

            if language == "tr":
                permits = [f"{district} İşyeri Açma ve Çalışma Ruhsatı"]
                agencies = [mun_name, "Vergi Dairesi"]
                docs = ["Kimlik", "Kira Sözleşmesi", "Vergi Levhası", "NACE Kodu Belgesi"]
                summ = f"Mükemmel seçim! {district}'de {business_type} açmak için bilmeniz gereken her şeyi hazırladım. 🎉 Önemli not: {district_note} Aşağıdaki yol haritasını takip edin ve merak ettiğinizi sorun!"
                labels = {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Adımlar", "tm": "Tahmini Süre", "dy": "gün"}
            elif language == "ar":
                permits = [f"رخصة فتح وتشغيل من بلدية {district}"]
                agencies = [mun_name, "مكتب الضرائب (Vergi Dairesi)"]
                docs = ["بطاقة الهوية/جواز السفر", "عقد الإيجار (موثق)", "اللوحة الضريبية (Vergi Levhası)", "وثيقة رمز NACE"]
                summ = f"اختيار مهني موفق! لقد قمت بإعداد خريطة طريق متكاملة لافتتاح **{business_type}** في منطقة **{district}**. 🎉 ملاحظة هامة: {district_note} يرجى اتباع الخطوات أدناه، وأنا هنا للإجابة على أي استفسار قانوني أو إجرائي."
                labels = {"ag": "المؤسسات والهيئات", "dc": "المستندات المطلوبة", "st": "خطوات العمل", "tm": "الجدول الزمني المتوقع", "dy": "يوم"}
            else:
                permits = [f"{district} Workplace Operating License"]
                agencies = [mun_name, "Tax Office (Vergi Dairesi)"]
                docs = ["ID / Passport", "Lease Agreement", "Tax Plate", "NACE Code Certificate"]
                summ = f"Great choice — I've put together your complete roadmap for opening a {business_type} in {district}! 🚀 📍 **{district} note:** {district_note} Follow the steps below and feel free to ask me anything along the way."
                labels = {"ag": "Institutions / Agencies", "dc": "Documents You'll Need", "st": "Your Action Steps", "tm": "Estimated Timeline", "dy": "days"}

            timeline = 30
            _food_context = combined_context
            if any(kw in _food_context for kw in ["restaurant", "restoran", "cafe", "kafe", "bakery", "fırın", "firın", "food", "gıda"]):
                timeline = 45
                if language == "tr":
                    permits.extend(["İtfaiye Uygunluk Raporu", "Baca Uygunluğu"])
                    docs.extend(["İtfaiye Raporu"])
                    agencies.extend(["İBB İtfaiye Daire Başkanlığı"])
                elif language == "ar":
                    permits.extend(["تقرير الإطفاء", "ملاءمة المدخنة"])
                    docs.extend(["تقرير المطافئ"])
                    agencies.extend(["إدارة الإطفاء في البلدية"])
                else:
                    permits.extend(["Fire Safety Report", "Chimney Compliance"])
                    docs.extend(["Fire Report"])
                    agencies.extend(["Istanbul Fire Department (İBB İtfaiye)"])

        elif assistant_type == "student":
            # Check for specific University deadline first
            found_uni = None
            for key, val in _UNI_MAP.items():
                if key in query.lower() or key in user_history_text:
                    found_uni = val
                    break
            
            # ── GATE: No university named yet → ask which one FIRST ──────────
            # Only applies to registration-type queries (not ikamet/ID renewal).
            is_renew_check = any(w in query.lower() for w in ["renew", "replace", "uzat", "تجديد", "ikamet", "kimlik", "residence"])
            if not found_uni and not is_renew_check:
                # Check if the intent is clearly about registration / enrolling
                reg_keywords = ["register", "enroll", "enrol", "registration", "enrollment", "kayıt", "yöks", "تسجيل", "قبول", "i want to register", "before deadline", "deadline"]
                if any(kw in query.lower() for kw in reg_keywords):
                    which_uni_msg = {
                        "en": "🎓 Of course! Before I build your roadmap, could you tell me: **Which university are you looking to register at?**\n\n(e.g., Boğaziçi, METU, Istanbul University, Koç, Altınbaş…)",
                        "tr": "🎓 Tabii ki! Sana özel bir yol haritası hazırlayabilmem için önce şunu söyler misin: **Hangi üniversiteye kayıt yaptırmak istiyorsun?**\n\n(örn. Boğaziçi, ODTÜ, İstanbul Üniversitesi, Koç, Altınbaş…)",
                        "ar": "🎓 بكل سرور! قبل أن أعد لك خريطة الطريق، أخبرني: **في أي جامعة تريد التسجيل؟**\n\n(مثلاً: بوغازيتشي، ODTÜ، جامعة إسطنبول، كوتش، ألتن باش…)"
                    }.get(language, "🎓 Of course! **Which university are you looking to register at?** (e.g., Boğaziçi, METU, Istanbul University…)")
                    await wait_task
                    return which_uni_msg
            # ─────────────────────────────────────────────────────────────────

            if found_uni and not is_renew_check:
                deadline_info = _UNI_DEADLINES.get(found_uni, {}).get(language, "August")
                prompt_summ = {
                    "en": f"Found it! 🎓 The deadline for **{found_uni}** is **{deadline_info}**. I've also generated your step-by-step registration roadmap in the dashboard!",
                    "tr": f"Buldum! 🎓 **{found_uni}** için son tarih **{deadline_info}**. Ayrıca senin için hazırladığım kayıt yol haritasını panelde görebilirsin!",
                    "ar": f"وجدتها! 🎓 الموعد النهائي لجامعة **{found_uni}** هو **{deadline_info}**. لقد قمت أيضاً بإنشاء خارطة طريق التسجيل الخاصة بك في لوحة التحكم!"
                }.get(language, f"Found it! The deadline for {found_uni} is {deadline_info}")
                
                business_type = "student.register_uni"
                step_specs = get_localized_steps(language, business_type)
                details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]
                steps_list = [title for id_val, title, resp, note in step_specs]
                labels = {"en": {"ag": "Key Institutions", "dc": "Essential Documents", "st": "Registration Steps"}, "tr": {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Kayıt Adımları"}, "ar": {"ag": "المؤسسات", "dc": "المستندات المطلوبة", "st": "خطوات التسجيل"}}.get(language, {"ag": "Agencies", "dc": "Docs", "st": "Steps"})
                agencies = ["University Registrar", "Portal / OBS", "MEB (Denklik)"]
                docs = ["Admission Letter", "Passport", "Original Diploma", "Apostille", "Photos"]
                
                combined = CombinedPermitResult(permits=[f"{found_uni} Registration"], agencies=agencies, documents=docs, steps=steps_list, timeline_days=15, summary=prompt_summ, location=found_uni, business_type=business_type)
                state = PermitState(business_profile={"raw_query": query, "language": language, "university": found_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[found_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Advisor"]), last_updated=datetime.now())
                
                out_str = f"💬 {prompt_summ}\n\n📋 **{labels['ag']}:** {', '.join(agencies)}\n📄 **{labels['dc']}:** {', '.join(docs)}\n✅ **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list))
                dashboard_dump = state.model_dump()
                if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
                await wait_task
                return out_str, dashboard_dump
            
            # Contextual fallback for unlisted universities
            if last_assistant_msg and any(k in last_assistant_msg for k in ["targeting", "üniversite", "جامعة", "duyurular", "announcements", "major schools", "register at", "kayıt yaptırmak"]):
                await wait_task
                return {
                    "en": "🎓 **UNI NOT FOUND IN OUR DATA.** I currently track the registration calendars for the Top 10 universities in Turkey. Please try one of our supported schools!",
                    "tr": "🎓 **BU ÜNİVERSİTE VERİLERİMİZDE BULUNAMADI.** Şu anda Türkiye'deki ilk 10 üniversitenin kayıt takvimlerini takip ediyorum. Lütfen desteklenen okulları deneyin!",
                    "ar": "🎓 **هذه الجامعة غير موجودة في بياناتنا.** أتابع حالياً مواعيد التسجيل لأول 10 جامعات في تركيا. يرجى تجربة إحدى الجامعات المدعومة!"
                }.get(language, "UNI NOT FOUND IN OUR DATA.")

            is_renew = "renew" in query.lower() or "replace" in query.lower() or "uzat" in query.lower() or "تجديد" in query.lower()
            business_type = "student_renew" if is_renew else "Student"
            district, timeline = "Istanbul", (10 if is_renew else 30)
            if language == "tr":
                permits = ["Öğrenci İkamet İzni Uzatması"] if is_renew else ["Öğrenci Kaydı", "Öğrenci İkamet İzni"]
                agencies = ["Göç İdaresi", "Noter", "Sigorta Şirketi"] if is_renew else ["Öğrenci İşleri", "Göç İdaresi", "SGK"]
                docs = ["Sağlık Sigortası", "Noter Onaylı Kira Sözleşmesi", "Öğrenci Belgesi", "Biyometrik Fotoğraf"] if is_renew else ["Pasaport", "Kabul Mektubu", "Sağlık Sigortası"]
                summ = "Sorun değil, hemen organize edelim! 🎓 İkamet yenileme süreci birkaç adımdan oluşuyor — sigortanı yenilemekten Göç İdaresi randevuna kadar her şeyi aşağıda hazırladım." if is_renew else "Türkiye'de öğrenci olmak heyecan verici — tebrikler! 🎓 Üniversite kaydından öğrenci kimliğine (Kimlik) kadar tüm sürecini adım adım hazırladım."
                labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımların", "tm":"Tahmini Süre", "dy":"gün"}
            elif language == "ar":
                permits = ["تمديد إقامة الطالب"] if is_renew else ["تسجيل الجامعة", "إقامة الطالب"]
                agencies = ["إدارة الهجرة", "العدل (النوتر)", "شركة التأمين"] if is_renew else ["شؤون الطلاب", "إدارة الهجرة", "SGK"]
                docs = ["التأمين الصحي", "عقد إيجار موثق", "شهادة طالب", "صور شخصية"] if is_renew else ["جواز السفر", "خطاب القبول", "التأمين الصحي"]
                summ = "لا تقلق، سنرتب كل شيء معاً! 🎓 عملية تجديد الإقامة تتكون من عدة خطوات — من تجديد التأمين وصولاً إلى موعد إدارة الهجرة." if is_renew else "تهانينا على قبولك في الجامعة! 🎓 لقد أعددت لك خريطة طريق شاملة من التسجيل الجامعي وصولاً إلى هوية الطالب (Kimlik)."
                labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطواتك", "tm":"المدة المتوقعة", "dy":"يوم"}
            else:
                permits = ["Student Residence Permit Extension"] if is_renew else ["University Registration", "Student Residence Permit"]
                agencies = ["Migration Office (Göç İdaresi)", "Notary Public", "Insurance Provider"] if is_renew else ["Student Affairs", "Migration Directorate (Göç İdaresi)", "SGK"]
                docs = ["Health Insurance Policy", "Notarized Lease Agreement", "Student Certificate", "Biometric Photos"] if is_renew else ["Passport", "Acceptance Letter", "Health Insurance"]
                summ = "No stress — let's sort this out together! 🎓 Renewing your student residency (Kimlik) involves a few key steps." if is_renew else "Welcome to Turkey — exciting times ahead! 🎓 I've put together your complete roadmap from university registration to your Student Residence Permit."
                labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Your Action Steps", "tm":"Estimated Timeline", "dy":"days"}

        elif assistant_type == "lawyer":
            # REFINED LOGIC: Check current query FIRST, then combined history
            query_lower = query.lower()
            hist_lower = combined_context
            
            # Map queries to subtypes
            def get_subtype(text):
                if any(k in text for k in ["contract", "sözleşme", "nda", "agreement", "clause", "signing"]): return "lawyer_contract"
                if any(k in text for k in ["company", "formation", "ltd", "a.ş", "şirket", "business registration"]): return "lawyer_company"
                if any(k in text for k in ["fired", "dismissed", "termination", "severance", "employment", "işten çıkar", "kıdem"]): return "lawyer_employment"
                if any(k in text for k in ["work permit", "residence permit", "ikamet", "stay in turkey", "çalışma izni"]): return "lawyer_residency"
                if any(k in text for k in ["lawsuit", "court", "mediation", "arabuluculuk", "ihtarname"]): return "lawyer_dispute"
                if any(k in text for k in ["buy", "sell", "rent", "house", "property", "apartment", "real estate", "tapu"]): return "lawyer_real_estate"
                if any(k in text for k in ["police", "arrest", "criminal", "charge", "jail", "suç", "drugs", "theft", "zaza", "marijuana", "possession", "caught"]): return "lawyer_criminal"
                if any(k in text for k in ["debt", "unpaid", "invoice", "icra", "haciz", "collection"]): return "lawyer_debt"
                return None

            # Priority: 1. Current Query 2. Historical Context
            lawyer_subtype = get_subtype(query_lower) or get_subtype(hist_lower)
            
            # If still nothing, let the AI handle it instead of defaulting to Contract
            if not lawyer_subtype:
                return None

            district, business_type = "Turkey", lawyer_subtype
            if lawyer_subtype == "lawyer_contract":
                timeline = 14
                if language == "tr":
                    permits, agencies, docs = ["Sözleşme İncelemesi"], ["Avukat/Hukuk Bürosu", "Noter"], ["Sözleşme", "Kimlik"]
                    summ, labels = "İmzalamadan önce durmanız çok doğru bir karar! ⚖️ Maddeleri inceliyoruz.", {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits, agencies, docs = ["مراجعة العقد"], ["محامٍ / مكتب قانوني", "كاتب العدل"], ["العقد", "وثيقة هوية"]
                    summ, labels = "قرار صائب أن توقف قبل التوقيع! ⚖️ سأراجع العقد بعناية.", {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة", "dy":"يوم"}
                else:
                    permits, agencies, docs = ["Contract Review"], ["Lawyer / Law Firm", "Notary Public"], ["Contract Document", "ID Document"]
                    summ, labels = "Smart move to pause before signing! ⚖️ I'll walk you through the key areas.", {"ag":"Institutions", "dc":"Documents", "st":"Steps", "tm":"Timeline", "dy":"days"}
            elif lawyer_subtype == "lawyer_company":
                timeline = 10
                if language == "tr":
                    permits, agencies, docs = ["Ltd. Şirket Tescili"], ["Ticaret Sicili", "Vergi Dairesi"], ["Pasaport", "Ana Sözleşme", "Kira Sözleşmesi"]
                    summ, labels = "Harika bir karar! 🏢 Türkiye'de şirket kurmak düşündüğünüzden çok daha kolay.", {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits, agencies, docs = ["تسجيل شركة"], ["السجل التجاري", "مكتب الضرائب"], ["جواز السفر", "نظام الشركة", "عقد الإيجار"]
                    summ, labels = "قرار رائع! 🏢 تأسيس شركة في تركيا أسهل مما تتوقع.", {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة", "dy":"يوم"}
                else:
                    permits, agencies, docs = ["Company Registration"], ["Trade Registry", "Tax Office"], ["Passport", "Articles of Association", "Lease Agreement"]
                    summ, labels = "Great decision! 🏢 Forming a company in Turkey is straightforward.", {"ag":"Institutions", "dc":"Documents", "st":"Steps", "tm":"Timeline", "dy":"days"}
            else:
                 timeline = 20
                 permits, agencies, docs, summ, labels = ["Legal Consultation"], ["Law Court"], ["Evidence"], "Legal guidance requested.", {"ag":"Agencies", "dc":"Docs", "st":"Steps", "tm":"Time", "dy":"days"}
        else: return None

        step_specs = get_localized_steps(language, business_type)
        details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]
        steps_list = [title for id_val, title, resp, note in step_specs]
        combined = CombinedPermitResult(permits=permits, agencies=agencies, documents=docs, steps=steps_list, timeline_days=timeline, summary=summ, location=district, business_type=business_type)
        state = PermitState(business_profile={"raw_query": query, "language": language}, combined_result=combined, permit_plan=PermitPlan(permits=permits, agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Planner"]), last_updated=datetime.now())
        out_str = f"💬 {summ}\n\n📋 **{labels['ag']}:** {', '.join(agencies)}\n📄 **{labels['dc']}:** {', '.join(docs[:6])}\n✅ **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) + f"\n\n⏱️ **{labels['tm']}:** {timeline} {labels['dy']}"
        dashboard_dump = state.model_dump()
        if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
        await wait_task
        return out_str, dashboard_dump

    # Re-use the early detection results instead of re-running detect_intent
    intent_group, sub_intent, confidence = early_intent_group, early_sub_intent, early_confidence
    if confidence > 0:
        if intent_group == "redirect":
            target_agent, target_sub_intent = sub_intent.split(":", 1) if sub_intent and ":" in sub_intent else (sub_intent, None)
            
            # Hide the answer and ONLY show the switch message as requested by USER
            if target_agent == "lawyer": suffix = {"tr": "Bu konu hukuki uzmanlık gerektirmektedir. Lütfen yukarıdan **Avukat Danışmanı** moduna geçin.", "ar": "هذا الموضوع يتطلب خبرة قانونية. يرجى التبديل لوضع **المستشار القانوني** من الأعلى.", "en": "This topic requires legal expertise. Please switch to **Lawyer Advisor** mode using the selector above."}.get(language, "Please switch to Lawyer mode.")
            elif target_agent == "student": suffix = {"tr": "Öğrenci prosedürleri için lütfen yukarıdan **Öğrenci Danışmanı** moduna geçin.", "ar": "بالنسبة للإجراءات الطلابية، يرجى التبديل لوضع **المستشار الطلابي** من الأعلى.", "en": "For student procedures, please switch to **Student Advisor** mode using the selector above."}.get(language, "Please switch to Student mode.")
            else: suffix = {"tr": "İşletme ruhsatı işlemleri için lütfen yukarıdan **Ruhsat Danışmanı** moduna geçin.", "ar": "بالنسبة لإجراءات تراخيص الأعمال، يرجى التبديل لوضع **مستشار التراخيص** من الأعلى.", "en": "For business permit procedures, please switch to **Permit Advisor** mode using the selector above."}.get(language, "Please switch to Permit mode.")
            
            raw_response = f"*( {suffix} )*"
        else:
            raw_response = None
            # ── GATE: student.register_uni without a named university ─────────
            if assistant_type == "student" and sub_intent == "register_uni":
                _found_uni_kw = any(k in query.lower() or k in user_history_text for k in _UNI_MAP)
                _is_renew_kw = any(w in query.lower() for w in ["renew", "replace", "uzat", "تجديد", "ikamet", "kimlik", "residence"])
                if not _found_uni_kw and not _is_renew_kw:
                    which_uni_msg = {
                        "en": "🎓 Of course! Before I build your roadmap, could you tell me: **Which university are you looking to register at?**\n\n(e.g., Boğaziçi, METU, Istanbul University, Koç, Altınbaş…)",
                        "tr": "🎓 Tabii ki! Sana özel bir yol haritası hazırlayabilmem için önce şunu söyler misin: **Hangi üniversiteye kayıt yaptırmak istiyorsun?**\n\n(örn. Boğaziçi, ODTÜ, İstanbul Üniversitesi, Koç, Altınbaş…)",
                        "ar": "🎓 بكل سرور! قبل أن أعد لك خريطة الطريق، أخبرني: **في أي جامعة تريد التسجيل؟**\n\n(مثلاً: بوغازيتشي، ODTÜ، جامعة إسطنبول، كوتش، ألتن باش…)"
                    }.get(language, "🎓 Of course! **Which university are you looking to register at?** (e.g., Boğaziçi, METU, Istanbul University…)")
                    await wait_task
                    return which_uni_msg
            # ─────────────────────────────────────────────────────────────────
            if _RAG_AVAILABLE and sub_intent:
                try:
                    import asyncio
                    rag_chunks = None # retrieval in async is tricky here, fallback to library
                except Exception: rag_chunks = None
            if not raw_response: raw_response = _pick_response(intent_group, sub_intent, language=language)
        
        if intent_group == "greeting":
            if assistant_type == "permit": raw_response = {"tr": "Selamlar! 👋 İşletme ruhsatı planlarında sana rehberlik etmek için buradayım. Bugün hangi heyecan verici projeyi başlatıyoruz?", "ar": "أهلاً بك! 👋 يسعدني جداً مساعدتك في الحصول على تراخيص عملك الجديد في تركيا. أخبرني، ما هو النشاط الذي تحلم بافتتاحه؟", "en": "Hi! 👋 I'm so excited to help you get your business license sorted in Turkey. What kind of venture are we launching today?"}.get(language, raw_response)
            elif assistant_type == "lawyer": raw_response = {"tr": "Merhaba! ⚖️ Hukuki konularda sana destek olmak ve işini sağlama almak için yanındayım. Bugün sana nasıl bir çözüm sunabilirim?", "ar": "مرحباً بك! ⚖️ أنا هنا لأحمي مصالحك القانونية وأوجهك للطريق الصحيح في تركيا. كيف يمكنني دعمك اليوم؟", "en": "Hello there! ⚖️ I'm here to back you up on all things legal and make sure your business is safe and sound. How can I help you out today?"}.get(language, raw_response)
            elif assistant_type == "student": raw_response = {"tr": "Selamlar! 🎓 Türkiye'deki eğitim hayatında her şeyin yolunda gitmesi için buradayım. Bugün senin için ne yapabilirim?", "ar": "يا أهلاً! 🎓 أنا هنا لأتأكد أن رحلتك التعليمية في تركيا تسير بسلاسة تامة. كيف يمكنني مساعدتك بخبرتي اليوم؟", "en": "Hey! 🎓 I'm here to make sure your student life in Turkey is as smooth as possible. What can I do for you today?"}.get(language, raw_response)

        if intent_group == "smalltalk":
            if assistant_type == "lawyer": raw_response = {"tr": "Çok iyiyim, sorduğun için teşekkürler! ⚖️ Senin hukuk veya iş süreçlerin nasıl gidiyor? Her şey yolunda mı?", "ar": "أنا في أفضل حال، شكراً لسؤالك! ⚖️ كيف تسير أمورك القانونية أو التجارية حالياً؟ هل كل شيء على ما يرام؟", "en": "I'm doing great, thanks for asking! ⚖️ How are your legal or business matters going today? Keeping everything on track?"}.get(language, raw_response)
            elif assistant_type == "student": raw_response = {"tr": "Harikayım, teşekkürler! 🎓 Senin öğrencilik hayatın veya başvuru sürecin nasıl gidiyor? Yardım edebileceğim bir durum var mı?", "ar": "أنا بخير والحمد لله! 🎓 كيف تسير رحلتك التعليمية أو إجراءات تقديمك؟ هل هناك أي تحديات تواجهك؟", "en": "I'm doing excellent, thanks! 🎓 How is your student life or application process going? Anything I can help smooth out for you?"}.get(language, raw_response)
            else: raw_response = {"tr": "Çok iyiyim, teşekkürler! 👋 Senin işletme kurma hayallerin ne durumda? Her şey istediğin gibi gidiyor mu?", "ar": "أنا بخير جداً، شكراً لك! 👋 كيف تسير طموحاتك لافتتاح مشروعك الخاص؟ هل الأمور تسير كما خططت لها؟", "en": "I'm doing very well, thank you! 👋 How are your business plans coming along? Everything moving in the right direction?"}.get(language, raw_response)

        if raw_response:
            variables = build_variables(user_name=user_name)
            response = render(raw_response, variables)
            # Social intents already have native AR/TR in the library — skip translation
            _SOCIAL_INTENTS = {"greeting", "smalltalk", "farewell", "thanks", "identity", "capabilities"}
            needs_translation = language in ["ar", "tr"] and intent_group not in _SOCIAL_INTENTS
            if needs_translation and response:
                model_used = gemini_model if assistant_type == "permit" else (student_model if assistant_type == "student" else lawyer_model)
                if model_used:
                    try:
                        lang_name = "Arabic" if language == "ar" else "Turkish"
                        prompt = f"Translate the following text into natural, conversational {lang_name}. Keep formatting.\n\nText: {response}"
                        import asyncio
                        trans_result = await asyncio.to_thread(model_used.generate_content, prompt, generation_config={"temperature": 0.3})
                        if trans_result and trans_result.text: response = trans_result.text.strip()
                    except Exception: pass
            # Don't cache social intents — they should vary on each call
            if intent_group not in _SOCIAL_INTENTS:
                response_cache.set(query, response, assistant_type, language)
            await wait_task
            return response

    if intent_group in {"permit", "student", "lawyer"}:
        if _RAG_AVAILABLE:
            try:
                rag_chunks = await retrieve_chunks(query, assistant_type, language, top_k=3)
                if rag_chunks and rag_chunks[0].get("similarity", 0) > 0.45:
                    model_map = {"permit": gemini_model, "student": student_model, "lawyer": lawyer_model}
                    rag_response = await generate_rag_response(query=query, agent_type=assistant_type, language=language, gemini_model=model_map.get(assistant_type, gemini_model), retrieved_chunks=rag_chunks)
                    if rag_response:
                        response_cache.set(query, rag_response, assistant_type, language)
                        # Learn: save RAG response permanently
                        learn_response(query, rag_response, assistant_type, language, intent_hint=sub_intent)
                        await wait_task
                        return rag_response
            except Exception: pass
    # Check if we've previously learned a good AI response for a similar query.
    # This avoids burning API tokens on questions we've already answered well.
    learned = _find_learned(query, assistant_type, language)
    if learned:
        response_cache.set(query, learned, assistant_type, language)
        await wait_task
        return learned

    # --- PHASE 2: Deep Local Search & Decision ---
    # We try to find the "Correctest" answer by looking at history and fuzzy patterns.
    ai_response = await ai_fallback_response(query=query, assistant_type=assistant_type, gemini_model=gemini_model, student_model=student_model, lawyer_model=lawyer_model, rag_context=[], language=language)
    
    # Ensure we finish the 3-second "thought" period
    await wait_task

    if ai_response:
        response_cache.set(query, ai_response, assistant_type, language)
        # Learn: save AI fallback response permanently into the JSON library
        learn_response(query, ai_response, assistant_type, language, intent_hint=sub_intent)
        return ai_response

    # --- PHASE 3: Smart Orchestrator (Last Resort) ---
    # provide a high-quality humanized guide.
    if language == "ar":
        if assistant_type == "student": return "أهلاً بك! 👋 يسعدني جداً مساعدتك في رحلتك الدراسية بتركيا. يمكننا البدء فوراً في أمور مثل:\n- تجديد إقامتك الطلابية\n- البحث عن قبول جامعي أو منح\n- ترتيب السكن والمواصلات.\nما هو الشيء الذي يشغل بالك اليوم؟"
        elif assistant_type == "lawyer": return "أهلاً بك! ⚖️ سأكون معك خطوة بخطوة في شؤونك القانونية. يمكنني مساعدتك بشكل خاص في:\n- مراجعة العقود وتدقيقها\n- قضايا العمل والنزاعات\n- تأسيس الشركات والإقامة.\nتفضل بمشاركتي التفاصيل وسأعطيك أفضل نصيحة."
        else: return "أهلاً! 👋 دعنا نطلق مشروعك الجديد في تركيا معاً. أنا هنا لأدلك على:\n- خطوات تأسيس عملك (مطعم، مكتب، إلخ)\n- الأوراق المطلوبة والتكاليف التقريبية\n- التعامل مع البلديات.\nأين وصلت في خطتك حتى الآن؟"
    elif language == "tr":
        if assistant_type == "student": return "Selam! 👋 Türkiye'deki öğrencilik serüveninde sana destek olmak için buradayım. Hemen şunları çözebiliriz:\n- İkamet izni ve yenileme süreçleri\n- Üniversite kayıtları ve denklik\n- Yurt ve ulaşım kartı.\nNereden başlayalım?"
        elif assistant_type == "lawyer": return "Merhaba! ⚖️ Hukuki süreçlerinde sana rehberlik etmek için sabırsızlanıyorum. Özellikle şu konularda yanındayım:\n- Sözleşmelerin incelenmesi\n- İş hukuku ve davalar\n- Şirket kurulumu ve resmi işlemler.\nAklındaki soruyu biraz detaylandırır mısın?"
        else: return "Merhaba! 👋 Yeni işini kurma heyecanını paylaşıyorum. Senin için şunları netleştirebiliriz:\n- İşyeri açma ruhsatı adımları\n- Gerekli evraklar ve bütçe planlaması\n- Belediye süreçleri.\nHangi sektöre girmeyi düşünüyorsun?"
    else:
        if assistant_type == "student": return "Hey there! 👋 I'd love to help you sort out your student life in Turkey. We can jump right into things like:\n- Getting or renewing your student ID (Ikamet)\n- University registration & diploma equivalency\n- Finding a dorm or getting your transport card.\nWhat's the first thing on your list?"
        elif assistant_type == "lawyer": return "Hello! ⚖️ I'm here to walk you through your legal path in Turkey. I can help you with:\n- Carefully reviewing your contracts\n- Employment disputes or court cases\n- Company formation and legal residency.\nTell me a bit more about your situation so I can give you the best guidance."
        else: return "Hi! 👋 Let's get your business up and running together. I can guide you through:\n- Opening your shop, cafe, or office\n- Figuring out the costs and required docs\n- Navigating the local municipality rules.\nWhat kind of business are you dreaming of starting?"
