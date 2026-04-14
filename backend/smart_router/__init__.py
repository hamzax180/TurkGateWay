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
    "bo\u011fazi\u00e7i": "Bo\u011fazi\u00e7i University", "bogazici": "Bo\u011fazi\u00e7i University", "bo\u011fazi\u00e7i uni": "Bo\u011fazi\u00e7i University", "bo\u011fazi\u00e7i \u00fcni": "Bo\u011fazi\u00e7i University", "boun": "Bo\u011fazi\u00e7i University", "boga": "Bo\u011fazi\u00e7i University", "bo\u011fa": "Bo\u011fazi\u00e7i University", "bogaz": "Bo\u011fazi\u00e7i University", "bo\u011faz": "Bo\u011fazi\u00e7i University",
    "metu": "METU (ODT\u00dc)", "odt\u00fc": "METU (ODT\u00dc)", "odtu": "METU (ODT\u00dc)", "met": "METU (ODT\u00dc)",
    "istanbul university": "Istanbul University", "istanbul \u00fcniversitesi": "Istanbul University", "istanbul uni": "Istanbul University", "istanbul \u00fcni": "Istanbul University", "istanbul": "Istanbul University", "iu": "Istanbul University", "i\u00fc": "Istanbul University", "ist": "Istanbul University",
    "it\u00fc": "\u0130T\u00dc (Istanbul Technical)", "itu": "\u0130T\u00dc (Istanbul Technical)", "istanbul teknik": "\u0130T\u00dc (Istanbul Technical)", "istanbul technical": "\u0130T\u00dc (Istanbul Technical)",
    "hacettepe": "Hacettepe University", "hacettepe uni": "Hacettepe University", "hacettepe \u00fcni": "Hacettepe University", "hacett": "Hacettepe University", "hu": "Hacettepe University",
    "ko\u00e7": "Ko\u00e7 University", "koc": "Ko\u00e7 University", "ko\u00e7 uni": "Ko\u00e7 University", "ko\u00e7 \u00fcni": "Ko\u00e7 University", "kocu": "Ko\u00e7 University",
    "sabanc\u0131": "Sabanc\u0131 University", "sabanci": "Sabanc\u0131 University", "sabanc\u0131 uni": "Sabanc\u0131 University", "sabanc\u0131 \u00fcni": "Sabanc\u0131 University", "su": "Sabanc\u0131 University",
    "bilkent": "Bilkent University", "bilkent uni": "Bilkent University", "bilkent \u00fcni": "Bilkent University", "bil": "Bilkent University",
    "ankara university": "Ankara University", "ankara \u00fcniversitesi": "Ankara University", "ankara uni": "Ankara University", "ankara \u00fcni": "Ankara University", "ankara": "Ankara University", "au": "Ankara University",
    "ege university": "Ege University", "ege \u00fcniversitesi": "Ege University", "ege uni": "Ege University", "ege \u00fcni": "Ege University", "ege": "Ege University", "eu": "Ege University",
    "alt\u0131nba\u015f": "Alt\u0131nba\u015f University", "altinbas": "Alt\u0131nba\u015f University", "alt\u0131nba\u015f uni": "Alt\u0131nba\u015f University", "alt\u0131nba\u015f \u00fcni": "Alt\u0131nba\u015f University", "altunbas": "Alt\u0131nba\u015f University", "altn": "Alt\u0131nba\u015f University",
    "aydin": "Istanbul Ayd\u0131n University", "ayd\u0131n": "Istanbul Ayd\u0131n University", "aydin university": "Istanbul Ayd\u0131n University", "ayd\u0131n \u00fcniversitesi": "Istanbul Ayd\u0131n University", "iau": "Istanbul Ayd\u0131n University",
    "\u0628\u0648\u063a\u0627\u0632\u064a\u062a\u0634\u064a": "Bo\u011fazi\u00e7i University", "\u0627\u0644\u0634\u0631\u0642 \u0627\u0644\u0623\u0648\u0633\u0637": "METU (ODT\u00dc)", "\u0625\u0633\u0637\u0646\u0628\u0648\u0644": "Istanbul University", "\u062c\u0627\u0645\u0639\u0629 \u0625\u0633\u0637\u0646\u0628\u0648\u0644": "Istanbul University",
    "\u0643\u0648\u062a\u0634": "Ko\u00e7 University", "\u0633\u0627\u0628\u0627\u0646\u062c\u064a": "Sabanc\u0131 University", "\u0628\u064a\u0644\u0643\u0646\u062a": "Bilkent University", 
    "\u0623\u0646\u0642\u0631\u0629": "Ankara University", "\u062d\u0627\u062c\u064a\u062a\u064a\u0628\u064a": "Hacettepe University", "\u0623\u0644\u062a\u0646 \u0628\u0627\u0634": "Alt\u0131nba\u015f University", "\u0623\u064a\u062f\u0646": "Istanbul Ayd\u0131n University"
}

_UNI_DEADLINES = {
    "Bo\u011fazi\u00e7i University": {"en": "Mid-July", "tr": "Temmuz Ortas\u0131", "ar": "\u0645\u0646\u062a\u0635\u0641 \u064a\u0648\u0644\u064a\u0648"},
    "METU (ODT\u00dc)": {"en": "Early July", "tr": "Temmuz Ba\u015f\u0131", "ar": "\u0623\u0648\u0627\u0626\u0644 \u064a\u0648\u0644\u064a\u0648"},
    "Istanbul University": {"en": "August", "tr": "A\u011fustos", "ar": "\u0623\u063a\u0633\u0637\u0633"},
    "\u0130T\u00dc (Istanbul Technical)": {"en": "Early August", "tr": "A\u011fustos Ba\u015f\u0131", "ar": "\u0623\u0628\u0648\u0627\u0626\u0644 \u0623\u063a\u0633\u0637\u0633"},
    "Hacettepe University": {"en": "Mid-July", "tr": "Temmuz Ortas\u0131", "ar": "\u0645\u0646\u062a\u0635\u0641 \u064a\u0648\u0644\u064a\u0648"},
    "Ko\u00e7 University": {"en": "Early July", "tr": "Temmuz Ba\u015f\u0131", "ar": "\u0623\u0628\u0648\u0627\u0626\u0644 \u064a\u0648\u0644\u064a\u0648"},
    "Sabanc\u0131 University": {"en": "Mid-August", "tr": "A\u011fustos Ortas\u0131", "ar": "\u0645\u0646\u062a\u0635\u0641 \u0623\u063a\u0633\u0637\u0633"},
    "Bilkent University": {"en": "Mid-July", "tr": "Temmuz Ortas\u0131", "ar": "\u0645\u0646\u062a\u0635\u0641 \u064a\u0648\u0644\u064a\u0648"},
    "Ankara University": {"en": "August", "tr": "A\u011fustos", "ar": "\u0623\u063a\u0633\u0637\u0633"},
    "Ege University": {"en": "Early August", "tr": "A\u011fustos Ba\u015f\u0131", "ar": "\u0623\u0628\u0648\u0627\u0626\u0644 \u0623\u063a\u0633\u0637\u0633"},
    "Alt\u0131nba\u015f University": {"en": "Mid-August", "tr": "A\u011fustos Ortas\u0131", "ar": "\u0645\u0646\u062a\u0635\u0641 \u0623\u063a\u0633\u0637\u0633"},
    "Istanbul Ayd\u0131n University": {"en": "Late August", "tr": "A\u011fustos Sonu", "ar": "\u0623\u0648\u0627\u062e\u0631 \u0623\u063a\u0633\u0637\u0633"}
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
    can_learn: bool = True
) -> Tuple[Optional[str], Optional[dict], Optional[str]]:
    import asyncio
    
    # --- PHASE 1: Start Thinking ---
    wait_task = asyncio.create_task(asyncio.sleep(3.0))
    
    query = query.strip()
    cached = response_cache.get(query, assistant_type, language)
    if cached:
        await wait_task
        print(f"\n[Smart Router] \ud83d\ude80 Response served from IN-MEMORY EXACT CACHE")
        return cached, None, "In-Memory Exact Cache"

    # --- PHASE 0.2: Learning Cache Check ---
    learned = _find_learned(query, assistant_type, language)
    if learned:
        learned_text = learned[0] if isinstance(learned, tuple) else learned
        learned_state = learned[1] if isinstance(learned, tuple) else None
        
        response_cache.set(query, learned_text, assistant_type, language)
        print(f"\n[Smart Router] \ud83e\udde0 Response served from LEARNING CACHE (backend/agents/{assistant_type}/learned/{language}.json)")
        await wait_task
        return learned_text, learned_state, "Learning Cache (Learned Database)"

    # --- PHASE 0.5: Contextual Affirmative Check (Handle 'yes' to deadlines) ---
    lower_q = query.lower().strip().replace("?", "").replace(".", "").replace("!", "")
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1] if "[assistant]:" in history_text.lower() else ""
    
    affirmative = ["yes", "yeah", "yep", "sure", "ok", "okay", "evet", "tamam", "olur", "\u0646\u0639\u0645", "\u0627\u064a\u0648\u0647", "\u0623\u062c\u0644", "\u0637\u0628\u0631\u0627", "\u0637\u0628\u0631\u0627\u064b", "\u0645\u0627\u0634\u064a"]
    if lower_q in affirmative and last_assistant_msg:
        if any(marker in last_assistant_msg for marker in ["check the current registration calendar", "registration calendar", "university deadline", "kay\u0131t takvimi", "moaud", "\u0645\u0648\u0639\u062f", "announcements", "duyurular", "major schools"]):
            prompt = {
                "en": "Great! \ud83c\udf93 Which university are you targeting? Please type the name (e.g., Bo\u011fazi\u00e7i, METU, Istanbul University) and I'll find their specific deadline for you.",
                "tr": "Harika! \ud83c\udf93 Hangi \u00fcniversite ile ilgileniyorsun? L\u00fctfen ad\u0131n\u0131 yaz (\u00f6rne\u011fin Bo\u011fazi\u00e7i, ODT\u00dc, \u0130stanbul \u00fcniversitesi), senin i\u00e7in g\u00fcncel takvime bakay\u0131m.",
                "ar": "\u0645\u0645\u062a\u0627\u0632! \ud83c\udf93 \u0645\u0627 \u0647\u064a \u0627\u0644\u062c\u0627\u0645\u0639\u0629 \u0627\u0644\u062a\u064a \u062a\u0648\u062f \u0627\u0644\u0627\u0633\u062a\u0641\u0633\u0627\u0631 \u0639\u0646\u0647\u0627\u061f \u064a\u0631\u062c\u0649 \u0643\u062a\u0627\u0628\u0629 \u0627\u0633\u0645\u0647\u0627 (\u0645\u062b\u0644\u0627\u064b \u062c\u0627\u0645\u0639\u0629 \u0625\u0633\u0637\u0646\u0628\u0648\u0644\u060b \u0628\u0648\u063a\u0627\u0632\u064a\u062a\u0634\u064a\u060b ODT\u00dc) \u0648\u0633\u0623\u0628\u062d\u062b \u0644\u0643 \u0639\u0646 \u0645\u0648\u0639\u062f\u0647\u0627 \u0627\u0644\u0645\u062d\u062f\u062f."
            }.get(language, "Great! Which university are you targeting?")
            await wait_task
            return prompt, None, "Contextual Affirmative (Deadlines)"

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
            
            if not _reply_uni and _was_asking_uni:
                msg = {
                    "en": "\ud83c\udf93 **UNI NOT FOUND IN OUR DATA.** I currently track the registration calendars for the Top 10 universities in Turkey. Please try one of our supported schools like Bo\u011fazi\u00e7i, METU, or Alt\u0131nba\u015f!",
                    "tr": "\ud83c\udf93 **BU \u00dcN\u0130VERS\u0130TE VER\u0130LER\u0130M\u0130ZDE BULUNAMADI.** \u015eu anda T\u00fcrkiye'deki ilk 10 \u00fcniversitenin kay\u0131t takvimlerini takip ediyorum. L\u00fctfen Bo\u011fazi\u00e7i, ODT\u00dc veya Alt\u0131nba\u015f gibi desteklenen okullar\u0131 deneyin!",
                    "ar": "\ud83c\udf93 **\u0647\u0630\u0647 \u0627\u0644\u062c\u0627\u0645\u0639\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629 \u0641\u064a \u0628\u064a\u0627\u0646\u0627\u062a\u0646\u0627.** \u0623\u062a\u0627\u0628\u0639 \u062d\u0627\u0644\u064a\u0627\u064b \u0645\u0648\u0627\u0639\u064a\u062f \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0644\u0623\u0648\u0644 10 \u062c\u0627\u0645\u0639\u0627\u062a \u0641\u064a \u062a\u0631\u0643\u064a\u0627. \u064a\u0631\u062c\u0649 \u062a\u062c\u0631\u0628\u0629 \u0625\u062d\u062f\u0649 \u0627\u0644\u062c\u0627\u0645\u0639\u0627\u062a \u0627\u0644\u0645\u062f\u0639\u0648\u0645\u0629 \u0645\u062b\u0644 \u0628\u0648\u063a\u0627\u0632\u064a\u062a\u0634\u064a\u060b ODT\u00dc\u060b \u0623\u0648 \u0623\u0644\u062a\u0646 \u0628\u0627\u0634!"
                }.get(language, "UNI NOT FOUND IN OUR DATA.")
                await wait_task
                return msg, None, "Smart Router (UNI Not Found)"

        if _reply_uni:
            from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan
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
            details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]
            steps_list = [title for id_val, title, resp, note in step_specs]
            labels = {"en": {"ag": "Key Institutions", "dc": "Essential Documents", "st": "Registration Steps"}, "tr": {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Kay\u0131t Ad\u0131mlar\u0131"}, "ar": {"ag": "\u0627\u0644\u0645\u0624\u0633\u0633\u0627\u062a", "dc": "\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629", "st": "\u062e\u0637\u0648\u0627\u062a \u0627\u0644\u062a\u0633\u062c\u064a\u0644"}}.get(language, {"ag": "Agencies", "dc": "Docs", "st": "Steps"})
            agencies = ["University Registrar", "Portal / OBS", "MEB (Denklik)"]
            docs = ["Admission Letter", "Passport", "Original Diploma", "Apostille", "Photos"]
            combined = CombinedPermitResult(permits=[f"{_reply_uni} Registration"], agencies=agencies, documents=docs, steps=steps_list, timeline_days=15, summary=prompt_summ, location=_reply_uni, business_type=_bt)
            state = PermitState(business_profile={"raw_query": query, "language": language, "university": _reply_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[_reply_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Advisor"]), last_updated=datetime.now())
            out_str = f"\ud83d\udcac {prompt_summ}\n\n\ud83d\udccb **{labels['ag']}:** {', '.join(agencies)}\n\ud83d\udcc4 **{labels['dc']}:** {', '.join(docs)}\n\u2705 **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list))
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
        "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis", "pharmacy", "eczane", "bakery", "f\u0131r\u0131n", "barber", "berber", "gym", "spor", "shop", "store", "company", "ma\u011faza", "d\u00fckkan",
        "adalar", "arnavutkoy", "arnavutk\u00f6y", "atasehir", "ata\u015fehir", "avcilar", "avc\u0131lar", "bagcilar", "ba\u011fc\u0131lar", "bahcelievler", "bah\u00e7elievler", "bakirkoy", "bak\u0131rk\u00f6y", "basaksehir", "ba\u015fak\u015fehir", "bayrampasa", "bayrampa\u015fa", "besiktas", "be\u015fikta\u015f", "beykoz", "beylikduzu", "beylikd\u00fcz\u00fc", "beyoglu", "beyo\u011flu", "buyukcekmece", "b\u00fcy\u00fck\u00e7ekmece", "catalca", "\u00e7atalca", "cekmekoy", "\u00e7ekmek\u00f6y", "esenler", "esenyurt", "eyup", "ey\u00fcp", "ey\u00fcpsultan", "fatih", "gaziosmanpasa", "gaziosmanpa\u015fa", "gungoren", "g\u00fcng\u00f6ren", "kadikoy", "kad\u0131k\u00f6y", "kagithane", "ka\u011f\u0131thane", "kartal", "kucukcekmece", "k\u00fc\u00e7\u00fck\u00e7ekmece", "maltepe", "pendik", "sancaktepe", "sariyer", "sar\u0131yer", "sile", "\u015file", "silivri", "sisli", "\u015fi\u015fli", "sultanbeyli", "sultangazi", "tuzla", "umraniye", "\u00fcmraniye", "uskudar", "\u00fcck\u00fcdar", "zeytinburnu"
    ])
    
    fuzzy_district_match = None
    fuzzy_business_match = None
    if not has_relevant_kw:
        for word in query.lower().split():
            if not fuzzy_district_match: fuzzy_district_match = _fuzzy_match(word, _ALL_DISTRICTS)
            if not fuzzy_business_match: fuzzy_business_match = _fuzzy_match(word, _ALL_BUSINESS_TYPES)
        if fuzzy_district_match or fuzzy_business_match:
            has_relevant_kw = True
    
    early_intent_group, early_sub_intent, early_confidence = detect_intent(query, assistant_type)
    
    if early_confidence == 0 and _META_QUERY_RE.search(query) and len(query.split()) > 4:
        print(f"[SmartRouter] Meta-query detected with no keyword match ('{query[:30]}...'). Bypassing for AI orchestrator.")
        return None, None, "Meta-Query Bypass"

    if _NEW_CONSULTATION_RE.search(query) or _ISOLATED_ANSWER_RE.match(query) or (is_clarifying and has_relevant_kw):
        from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan
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
                "adalar":     ("Adalar", "Adalar Municipality", "Permits in the Princes' Islands involve strict environmental and coastal regulations.", "Adalar Belediyesi", "Prens Adalar\u0131'ndaki izinler s\u0131k\u0131 \u00e7evresel ve k\u0131y\u0131 d\u00fczenlemeleri i\u00e7erir.", "\u0628\u0644\u062f\u064a\u0629 \u0623\u062f\u0627\u0644\u0627\u0631", "\u062a\u062a\u0636\u0645\u0646 \u0627\u0644\u062a\u0635\u0627\u0631\u064a\u062d \u0641\u064a \u062c\u0632\u0631 \u0627\u0644\u0623\u0645\u064a\u0631\u0627\u062a \u0644\u0648\u0627\u0626\u062d \u0628\u064a\u0626\u064a\u0629 \u0648\u0633\u0627\u062d\u0644\u064a\u0629 \u0635\u0627\u0631\u0645\u0629."),
                "arnavutkoy": ("Arnavutk\u00f6y", "Arnavutk\u00f6y Municipality", "New airport area growth district.", "Arnavutk\u00f6y Belediyesi", "Yeni havaliman\u0131 b\u00f6lgesinde b\u00fcy\u00fck il\u00e7e.", "\u0628\u0644\u062f\u064a\u0629 \u0623\u0631\u0646\u0627\u0648\u0648\u0637 \u0643\u064a", "\u0645\u0646\u0637\u0642\u0629 \u0646\u0645\u0648 \u0628\u062c\u0648\u0627\u0631 \u0627\u0644\u0645\u0637\u0627\u0631 \u0627\u0644\u062c\u062f\u064a\u062f."),
                "besiktas":   ("Be\u015fikta\u015f", "Be\u015fikta\u015f Municipality", "Strict signage & frontage rules.", "Be\u015fikta\u015f Belediyesi", "S\u0131k\u0131 tabela ve cephe kurallar\u0131.", "\u0628\u0644\u062f\u064a\u0629 \u0628\u0634\u0643\u062a\u0627\u0634", "\u0644\u0648\u0627\u0626\u062d \u0635\u0627\u0631\u0645\u0629 \u0644\u0644\u0627\u0641\u062a\u0627\u062a \u0648\u0627\u0644\u0648\u0627\u062c\u0647\u0627\u062a."),
                "fatih":      ("Fatih", "Fatih Municipality", "Strict sit site protocols.", "Fatih Belediyesi", "S\u0131k\u0131 sit alan\u0131 protokolleri.", "\u0628\u0644\u062f\u064a\u0629 \u0641\u0627\u062a\u062d", "\u0628\u0631\u0648\u062a\u0648\u0643\u0648\u0644\u0627\u062a \u0645\u0646\u0627\u0637\u0642 \u0627\u0644\u0645\u0648\u0627\u0642\u0639 \u0627\u0644\u0623\u062b\u0631\u064a\u0629."),
                "kadikoy":    ("Kad\u0131k\u00f6y", "Kad\u0131k\u00f6y Municipality", "Foreigner investment support.", "Kad\u0131k\u00f6y Belediyesi", "Yabanc\u0131 yat\u0131r\u0131mc\u0131 deste\u011fi.", "\u0628\u0644\u062f\u064a\u0629 \u0643\u0627\u062f\u064a\u0643\u0648\u064a", "\u062f\u0631\u0645 \u0627\u0644\u0645\u0633\u062a\u062b\u0645\u0631\u064a\u0646 \u0627\u0644\u0623\u062c\u0627\u0646\u0628."),
                # Add others similarly...
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
                    if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                    elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                    else: mun_name_en, district_note = mun_en, note_en
                    break
                    
            if district_display is None:
                for key, data in _DISTRICT_INFO.items():
                    if key in user_history_text:
                        dname, mun_en, note_en, mun_tr, note_tr, mun_ar, note_ar = data
                        district_en = dname
                        district_display = dname
                        if language == "tr": mun_name_en, district_note = mun_tr, note_tr
                        elif language == "ar": mun_name_en, district_note = mun_ar, note_ar
                        else: mun_name_en, district_note = mun_en, note_en
                        break

            no_district = district_display is None
            missing_items = []
            if business_type == "Business": missing_items.append("business")
            if no_district: missing_items.append("district")

            if missing_items:
                ack_business = business_type if business_type != "Business" else None
                ack_district = district_display if not no_district else None
                if language == "tr":
                    if ack_business and "district" in missing_items: msg = f"Harika, **{ack_business}** iyi bir se\u00e7im! \ud83d\udc4d \u015eimdi tam yol haritan\u0131 olu\u015fturabilmem i\u00e7in: **\u0130stanbul'un hangi il\u00e7esinde** a\u00e7acaks\u0131n?"
                    elif ack_district and "business" in missing_items: msg = f"Tamam, **{ack_district}** b\u00f6lgesini not ald\u0131m! \ud83d\udccd \u015eimdi: **Hangi t\u00fcr i\u015fletme** (Kafe, Ma\u011faza vb.) a\u00e7acaks\u0131n?"
                    else:
                        msg = "Sana tam ve do\u011fru bir yol haritas\u0131 \u00e7izebilmem i\u00e7in l\u00fctfen \u015funlar\u0131 belirt: "
                        if "business" in missing_items: msg += "**Hangi t\u00fcr i\u015fletme** (Kafe, Ma\u011faza vb.) a\u00e7acaks\u0131n? "
                        if "district" in missing_items: msg += "**\u0130stanbul'un hangi il\u00e7esinde** a\u00e7acaks\u0131n?"
                elif language == "ar":
                    if ack_business and "district" in missing_items: msg = f"**{ack_business}**\u060b \u062e\u064a\u0627\u0631 \u0645\u0648\u0641\u0642 \u0644\u0644\u0628\u062f\u0621 \u0641\u064a \u0639\u0627\u0644\u0645 \u0627\u0644\u0623\u0639\u0645\u0627\u0644! \ud83d\udc4d \u0627\u0644\u0622\u0646 \u0644\u0643\u064a \u0623\u0631\u0633\u0645 \u0644\u0643 \u062e\u0631\u064a\u0637\u0629 \u0637\u0631\u064a\u0642 \u0645\u0647\u0646\u064a\u0629: **\u0641\u064a \u0623\u064a \u0645\u0646\u0637\u0642\u0629 (\u0628\u0644\u062f\u064a\u0629) \u0641\u064a \u0625\u0633\u0637\u0646\u0628\u0648\u0644** \u062a\u062e\u0637\u0637 \u0644\u0644\u0627\u0641\u062a\u062a\u0627\u062d\u061f"
                    elif ack_district and "business" in missing_items: msg = f"\u0631\u0627\u0626\u0639\u060b \u0644\u0642\u062f \u0633\u062c\u0644\u062a \u0645\u0646\u0637\u0642\u0629 **{ack_district}**! \ud83d\udccd \u0627\u0644\u0622\u0646 \u0633\u0624\u0627\u0644\u064a: **\u0645\u0627 \u0647\u0648 \u0627\u0644\u0646\u0634\u0627\u0637 \u0627\u0644\u062a\u062c\u0627\u0631\u064a** (\u0645\u0642\u0647\u0649\u060b \u0645\u062a\u062c\u0631\u060b \u0625\u0644\u062e) \u0627\u0644\u0630\u064a \u062a\u0648\u062f \u0645\u0645\u0627\u0631\u0633\u062a\u0647\u061f"
                    else:
                        msg = "\u0644\u0643\u064a \u0623\u062a\u0645\u0643\u0646 \u0645\u0646 \u0631\u0633\u0645 \u062e\u0631\u064a\u0637\u0629 \u0637\u0631\u064a\u0642 \u062f\u0641\u064a\u0642\u0629 \u0644\u0639\u0645\u0644\u0643\u060b \u064a\u0631\u062c\u0649 \u062a\u0632\u0648\u064a\u062f\u064a \u0628\u0627\u0644\u0622\u062a\u064a: "
                        if "business" in missing_items: msg += "**\u0645\u0627 \u0647\u0648 \u0646\u0648\u0639 \u0627\u0644\u0646\u0634\u0627\u0637 \u0627\u0644\u062a\u062c\u0627\u0631\u064a**\u061f "
                        if "district" in missing_items: msg += "**\u0641\u064a \u0623\u064a \u0645\u0646\u0637\u0642\u0629 \u0641\u064a \u0625\u0633\u0637\u0646\u0628\u0648\u0644** \u0633\u062a\u0641\u062a\u062d\u061f"
                else:
                    if ack_business and "district" in missing_items: msg = f"Great choice \u2014 **{ack_business}**! \ud83d\udc4d Now, to build your full roadmap: **Which district of Istanbul** are you opening in?"
                    elif ack_district and "business" in missing_items: msg = f"Got it \u2014 **{ack_district}** noted! \ud83d\udccd Now: **What type of business** are you planning to open (e.g., Cafe, Retail, Restaurant)?"
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
            for key, val in _UNI_MAP.items():
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
                combined = CombinedPermitResult(permits=[f"{found_uni} Registration"], agencies=agencies, documents=docs, steps=steps_list, timeline_days=15, summary=prompt_summ, location=found_uni, business_type=business_type); state = PermitState(business_profile={"raw_query": query, "language": language, "university": found_uni}, combined_result=combined, permit_plan=PermitPlan(permits=[found_uni], agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Student Advisor"]), last_updated=datetime.now())
                out_str, dashboard_dump = f"\ud83d\udcac {prompt_summ}\n\n\ud83d\udccb **{labels['ag']}:** {', '.join(agencies)}\n\ud83d\udcc4 **{labels['dc']}:** {', '.join(docs)}\n\u2705 **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)), state.model_dump()
                if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
                await wait_task
                return out_str, dashboard_dump, "Smart Router (Registration Roadmap)"
            
            if last_assistant_msg and any(k in last_assistant_msg for k in ["targeting", "\u00fcniversite", "\u062c\u0627\u0645\u0639\u0629", "duyurular", "announcements", "major schools", "register at", "kay\u0131t yapt\u0131rmak"]):
                await wait_task
                return {
                    "en": "\ud83c\udf93 **UNI NOT FOUND IN OUR DATA.** I currently track the registration calendars for the Top 10 universities in Turkey. Please try one of our supported schools!",
                    "tr": "\ud83c\udf93 **BU \u00dcN\u0130VERS\u0130TE VER\u0130LER\u0130M\u0130ZDE BULUNAMADI.** \u015eu anda T\u00fcrkiye'deki ilk 10 \u00fcniversitenin kay\u0131t takvimlerini takip ediyorum. L\u00fctfen desteklenen okullar\u0131 deneyin!",
                    "ar": "\ud83c\udf93 **\u0647\u0630\u0647 \u0627\u0644\u062c\u0627\u0645\u0639\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629 \u0641\u064a \u0628\u064a\u0627\u0646\u0627\u062a\u0646\u0627.** \u0623\u062a\u0627\u0628\u0639 \u062d\u0627\u0644\u064a\u0627\u064b \u0645\u0648\u0627\u0639\u064a\u062f \u0627\u0644\u062a\u0633\u062c\u064a\u0644 \u0644\u0623\u0648\u0644 10 \u062c\u0627\u0645\u0639\u0627\u062a \u0641\u064a \u062a\u0631\u0643\u064a\u0627. \u064a\u0631\u062c\u0649 \u062a\u062c\u0631\u0628\u0629 \u0625\u062d\u062f\u0649 \u0627\u0644\u062c\u0627\u0645\u0639\u0627\u062a \u0627\u0644\u0645\u062f\u0639\u0648\u0645\u0629!"
                }.get(language, "UNI NOT FOUND IN OUR DATA."), None, "Smart Router (Uni Not Found)"

            is_renew = "renew" in query.lower() or "replace" in query.lower() or "uzat" in query.lower() or "\u062a\u062c\u062f\u064a\u062f" in query.lower(); business_type, district, timeline = ("student_renew" if is_renew else "Student"), "Istanbul", (10 if is_renew else 30)
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

        step_specs = get_localized_steps(language, business_type); details = [StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note) for id_val, title, resp, note in step_specs]; steps_list = [title for id_val, title, resp, note in step_specs]; combined = CombinedPermitResult(permits=permits, agencies=agencies, documents=docs, steps=steps_list, timeline_days=timeline, summary=summ, location=district, business_type=business_type); state = PermitState(business_profile={"raw_query": query, "language": language}, combined_result=combined, permit_plan=PermitPlan(permits=permits, agencies=agencies, documents=docs), execution_plan=ExecutionPlan(steps=details, assigned_agents=["Planner"]), last_updated=datetime.now())
        out_str, dashboard_dump = f"\ud83d\udcac {summ}\n\n\ud83d\udccb **{labels['ag']}:** {', '.join(agencies)}\n\ud83d\udcc4 **{labels['dc']}:** {', '.join(docs[:6])}\n\u2705 **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) + f"\n\n\u23f1\ufe0f **{labels['tm']}:** {timeline} {labels['dy']}", state.model_dump()
        if hasattr(dashboard_dump.get("last_updated"), "isoformat"): dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
        await wait_task
        return out_str, dashboard_dump, "Smart Router (Legal/Student Roadmap)"

    intent_group, sub_intent, confidence = early_intent_group, early_sub_intent, early_confidence
    if confidence > 0:
        if intent_group == "redirect":
            target_agent = sub_intent.split(":", 1)[0] if sub_intent and ":" in sub_intent else sub_intent
            if target_agent == "lawyer": suffix = {"tr": "Bu konu hukuki uzmanl\u0131k gerektirmektedir. L\u00fctfen yukar\u0131dan **Avukat Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0636\u0648\u0639 \u064a\u062a\u0637\u0644\u0628 \u062e\u0628\u0631\u0629 \u0642\u0627\u0646\u0648\u0646\u064a\u0629. \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0627\u0644\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u0642\u0627\u0646\u0648\u0646\u064a** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "This topic requires legal expertise. Please switch to **Lawyer Advisor** mode."}.get(language, "Switch to Lawyer mode.")
            elif target_agent == "student": suffix = {"tr": "\u00d6\u011frenci prosed\u00fcrleri i\u00e7in l\u00fctfen yukar\u0131dan **\u00d6\u011frenci Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u0627\u0644\u0637\u0644\u0627\u0628\u064a\u0629\u060b \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0627\u0644\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u0637\u0644\u0627\u0628\u064a** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "For student procedures, please switch to **Student Advisor** mode."}.get(language, "Switch to Student mode.")
            else: suffix = {"tr": "\u0130\u015fletme ruhsat\u0131 i\u015flemleri i\u00e7in l\u00fctfen yukar\u0131dan **Ruhsat Dan\u0131\u015fman\u0131** moduna ge\u00e7in.", "ar": "\u0628\u0627\u0644\u0646\u0633\u0628\u0629 \u0644\u0625\u062c\u0631\u0627\u0621\u0627\u062a \u062a\u0631\u0627\u062e\u064a\u0636 \u0627\u0644\u0623\u0639\u0645\u0627\u0644\u060b \u064a\u0631\u062c\u0649 \u0627\u0644\u062a\u0628\u062f\u064a\u0644 \u0644\u0648\u0636\u0639 **\u0645\u0633\u062a\u0634\u0627\u0631 \u0627\u0644\u062a\u0631\u0627\u062e\u064a\u0636** \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649.", "en": "For business permit procedures, please switch to **Permit Advisor** mode."}.get(language, "Switch to Permit mode.")
            await wait_task
            return f"* ( {suffix} ) *", None, "Smart Router (Redirect Suffix)"

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
                    response_cache.set(query, rag_response, assistant_type, language)
                    if can_learn: learn_response(query, rag_response, assistant_type, language, intent_hint=sub_intent)
                    await wait_task
                    return rag_response, None, "Smart Router (RAG Knowledge)"
        except Exception: pass

    ai_response = await ai_fallback_response(query=query, assistant_type=assistant_type, gemini_model=gemini_model, student_model=student_model, lawyer_model=lawyer_model, rag_context=[], language=language)
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
