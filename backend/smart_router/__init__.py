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
from typing import Optional

from .keyword_router import detect_intent
from .template_engine import render, build_variables
from . import cache as response_cache
from .ai_fallback import ai_fallback_response

# ---------------------------------------------------------------------------
# Load response library once at module import time
# ---------------------------------------------------------------------------
_AGENTS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "agents")
_library: dict = {}

try:
    # Load each intent domain into the library dictionary
    with open(os.path.join(_AGENTS_DIR, "permit", "responses.json"), "r", encoding="utf-8") as f:
        _library["permit"] = json.load(f)
    with open(os.path.join(_AGENTS_DIR, "student", "responses.json"), "r", encoding="utf-8") as f:
        _library["student"] = json.load(f)
    with open(os.path.join(_AGENTS_DIR, "lawyer", "responses.json"), "r", encoding="utf-8") as f:
        _library["lawyer"] = json.load(f)
    
    # Load general conversational and support responses
    with open(os.path.join(_AGENTS_DIR, "general", "responses.json"), "r", encoding="utf-8") as f:
        general_data = json.load(f)
        for k, v in general_data.items():
            _library[k] = v
            
    print("[SmartRouter] Split response libraries loaded successfully.")
except Exception as e:
    print(f"[SmartRouter] WARNING: Failed to load split response libraries: {e}")


# ---------------------------------------------------------------------------
# Patterns that signal a NEW CONSULTATION — always route to orchestrator.
# These queries need the full structured dashboard, not a canned reply.
# ---------------------------------------------------------------------------
import re

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

# Patterns to catch an isolated answer to a clarifying question (matched against query alone)
_ISOLATED_ANSWER_PATTERNS = [
    r"^(a |an |my )?(cafe|kafe|restaurant|restoran|retail|office|ofis|pharmacy|eczane|bakery|f[\u0131i]r[\u0131i]n|barber|berber|gym|spor|shop|store|company|ma[\u011fg]aza|d[\u00fcu]kkan)$",
    r"^(in |at )?(adalar|arnavutkoy|arnavutköy|atasehir|ataşehir|avcilar|avcılar|bagcilar|bağcılar|bahcelievler|bahçelievler|bakirkoy|bakırköy|basaksehir|başakşehir|bayrampasa|bayrampaşa|besiktas|beşiktaş|beykoz|beylikduzu|beylikdüzü|beyoglu|beyoğlu|buyukcekmece|büyükçekmece|catalca|çatalca|cekmekoy|çekmeköy|esenler|esenyurt|eyup|eyüp|eyüpsultan|fatih|gaziosmanpasa|gaziosmanpaşa|gungoren|güngören|kadikoy|kadıköy|kagithane|kağıthane|kartal|kucukcekmece|küçükçekmece|maltepe|pendik|sancaktepe|sariyer|sarıyer|sile|şile|silivri|sisli|şişli|sultanbeyli|sultangazi|tuzla|umraniye|ümraniye|uskudar|üsküdar|zeytinburnu)$"
]

# NOTE: The following chip buttons are intentionally EXCLUDED from this gate because
# they are clarifying questions — the user hasn't told us their business type yet.
# They fall through to the keyword router and get a helpful clarifying response:
#   "What permit do you want?"
#   "What business do you want to open?"
#   "Where is your business located?"
#   "How long does it take?"
#   "How much does it cost?"
#   "What documents do I need?"
#   "How does it work?"
_NEW_CONSULTATION_RE = re.compile(
    "|".join(_NEW_CONSULTATION_PATTERNS), flags=re.IGNORECASE
)

_ISOLATED_ANSWER_RE = re.compile(
    "|".join(_ISOLATED_ANSWER_PATTERNS), flags=re.IGNORECASE
)

# ---------------------------------------------------------------------------
# Fuzzy matching for typos (e.g. "bacheveler" → "bahcelievler")
# Uses Python's built-in difflib — zero dependencies
# ---------------------------------------------------------------------------
from difflib import SequenceMatcher

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

def _fuzzy_match(word: str, candidates: list, threshold: float = 0.70) -> str | None:
    """Return the best candidate if similarity >= threshold, else None."""
    word = word.lower().strip()
    if len(word) < 3:
        return None
    best, best_score = None, 0.0
    for c in candidates:
        score = SequenceMatcher(None, word, c).ratio()
        if score > best_score:
            best, best_score = c, score
    return best if best_score >= threshold else None


# ---------------------------------------------------------------------------
# Internal: pick a random response from the library
# ---------------------------------------------------------------------------

def _pick_response(intent_group: Optional[str], sub_intent: Optional[str]) -> Optional[str]:
    """
    Navigate the library by (intent_group, sub_intent) and return a random entry.
    Returns None if no matching entry is found.
    """
    if not intent_group:
        return None

    # Top-level flat list (e.g. greeting, farewell, thanks)
    if intent_group in _library and isinstance(_library[intent_group], list):
        return random.choice(_library[intent_group])

    # Nested dict (e.g. permit.restaurant, student.renew_id)
    group_data = _library.get(intent_group)
    if isinstance(group_data, dict) and sub_intent:
        options = group_data.get(sub_intent)
        if options:
            return random.choice(options)

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
    """
    Try to handle the query without (or with minimal) AI usage.

    Returns:
        A ready-to-send response string, or None if this query needs
        the full orchestrator pipeline.
    """

    query = query.strip()

    # ------------------------------------------------------------------
    # 1. Cache check (0 tokens)
    # ------------------------------------------------------------------
    cached = response_cache.get(query, assistant_type, language)
    if cached:
        return cached

    # ------------------------------------------------------------------
    # 0.5. NEW CONSULTATION GUARD — offline dynamic dashboard (0 tokens)
    # If the query is an initial plan request, we bypass AI completely
    # and generate the 14-step permit dashboard directly in Python.
    # ------------------------------------------------------------------
    # Extract only the user text from the history to prevent the router from hallucinating 
    # keywords (like 'cafe' or 'retail') that the assistant itself might have suggested.
    user_blocks = re.findall(r"\[user\]:([\s\S]*?)(?=\[assistant\]:|\[user\]:|-{5,}|$)", history_text.lower())
    user_history_text = " ".join(b.strip() for b in user_blocks)
    
    # Include user history text so we can catch isolated answers like 'Cafe' or 'Kadikoy'
    combined_context = f"{user_history_text} {query}".lower()
    
    # If the AI just asked the user to clarify business type or district,
    # ONLY route back to the dashboard if the user's response actually contains a relevant keyword.
    # This prevents the bot from trapping the user if they change the topic (like "how are you").
    last_assistant_msg = history_text.lower().split("[assistant]:")[-1] if "[assistant]:" in history_text.lower() else ""
    is_clarifying = any(k in last_assistant_msg for k in [
        "what type of business", "hangi tür işletme", "ما هو نوع العمل",
        "which district", "hangi ilçesinde", "في أي منطقة"
    ])
    
    has_relevant_kw = any(w in query.lower() for w in [
        "cafe", "kafe", "restaurant", "restoran", "retail", "office", "ofis", "pharmacy", "eczane", "bakery", "fırın", "barber", "berber", "gym", "spor", "shop", "store", "company", "mağaza", "dükkan",
        "adalar", "arnavutkoy", "arnavutköy", "atasehir", "ataşehir", "avcilar", "avcılar", "bagcilar", "bağcılar", "bahcelievler", "bahçelievler", "bakirkoy", "bakırköy", "basaksehir", "başakşehir", "bayrampasa", "bayrampaşa", "besiktas", "beşiktaş", "beykoz", "beylikduzu", "beylikdüzü", "beyoglu", "beyoğlu", "buyukcekmece", "büyükçekmece", "catalca", "çatalca", "cekmekoy", "çekmeköy", "esenler", "esenyurt", "eyup", "eyüp", "eyüpsultan", "fatih", "gaziosmanpasa", "gaziosmanpaşa", "gungoren", "güngören", "kadikoy", "kadıköy", "kagithane", "kağıthane", "kartal", "kucukcekmece", "küçükçekmece", "maltepe", "pendik", "sancaktepe", "sariyer", "sarıyer", "sile", "şile", "silivri", "sisli", "şişli", "sultanbeyli", "sultangazi", "tuzla", "umraniye", "ümraniye", "uskudar", "üsküdar", "zeytinburnu"
    ])
    
    # Fuzzy fallback: if exact match failed, try fuzzy for each word in query
    fuzzy_district_match = None
    fuzzy_business_match = None
    if not has_relevant_kw:
        for word in query.lower().split():
            if not fuzzy_district_match:
                fuzzy_district_match = _fuzzy_match(word, _ALL_DISTRICTS)
            if not fuzzy_business_match:
                fuzzy_business_match = _fuzzy_match(word, _ALL_BUSINESS_TYPES)
        if fuzzy_district_match or fuzzy_business_match:
            has_relevant_kw = True
            print(f"[SmartRouter] Fuzzy match: district={fuzzy_district_match}, business={fuzzy_business_match}")
    
    if _NEW_CONSULTATION_RE.search(query) or _ISOLATED_ANSWER_RE.match(query) or (is_clarifying and has_relevant_kw):
        print(f"[SmartRouter] NEW CONSULTATION detected — generating dashboard offline (0 tokens) for {assistant_type}")
        
        from models.schemas import PermitState, CombinedPermitResult, ExecutionPlan, StepDetail, PermitPlan
        from utils.protocol import get_localized_steps
        from datetime import datetime

        dashboard_dump = None
        out_str = None
        
        if assistant_type == "permit":
            # ------------------------------------------------------------------
            # Detect ACTUAL business type from query keywords (not the intent sub-category)
            # ------------------------------------------------------------------
            _BUSINESS_KEYWORDS = [
                (["restaurant", "restoran", "lokanta", "dining", "dinner"], "Restaurant"),
                (["cafe", "kafe", "coffee shop", "kahve", "pastane", "tea house"], "Café"),
                (["bakery", "fırın", "firın", "bread", "pastry"], "Bakery"),
                (["pharmacy", "eczane", "chemist", "drugstore"], "Pharmacy"),
                (["barber", "berber", "hair salon", "kuaför", "kuafor", "beauty", "güzellik", "spa"], "Hair Salon / Beauty"),
                (["gym", "fitness", "spor salonu", "crossfit"], "Gym / Fitness Centre"),
                (["clothing", "giyim", "boutique", "apparel", "fashion"], "Clothing Store"),
                (["retail", "shop", "store", "mağaza", "dükkan", "grocery", "bakkal", "market"], "Retail Shop"),
                (["office", "ofis", "consulting", "danışmanlık", "agency", "büro"], "Office / Consultancy"),
                (["tech", "software", "yazılım", "startup"], "Tech / Software Company"),
                (["hotel", "hostel", "accommodation", "konaklama"], "Hotel / Accommodation"),
                (["clinic", "klinik", "medical", "dental", "doctor", "doktor", "diş"], "Medical Clinic"),
                (["school", "okul", "education", "dershane", "kurs"], "Educational Centre"),
            ]
            
            # Check current query first, then fall back to history
            # This ensures partial answers accumulate across turns
            business_type = "Business"  # fallback
            for kw_list, display_name in _BUSINESS_KEYWORDS:
                if any(kw in query.lower() for kw in kw_list):
                    business_type = display_name
                    break
            if business_type == "Business":
                for kw_list, display_name in _BUSINESS_KEYWORDS:
                    if any(kw in user_history_text for kw in kw_list):
                        business_type = display_name
                        break
            # Fuzzy fallback for business type (catches typos like "resturant")
            if business_type == "Business":
                fb = fuzzy_business_match
                if not fb:
                    for word in query.lower().split():
                        fb = _fuzzy_match(word, [kw for kw_list, _ in _BUSINESS_KEYWORDS for kw in kw_list])
                        if fb: break
                if fb:
                    for kw_list, display_name in _BUSINESS_KEYWORDS:
                        if fb in kw_list:
                            business_type = display_name
                            print(f"[SmartRouter] Fuzzy business type: '{fb}' → {display_name}")
                            break

            # ------------------------------------------------------------------
            # Detect district — with per-district municipality name + local note
            # ------------------------------------------------------------------
            _DISTRICT_INFO = {
                # (normalized_key): (display_name, municipality_EN, specific_note_EN)
                "adalar":     ("Adalar",      "Adalar Belediyesi",     "Permits in the Princes' Islands involve strict environmental and coastal regulations; expect longer processing times."),
                "arnavutkoy": ("Arnavutköy",  "Arnavutköy Belediyesi", "Arnavutköy is growing rapidly due to the new airport. Industrial and logistics permits are common here."),
                "arnavutköy": ("Arnavutköy",  "Arnavutköy Belediyesi", "Arnavutköy is growing rapidly due to the new airport. Industrial and logistics permits are common here."),
                "atasehir":   ("Ataşehir",    "Ataşehir Belediyesi",   "Ataşehir (Finans Merkezi area) is Istanbul's financial hub — corporate and office permits are fast-tracked here."),
                "ataşehir":   ("Ataşehir",    "Ataşehir Belediyesi",   "Ataşehir (Finans Merkezi area) is Istanbul's financial hub — corporate and office permits are fast-tracked here."),
                "avcilar":    ("Avcılar",     "Avcılar Belediyesi",    "Avcılar has many mixed-use residential/commercial zones. Permits are straightforward but check zoning first."),
                "avcılar":    ("Avcılar",     "Avcılar Belediyesi",    "Avcılar has many mixed-use residential/commercial zones. Permits are straightforward but check zoning first."),
                "bagcilar":   ("Bağcılar",    "Bağcılar Belediyesi",   "Bağcılar is a major commercial district. Wholesale and textile business permits are handled very efficiently."),
                "bağcılar":   ("Bağcılar",    "Bağcılar Belediyesi",   "Bağcılar is a major commercial district. Wholesale and textile business permits are handled very efficiently."),
                "bahcelievler":("Bahçelievler","Bahçelievler Belediyesi","Bahçelievler is densely populated; food and retail permits are common and processed within standard timeframes."),
                "bahçelievler":("Bahçelievler","Bahçelievler Belediyesi","Bahçelievler is densely populated; food and retail permits are common and processed within standard timeframes."),
                "bakirkoy":   ("Bakırköy",    "Bakırköy Belediyesi",   "Bakırköy is known for efficient permit processing and has a bilingual (TR/EN) helpdesk at the municipality."),
                "bakırköy":   ("Bakırköy",    "Bakırköy Belediyesi",   "Bakırköy is known for efficient permit processing and has a bilingual (TR/EN) helpdesk at the municipality."),
                "basaksehir": ("Başakşehir",  "Başakşehir Belediyesi", "Başakşehir has modern organized industrial zones (OSB) — manufacturing and corporate permits are highly streamlined."),
                "başakşehir": ("Başakşehir",  "Başakşehir Belediyesi", "Başakşehir has modern organized industrial zones (OSB) — manufacturing and corporate permits are highly streamlined."),
                "bayrampasa": ("Bayrampaşa",  "Bayrampaşa Belediyesi", "Bayrampaşa is a commercial hub for textile and wholesale — trade permits are a common request and well-understood by staff."),
                "bayrampaşa": ("Bayrampaşa",  "Bayrampaşa Belediyesi", "Bayrampaşa is a commercial hub for textile and wholesale — trade permits are a common request and well-understood by staff."),
                "besiktas":   ("Beşiktaş",    "Beşiktaş Belediyesi",   "Beşiktaş is strict on signage rules (reklam levhası izni). Budget extra time if you plan outdoor signage."),
                "beşiktaş":   ("Beşiktaş",    "Beşiktaş Belediyesi",   "Beşiktaş is strict on signage rules (reklam levhası izni). Budget extra time if you plan outdoor signage."),
                "beykoz":     ("Beykoz",      "Beykoz Belediyesi",     "Beykoz has significant protected green areas (Boğaziçi öngörünüm). Permits for new construction or exterior changes face strict scrutiny."),
                "beylikduzu": ("Beylikdüzü",  "Beylikdüzü Belediyesi", "Beylikdüzü is a modern district with organized commercial spaces. Retail and office permits are generally fast here."),
                "beylikdüzü": ("Beylikdüzü",  "Beylikdüzü Belediyesi", "Beylikdüzü is a modern district with organized commercial spaces. Retail and office permits are generally fast here."),
                "beyoglu":    ("Beyoğlu",     "Beyoğlu Belediyesi",    "Beyoğlu (İstiklal area) has strict entertainment and alcohol licence rules — TAPDK licences here require additional zoning approval."),
                "beyoğlu":    ("Beyoğlu",     "Beyoğlu Belediyesi",    "Beyoğlu (İstiklal area) has strict entertainment and alcohol licence rules — TAPDK licences here require additional zoning approval."),
                "buyukcekmece":("Büyükçekmece","Büyükçekmece Belediyesi","Büyükçekmece has many coastal and villa zones. Summer-season businesses should apply well in advance."),
                "büyükçekmece":("Büyükçekmece","Büyükçekmece Belediyesi","Büyükçekmece has many coastal and villa zones. Summer-season businesses should apply well in advance."),
                "catalca":    ("Çatalca",     "Çatalca Belediyesi",    "Çatalca is largely rural; agricultural and large-scale industrial facility permits are the norm here."),
                "çatalca":    ("Çatalca",     "Çatalca Belediyesi",    "Çatalca is largely rural; agricultural and large-scale industrial facility permits are the norm here."),
                "cekmekoy":   ("Çekmeköy",    "Çekmeköy Belediyesi",   "Çekmeköy is a rapidly growing residential area. Retail and service business permits are processed efficiently."),
                "çekmeköy":   ("Çekmeköy",    "Çekmeköy Belediyesi",   "Çekmeköy is a rapidly growing residential area. Retail and service business permits are processed efficiently."),
                "esenler":    ("Esenler",     "Esenler Belediyesi",    "Esenler is a high-traffic commercial hub, especially for transport and retail. Permit processes are well-established."),
                "esenyurt":   ("Esenyurt",    "Esenyurt Belediyesi",   "Esenyurt is a high-density mixed district — food business permits take longer due to high inspection demand."),
                "eyup":       ("Eyüpsultan",  "Eyüpsultan Belediyesi", "Eyüpsultan has heritage zone restrictions near the mosque area — signage and façade changes need additional cultural heritage approval."),
                "eyüp":       ("Eyüpsultan",  "Eyüpsultan Belediyesi", "Eyüpsultan has heritage zone restrictions near the mosque area — signage and façade changes need additional cultural heritage approval."),
                "eyüpsultan": ("Eyüpsultan",  "Eyüpsultan Belediyesi", "Eyüpsultan has heritage zone restrictions near the mosque area — signage and façade changes need additional cultural heritage approval."),
                "fatih":      ("Fatih",       "Fatih Belediyesi",      "Fatih has conservation area restrictions (sit alanı) in parts of the district — check zoning before signing a lease."),
                "gaziosmanpasa": ("Gaziosmanpaşa", "Gaziosmanpaşa Belediyesi", "Gaziosmanpaşa has a large commercial market district — retail permits are common and the process is well-known to local officers."),
                "gaziosmanpaşa": ("Gaziosmanpaşa", "Gaziosmanpaşa Belediyesi", "Gaziosmanpaşa has a large commercial market district — retail permits are common and the process is well-known to local officers."),
                "gungoren":   ("Güngören",    "Güngören Belediyesi",   "Güngören is known for textiles and wholesale. The municipality is highly experienced with manufacturing and trade permits."),
                "güngören":   ("Güngören",    "Güngören Belediyesi",   "Güngören is known for textiles and wholesale. The municipality is highly experienced with manufacturing and trade permits."),
                "kadikoy":    ("Kadıköy",     "Kadıköy Belediyesi",    "Kadıköy processes most permits within 10–15 business days and has a dedicated foreign investor desk (Yabancı Yatırımcı Hattı)."),
                "kadıköy":    ("Kadıköy",     "Kadıköy Belediyesi",    "Kadıköy processes most permits within 10–15 business days and has a dedicated foreign investor desk (Yabancı Yatırımcı Hattı)."),
                "kagithane":  ("Kağıthane",   "Kağıthane Belediyesi",  "Kağıthane is emerging as a tech and startup hub — the municipality offers some reduced fees for tech companies."),
                "kağıthane":  ("Kağıthane",   "Kağıthane Belediyesi",  "Kağıthane is emerging as a tech and startup hub — the municipality offers some reduced fees for tech companies."),
                "kartal":     ("Kartal",      "Kartal Belediyesi",     "Kartal is a major hub on the Asian side. Complex commercial and legal office permits are handled smoothly."),
                "kucukcekmece": ("Küçükçekmece", "Küçükçekmece Belediyesi", "Küçükçekmece has a mix of industrial and residential zones. Make sure your specific street is zoned for your business type."),
                "küçükçekmece": ("Küçükçekmece", "Küçükçekmece Belediyesi", "Küçükçekmece has a mix of industrial and residential zones. Make sure your specific street is zoned for your business type."),
                "maltepe":    ("Maltepe",     "Maltepe Belediyesi",    "Maltepe is a growing residential-commercial district with straightforward permit processing — good for retail and service businesses."),
                "pendik":     ("Pendik",      "Pendik Belediyesi",     "Pendik includes Sabiha Gökçen Airport zone — logistics and trade businesses have good infrastructure support here."),
                "sancaktepe": ("Sancaktepe",  "Sancaktepe Belediyesi", "Sancaktepe is an emerging commercial area on the Asian side. Permit fees and processing times are generally very favorable."),
                "sariyer":    ("Sarıyer",     "Sarıyer Belediyesi",    "Sarıyer includes the Maslak business district — office and corporate permits are well-streamlined there."),
                "sarıyer":    ("Sarıyer",     "Sarıyer Belediyesi",    "Sarıyer includes the Maslak business district — office and corporate permits are well-streamlined there."),
                "sile":       ("Şile",        "Şile Belediyesi",       "Şile is a tourism and coastal district. If opening a hospitality business, seasonal permit rules and environmental checks apply."),
                "şile":       ("Şile",        "Şile Belediyesi",       "Şile is a tourism and coastal district. If opening a hospitality business, seasonal permit rules and environmental checks apply."),
                "silivri":    ("Silivri",     "Silivri Belediyesi",    "Silivri requires careful zoning checks for agricultural vs. commercial land use before applying for operating permits."),
                "sisli":      ("Şişli",       "Şişli Belediyesi",      "Şişli has a fast-track window for retail and office permits — ask for the 'hızlı işlem' counter when you visit."),
                "şişli":      ("Şişli",       "Şişli Belediyesi",      "Şişli has a fast-track window for retail and office permits — ask for the 'hızlı işlem' counter when you visit."),
                "sultanbeyli": ("Sultanbeyli", "Sultanbeyli Belediyesi", "Sultanbeyli is a growing district on the Asian side with competitive commercial rents and reasonable permit processing times."),
                "sultangazi": ("Sultangazi",  "Sultangazi Belediyesi", "Sultangazi is an active manufacturing district. Workshop and factory permits are well-supported by the local municipality."),
                "tuzla":      ("Tuzla",       "Tuzla Belediyesi",      "Tuzla is an industrial and maritime zone — manufacturing and workshop permits are actively supported by the municipality."),
                "umraniye":   ("Ümraniye",    "Ümraniye Belediyesi",   "Ümraniye is a busy commercial district — permit queues can be longer, so apply early and use the e-Devlet portal where possible."),
                "ümraniye":   ("Ümraniye",    "Ümraniye Belediyesi",   "Ümraniye is a busy commercial district — permit queues can be longer, so apply early and use the e-Devlet portal where possible."),
                "uskudar":    ("Üsküdar",     "Üsküdar Belediyesi",    "Üsküdar enforces strict noise regulations — music businesses may face additional restrictions near residential zones."),
                "üsküdar":    ("Üsküdar",     "Üsküdar Belediyesi",    "Üsküdar enforces strict noise regulations — music businesses may face additional restrictions near residential zones."),
                "zeytinburnu": ("Zeytinburnu", "Zeytinburnu Belediyesi", "Zeytinburnu is a manufacturing and textile hub — textile & workshop permits are well-supported here."),
            }

            district_en = "Istanbul"
            district_display = None
            mun_name_en = "Your District Municipality"
            district_note = ""

            # Check current query first for district
            for key, (dname, mun_en, note) in _DISTRICT_INFO.items():
                if key in query.lower():
                    district_en = dname
                    district_display = dname
                    mun_name_en = mun_en
                    district_note = note
                    break
            # If not found in query, check user history
            if district_display is None:
                for key, (dname, mun_en, note) in _DISTRICT_INFO.items():
                    if key in user_history_text:
                        district_en = dname
                        district_display = dname
                        mun_name_en = mun_en
                        district_note = note
                        break
            # Fuzzy fallback for district (catches typos like "bacheveler" → "bahcelievler")
            if district_display is None:
                fd = fuzzy_district_match
                if not fd:
                    for word in query.lower().split():
                        fd = _fuzzy_match(word, list(_DISTRICT_INFO.keys()))
                        if fd: break
                if not fd:
                    for word in user_history_text.split():
                        fd = _fuzzy_match(word, list(_DISTRICT_INFO.keys()))
                        if fd: break
                if fd and fd in _DISTRICT_INFO:
                    dname, mun_en, note = _DISTRICT_INFO[fd]
                    district_en = dname
                    district_display = dname
                    mun_name_en = mun_en
                    district_note = note
                    print(f"[SmartRouter] Fuzzy district: '{fd}' → {dname}")

            no_district = district_display is None
            
            # --- OVERRIDE: IF EITHER DISTRICT OR BUSINESS TYPE IS MISSING, ASK AND HALT ---
            missing_items = []
            if business_type == "Business": missing_items.append("business")
            if no_district: missing_items.append("district")

            if missing_items:
                if language == "tr":
                    msg = "Sana tam ve doğru bir yol haritası çizebilmem için lütfen şunları belirt: "
                    if "business" in missing_items: msg += "**Hangi tür işletme** (Kafe, Mağaza vb.) açacaksın? "
                    if "district" in missing_items: msg += "**İstanbul'un hangi ilçesinde** açacaksın?"
                elif language == "ar":
                    msg = "لكي أرسم لك خريطة طريق دقيقة، يرجى تحديد: "
                    if "business" in missing_items: msg += "**ما هو نوع العمل** (مقهى، متجر)؟ "
                    if "district" in missing_items: msg += "**في أي منطقة في إسطنبول** ستفتح؟"
                else:
                    msg = "To map out your exact roadmap, could you please tell me: "
                    if "business" in missing_items: msg += "**What type of business** (e.g., Cafe, Retail)? "
                    if "district" in missing_items: msg += "**Which district of Istanbul** are you opening in?"
                    
                # Returning ONLY the string halts the dashboard generation and asks the question as normal chat
                return msg

            district = district_display or "Istanbul"

            # Localized Municipality Name
            mun_name = mun_name_en
            if language == "tr":
                mun_name = f"{district} Belediyesi"
            elif language == "ar":
                mun_name = f"بلدية {district}"

            if language == "tr":
                permits = [f"{district} İşyeri Açma ve Çalışma Ruhsatı"]
                agencies = [mun_name, "Vergi Dairesi"]
                docs = ["Kimlik", "Kira Sözleşmesi", "Vergi Levhası", "NACE Kodu Belgesi"]
                summ = f"Mükemmel seçim! {district}'de {business_type} açmak için bilmeniz gereken her şeyi hazırladım. 🎉 Önemli not: {district_note} Aşağıdaki yol haritasını takip edin ve merak ettiğinizi sorun!"
                labels = {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Adımlar", "tm": "Tahmini Süre", "dy": "gün"}
            elif language == "ar":
                permits = [f"رخصة فتح وتشغيل من {district}"]
                agencies = [mun_name, "مكتب الضرائب"]
                docs = ["الهوية", "عقد الإيجار", "اللوحة الضريبية", "وثيقة رمز NACE"]
                summ = f"اختيار رائع! أعددت لك كل ما تحتاجه لفتح {business_type} في {district}. 🎉 ملاحظة مهمة: {district_note} راجع الخطوات أدناه واسألني عن أي شيء!"
                labels = {"ag": "المؤسسات", "dc": "المستندات المطلوبة", "st": "الخطوات", "tm": "المدة الزمنية المتوقعة", "dy": "يوم"}
            else:
                permits = [f"{district} Workplace Operating License"]
                agencies = [mun_name, "Tax Office (Vergi Dairesi)"]
                docs = ["ID / Passport", "Lease Agreement", "Tax Plate", "NACE Code Certificate"]
                summ = (
                    f"Great choice — I've put together your complete roadmap for opening a {business_type} in {district}! 🚀 "
                    f"📍 **{district} note:** {district_note} "
                    f"Follow the steps below and feel free to ask me anything along the way."
                )
                labels = {"ag": "Institutions / Agencies", "dc": "Documents You'll Need", "st": "Your Action Steps", "tm": "Estimated Timeline", "dy": "days"}

            timeline = 30
            _food_context = query.lower() + " " + user_history_text
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
            is_renew = "renew" in query.lower() or "replace" in query.lower()
            business_type = "student_renew" if is_renew else "Student"
            district = "Istanbul"
            timeline = 10 if is_renew else 30
            
            if language == "tr":
                permits = ["Öğrenci İkamet İzni Uzatması"] if is_renew else ["Öğrenci Kaydı", "Öğrenci İkamet İzni"]
                agencies = ["Göç İdaresi", "Noter", "Sigorta Şirketi"] if is_renew else ["Öğrenci İşleri", "Göç İdaresi", "SGK"]
                docs = ["Sağlık Sigortası", "Noter Onaylı Kira Sözleşmesi", "Öğrenci Belgesi", "Biyometrik Fotoğraf"] if is_renew else ["Pasaport", "Kabul Mektubu", "Sağlık Sigortası"]
                summ = "Sorun değil, hemen organize edelim! 🎓 İkamet yenileme süreci birkaç adımdan oluşuyor — sigortanı yenilemekten Göç İdaresi randevuna kadar her şeyi aşağıda hazırladım. Sigorta ve adres belgenden başlamanı tavsiye ederim, çünkü bunlar en uzun süren adımlar. Herhangi bir adım için yardım istersen buradayım!" if is_renew else "Türkiye'de öğrenci olmak heyecan verici — tebrikler! 🎓 Üniversite kaydından öğrenci kimliğine (Kimlik) kadar tüm sürecini adım adım hazırladım. En önemli ipucu: sağlık sigortanı ve adres belgenini erkenden ayarla, çünkü bunlar diğer her şeyin temeli. Aşağıdaki yol haritana bak ve bir adımda takılırsan bana sor!"
                labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımların", "tm":"Tahmini Süre", "dy":"gün"}
            elif language == "ar":
                permits = ["تمديد إقامة الطالب"] if is_renew else ["تسجيل الجامعة", "إقامة الطالب"]
                agencies = ["إدارة الهجرة", "العدل (النوتر)", "شركة التأمين"] if is_renew else ["شؤون الطلاب", "إدارة الهجرة", "SGK"]
                docs = ["التأمين الصحي", "عقد إيجار موثق", "شهادة طالب", "صور شخصية"] if is_renew else ["جواز السفر", "خطاب القبول", "التأمين الصحي"]
                summ = "لا تقلق، سنرتب كل شيء معاً! 🎓 عملية تجديد الإقامة تتكون من عدة خطوات — من تجديد التأمين وصولاً إلى موعد إدارة الهجرة. ابدأ بالتأمين وعقد السكن لأنهما يستغرقان أطول وقت. خريطة طريقك الكاملة في الأسفل — اسألني عن أي خطوة!" if is_renew else "تهانينا على قبولك في الجامعة! 🎓 لقد أعددت لك خريطة طريق شاملة من التسجيل الجامعي وصولاً إلى هوية الطالب (Kimlik). أهم نصيحة: رتّب التأمين الصحي وإثبات السكن مبكراً — هما أساس كل خطوة أخرى. راجع الخطوات أدناه واسألني متى شئت!"
                labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطواتك", "tm":"المدة المتوقعة", "dy":"يوم"}
            else:
                permits = ["Student Residence Permit Extension"] if is_renew else ["University Registration", "Student Residence Permit"]
                agencies = ["Migration Office (Göç İdaresi)", "Notary Public", "Insurance Provider"] if is_renew else ["Student Affairs", "Migration Directorate (Göç İdaresi)", "SGK"]
                docs = ["Health Insurance Policy", "Notarized Lease Agreement", "Student Certificate", "Biometric Photos"] if is_renew else ["Passport", "Acceptance Letter", "Health Insurance"]
                summ = "No stress — let's sort this out together! 🎓 Renewing your student residency (Kimlik) involves a few key steps, and I've mapped them all out for you below. My top tip: start with your health insurance and address document, since those take the most time to arrange. Ask me anything along the way!" if is_renew else "Welcome to Turkey — exciting times ahead! 🎓 I've put together your complete roadmap from university registration all the way to your Student Residence Permit (Kimlik). Pro tip: sort your health insurance and proof of address early — they're the foundation for everything else. Check the steps below and ask me if anything's unclear!"
                labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Your Action Steps", "tm":"Estimated Timeline", "dy":"days"}

        elif assistant_type == "lawyer":
            # Detect specific legal topic from the user's query
            lower_q = query.lower()
            
            # Determine lawyer sub-type
            if any(k in lower_q for k in ["contract", "sözleşme", "nda", "agreement", "clause", "review my", "check my", "service agreement", "lease agreement"]):
                lawyer_subtype = "lawyer_contract"
            elif any(k in lower_q for k in ["company", "form a company", "formation", "incorporate", "ltd", "a.ş", "mersis", "şirket kur", "register a company", "start a company", "business registration"]):
                lawyer_subtype = "lawyer_company"
            elif any(k in lower_q for k in ["fired", "dismissed", "termination", "severance", "labour", "labor", "employment", "işten çıkar", "kıdem", "unfair dismissal", "notice period", "job rights"]):
                lawyer_subtype = "lawyer_employment"
            elif any(k in lower_q for k in ["work permit", "work visa", "residence permit", "ikamet", "stay in turkey", "work legally", "çalışma izni", "legal to work"]):
                lawyer_subtype = "lawyer_residency"
            elif any(k in lower_q for k in ["dispute", "lawsuit", "sue", "court", "mediation", "arabuluculuk", "arbitration", "claim against", "ihtarname", "legal action"]):
                lawyer_subtype = "lawyer_dispute"
            elif any(k in lower_q for k in ["buy", "sell", "rent", "house", "property", "apartment", "real estate", "tapu", "evict", "kira", "tenant", "landlord"]):
                lawyer_subtype = "lawyer_real_estate"
            elif any(k in lower_q for k in ["police", "arrest", "criminal", "charge", "jail", "prison", "detained", "suç", "drug", "drugs", "narcotic", "narcotics", "weed", "cocaine", "hashish", "theft", "robbery", "fraud", "assault", "violence", "caught with"]):
                lawyer_subtype = "lawyer_criminal"
            elif any(k in lower_q for k in ["debt", "unpaid", "invoice", "icra", "haciz", "collection", "alacak"]):
                lawyer_subtype = "lawyer_debt"
            else:
                lawyer_subtype = "lawyer_contract"  # default

            district = "Turkey"
            
            if lawyer_subtype == "lawyer_contract":
                timeline = 14
                if language == "tr":
                    permits = ["Sözleşme İncelemesi", "Hukuki İzleme"]
                    agencies = ["Avukat/Hukuk Bürosu", "Noter", "Türkiye Barolar Birliği"]
                    docs = ["İmzalı Sözleşme", "Ekler ve Değişiklikler", "İlgili E-posta Yazışmaları", "Kimlik Belgesi"]
                    summ = "İmzalamadan önce durmanız çok doğru bir karar! ⚖️ Türk Borçlar Kanunu kapsamındaki riskli maddeler, ceza klozonları ve fesih koşulları gibi kritik noktaları sizin için inceliyorum. Hangi madde veya konu sizi endişelendirdi — buradan başlayalım?"
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["مراجعة العقد", "الإجراء القانوني"]
                    agencies = ["محامٍ / مكتب قانوني", "كاتب العدل", "نقابة المحامين التركية"]
                    docs = ["العقد الموقّع", "الملاحق والتعديلات", "المراسلات الإلكترونية ذات الصلة", "وثيقة هوية"]
                    summ = "قرار صائب أن توقف قبل التوقيع! ⚖️ سأراجع العقد بعناية بموجب قانون الالتزامات التركي، مع التركيز على البنود الخطرة وشروط الغرامات وحالات الفسخ. أخبرني أي بند أو موضوع يقلقك — من هناك نبدأ!"
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Contract Review", "Legal Advisory"]
                    agencies = ["Lawyer / Law Firm", "Notary Public", "Turkish Bar Association"]
                    docs = ["Signed Contract", "Addendums & Amendments", "Relevant Email Correspondence", "Valid ID Document"]
                    summ = "Smart move to pause before signing! ⚖️ I'll walk you through the key risk areas under Turkish law — penalty clauses, one-sided termination terms, and anything legally unenforceable. Tell me which clause or section is worrying you and we'll dig into that first. The full review process is mapped out below."
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_company":
                timeline = 10
                if language == "tr":
                    permits = ["Ltd. Şirket Tescili", "Vergi Kaydı", "Ticaret Sicili Tescili"]
                    agencies = ["Ticaret Sicili Müdürlüğü", "Vergi Dairesi", "MERSİS Portalı", "Noter"]
                    docs = ["Pasaport / Kimlik (Tüm Ortaklar)", "Ana Sözleşme Taslağı", "Kira Sözleşmesi / Ofis Adresi", "Sermaye Deposu Makbuzu (Gerekirse)"]
                    summ = "Harika bir karar — Türkiye'de şirket kurmak düşündüğünüzden çok daha kolay! 🏢 MERSİS'te şirket adınızı rezerve etmekten Ticaret Sicili kaydına kadar her adımı sizin için hazırladım. Belgelerinizi hazır tutun ve aklınıza takılan her şeyi bana sorabilirsiniz!"
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تسجيل شركة ذات مسؤولية محدودة", "التسجيل الضريبي", "تسجيل السجل التجاري"]
                    agencies = ["مديرية السجل التجاري", "مكتب الضرائب", "بوابة MERSİS", "كاتب العدل"]
                    docs = ["جواز السفر / الهوية (جميع المساهمين)", "مسودة النظام الأساسي", "عقد الإيجار / عنوان المكتب", "إيصال إيداع رأس المال (إذا لزم)"]
                    summ = "قرار رائع — تأسيس شركة في تركيا أسهل مما تتوقع! 🏢 لقد أعددت لك كل خطوة من حجز اسم الشركة في MERSİS إلى التسجيل في السجل التجاري. احتفظ بمستنداتك جاهزة واسألني عن أي شيء في أي وقت!"
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Ltd. Şirket Registration", "Tax Registration", "Trade Registry Entry"]
                    agencies = ["Trade Registry Directorate", "Tax Office (Vergi Dairesi)", "MERSİS Portal", "Notary Public (Noter)"]
                    docs = ["Passport / ID (All Shareholders)", "Articles of Association Draft", "Office Lease or Address Proof", "Capital Deposit Receipt (if applicable)"]
                    summ = "Great decision — forming a company in Turkey is more straightforward than most people expect! 🏢 I've mapped out each step from reserving your company name in MERSİS all the way to completing the Trade Registry and tax registrations. Keep your documents handy and ask me anything as you go through it!"
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_employment":
                timeline = 21
                if language == "tr":
                    permits = ["İş Mahkemesi Başvurusu", "Zorunlu Arabuluculuk"]
                    agencies = ["İş Mahkemesi", "Arabuluculuk Merkezi", "SGK", "Türkiye İş Kurumu (İŞKUR)"]
                    docs = ["İmzalı İş Sözleşmesi", "Tüm Bordro Belgeleri", "Yazılı Fesih Bildirimi", "İşverenden Gelen Her Türlü Yazışma", "Fazla Mesai / Mesai Kanıtı"]
                    summ = "Bu durum kulağa gerçekten stresli geliyor — ama haklarınızı bilmek çok güçlü bir başlangıç. ⚖️ Türk İş Kanunu genellikle çalışan lehinedir; kıdem tazminatı, ihbar süresi ve arabuluculuk gibi haklarınızı adım adım inceliyoruz. İlk adım olarak elinizde hangi belgeler var — bilelim!"
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["دعوى محكمة العمل", "الوساطة الإجبارية"]
                    agencies = ["محكمة العمل", "مركز الوساطة", "SGK", "إدارة التوظيف التركية (İŞKUR)"]
                    docs = ["عقد العمل الموقّع", "جميع كشوف الرواتب", "إشعار الفسخ الخطي", "أي مراسلات من صاحب العمل", "دليل العمل الإضافي"]
                    summ = "أفهم أن هذا الوضع مرهق — لكن معرفة حقوقك هي خطوة قوية جداً. ⚖️ قانون العمل التركي يميل عموماً لصالح الموظف، وسأرشدك خطوة بخطوة لمطالبتك بالتعويض والوساطة وصولاً للمحكمة إذا لزم. أخبرني: ما المستندات التي لديك الآن؟"
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Labour Court Claim", "Mandatory Mediation (Arabuluculuk)"]
                    agencies = ["Labour Court (İş Mahkemesi)", "Mediation Centre", "SGK (Social Security)", "Turkish Employment Agency (İŞKUR)"]
                    docs = ["Signed Employment Contract", "All Payslips / Salary Records", "Written Termination Notice", "Any Employer Correspondence", "Overtime / Hours Worked Proof"]
                    summ = "I understand this situation is stressful — but knowing your rights is a really powerful first step. ⚖️ Turkish labour law generally favours employees, and I've mapped out your full path from calculating your entitlements through mandatory mediation and, if needed, the Labour Court. Tell me: what documents do you have on hand right now?"
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_residency":
                timeline = 35
                if language == "tr":
                    permits = ["Çalışma İzni", "İkamet İzni (Kimlik)"]
                    agencies = ["Göç İdaresi Genel Müdürlüğü", "Aile ve Çalışma Bakanlığı", "Sigorta Sağlayıcısı", "e-İkamet Portalı"]
                    docs = ["Geçerli Pasaport (6+ ay)", "Biyometrik Fotoğraflar (4 adet)", "Yabancı Sağlık Sigortası", "Noter Onaylı Kira Sözleşmesi", "İş Sözleşmesi (Çalışma İzni için)", "Başvuru Ücreti Makbuzu"]
                    summ = "Türkiye'de yasal olarak kalmak veya çalışmak istiyorsunuz — doğru yerdesiniz! 🇹🇷 İşe yarar bir ipucu: e-İkamet randevularını büyük şehirlerde erken almak gerekiyor, çabuk doluyor. Her adımı net bir şekilde aşağıya hazırladım. İzin türünüzden emin değilseniz, hemen sorun!"
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تصريح العمل", "إذن الإقامة (Kimlik)"]
                    agencies = ["الإدارة العامة للهجرة", "وزارة العمل والشؤون الاجتماعية", "شركة التأمين الصحي", "بوابة e-İkamet"]
                    docs = ["جواز سفر ساري (6+ أشهر)", "صور بيومترية (4 صور)", "تأمين صحي للأجانب", "عقد إيجار موثّق لدى كاتب العدل", "عقد العمل (لتصريح العمل)", "إيصال رسوم الطلب"]
                    summ = "تريد الإقامة أو العمل بشكل قانوني في تركيا — أنت في المكان الصحيح! 🇹🇷 نصيحة مفيدة: مواعيد e-İkamet في المدن الكبرى تمتلئ بسرعة، فاحجز موعدك فور تجهيز مستنداتك. كل خطوة موضّحة أدناه — اسألني في أي وقت!"
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Work Permit (Çalışma İzni)", "Residence Permit / Kimlik (İkamet)"]
                    agencies = ["Directorate General of Migration (Göç İdaresi)", "Ministry of Labour & Social Security", "Health Insurance Provider", "e-İkamet Portal"]
                    docs = ["Valid Passport (6+ months remaining)", "Biometric Photos (4 copies)", "Foreign Health Insurance Policy", "Notarized Rental Contract", "Employment Contract (for Work Permit)", "Application Fee Receipt"]
                    summ = "You're in the right place to get this sorted! 🇹🇷 One important heads-up: e-İkamet appointment slots in major cities fill up fast, so book yours as soon as your documents are ready. I've laid out every step clearly below — and if you're not sure which permit type applies to your situation, just ask!"
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_real_estate":
                timeline = 45
                if language == "tr":
                    permits = ["Tapu Devri / Alım-Satım", "Kira Sözleşmesi"]
                    agencies = ["Tapu ve Kadastro", "Noter", "Belediye", "Vergi Dairesi"]
                    docs = ["Pasaport ve Vergi No", "DASK (Deprem Sigortası)", "Gayrimenkul Değerleme Raporu", "Döviz Alım Belgesi"]
                    summ = "Türkiye'de gayrimenkul alımı veya kiralama işlemleri oldukça sistemlidir. 🏢 Tapu devrinden yabancılar için zorunlu olan değerleme raporuna kadar tüm süreci sizin için hazırladım."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["نقل ملكية الطابو", "عقد الإيجار"]
                    agencies = ["مديرية الطابو والمسح العقاري", "كاتب العدل (النوتر)", "البلدية", "مكتب الضرائب"]
                    docs = ["جواز سفر ورقم ضريبي", "تأمين الزلازل (DASK)", "تقرير التقييم العقاري", "وثيقة شراء العملات الأجنبية"]
                    summ = "شراء أو استئجار العقارات في تركيا منظم جداً. 🏢 لقد قمت بإعداد العملية بأكملها من نقل ملكية الطابو إلى تقرير التقييم الإلزامي للأجانب."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Tapu (Title Deed) Transfer", "Lease Agreement"]
                    agencies = ["Land Registry (Tapu Office)", "Notary Public", "Municipality", "Tax Office"]
                    docs = ["Passport & Tax Number", "DASK (Earthquake Insurance)", "Real Estate Appraisal Report", "Foreign Exchange Document"]
                    summ = "Buying or renting property in Turkey is a structured process. 🏢 I've mapped out everything from the Tapu transfer to the mandatory appraisal report for foreigners."
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_criminal":
                timeline = 180
                if language == "tr":
                    permits = ["Ceza Soruşturması / Savunma"]
                    agencies = ["Emniyet Müdürlüğü / Karakol", "Cumhuriyet Savcılığı", "Ağır/Asliye Ceza Mahkemeleri"]
                    docs = ["İfade Tutanağı", "Suç Duyurusu/Şikayet Dilekçesi", "Kimlik Belgesi", "Tüm Delil ve WhatsApp Kayıtları"]
                    summ = "Ceza davaları hızlı hareket etmeyi gerektirir. ⚖️ Susma hakkınız ve bir avukatla temsil edilme hakkınız her zaman vardır. Sürecin nasıl işlediği aşağıda özetlenmiştir."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تحقيق جنائي / دفاع"]
                    agencies = ["مديرية الأمن / مركز الشرطة", "النيابة العامة", "المحاكم الجنائية"]
                    docs = ["محضر الإفادة", "عريضة شكوى جنائية", "وثيقة الهوية", "جميع الأدلة أو المراسلات"]
                    summ = "تتطلب القضايا الجنائية إجراءات سريعة. ⚖️ لديك دائماً الحق في التزام الصمت وتوكيل محام. لقد قمت بتلخيص سير العملية أدناه."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Criminal Investigation / Defense"]
                    agencies = ["Police Station (Karakol)", "Public Prosecutor's Office", "Criminal Courts"]
                    docs = ["Statement Records", "Criminal Complaint Petition", "ID Document", "All Evidence / WhatsApp Records"]
                    summ = "Criminal cases require moving fast. ⚖️ You always have the right to remain silent and to be represented by a lawyer. I've outlined how the process works below."
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_debt":
                timeline = 30
                if language == "tr":
                    permits = ["İcra Takibi (Borç Tahsilatı)"]
                    agencies = ["İcra Müdürlüğü", "İcra Mahkemeleri", "Noter"]
                    docs = ["Fatura / Sözleşme / Senet", "Noter İhtarnamesi", "Banka / Ödeme Kayıtları"]
                    summ = "Tahsil edilemeyen alacaklar için İcra Takibi oldukça etkilidir. 💰 Mahkemeye gitmeden de başlatılabilir; 7 gün içinde itiraz edilmezse hesaplara haciz konulabilir."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تحصيل الديون (الإجراءات التنفيذية)"]
                    agencies = ["دائرة التنفيذ", "محاكم التنفيذ", "كاتب العدل"]
                    docs = ["فواتير / عقود / كمبيالة", "إخطار من كاتب العدل", "سجلات مصرفية"]
                    summ = "بالنسبة للديون غير المحصلة، فإن إجراءات التنفيذ (İcra) فعالة جداً. 💰 يمكن البدء بها دون الحاجة لمحكمة؛ وإذا لم يكن هناك اعتراض خلال 7 أيام، يمكن تجميد الحسابات."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Debt Collection (Enforcement/Icra)"]
                    agencies = ["Enforcement Office (İcra Dairesi)", "Enforcement Courts", "Notary Public"]
                    docs = ["Unpaid Invoices / Promissory Notes", "Notarized Warning Letter", "Bank Records"]
                    summ = "For uncollected debts, Enforcement Proceedings (İcra) are highly effective in Turkey. 💰 This can be started without a court case. If there's no objection within 7 days, accounts can be frozen."
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
                    
            else:  # lawyer_dispute (default for general legal disputes)
                timeline = 25
                lawyer_subtype = "lawyer_dispute"
                if language == "tr":
                    permits = ["Hukuki İhtilaf Çözümü", "Arabuluculuk / Dava"]
                    agencies = ["Arabuluculuk Merkezi", "Ticaret Mahkemesi / Asliye Hukuk", "İcra Müdürlüğü", "Noter"]
                    docs = ["İlgili Tüm Sözleşmeler / Belgeler", "Fatura ve Ödeme Kayıtları", "E-posta / Yazışma Kayıtları", "Tanık Bilgileri (Varsa)", "Kimlik Belgesi"]
                    summ = "Bu kesinlikle stresli bir durum olabilir — ama doğru adımı atmak durumu kontrol altına almanızı sağlar. ⚖️ Türk hukukunda anlaşmazlıkların büyük çoğunluğu zorunlu arabuluculukta, mahkemeye gitmeden çözülüyor. Size en verimli yolu çiziyorum — ihtarnameden arabuluculuğa, gerekirse mahkemeye kadar. Şu an elinizde hangi belgeler var?"
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Sürecin Adımları", "tm":"Tahmini Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["حل النزاع القانوني", "الوساطة / التقاضي"]
                    agencies = ["مركز الوساطة", "المحكمة التجارية / المدنية", "مديرية التنفيذ", "كاتب العدل"]
                    docs = ["جميع العقود / المستندات ذات الصلة", "الفواتير وسجلات الدفع", "سجلات البريد الإلكتروني / المراسلات", "معلومات الشهود (إن وجدوا)", "وثيقة هوية"]
                    summ = "قد يكون هذا الوضع مرهقاً — لكن اتخاذ الخطوة الصحيحة يعيد لك زمام الأمور. ⚖️ معظم النزاعات في تركيا تُحسم في الوساطة الإجبارية دون اللجوء للمحكمة. سأرسم لك المسار الأكثر كفاءة — من الإخطار الرسمي إلى الوساطة وصولاً للمحكمة عند الحاجة. أخبرني: ما المستندات المتوفرة لديك الآن?"
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"خطوات العملية", "tm":"المدة المتوقعة", "dy":"يوم"}
                else:
                    permits = ["Legal Dispute Resolution", "Mediation / Litigation"]
                    agencies = ["Mediation Centre (Arabuluculuk)", "Commercial or Civil Court", "Enforcement Directorate (İcra Müdürlüğü)", "Notary Public (for ihtarname)"]
                    docs = ["All Relevant Contracts / Documents", "Invoices & Payment Records", "Email & Communication Logs", "Witness Information (if any)", "Valid ID Document"]
                    summ = "This can be a stressful situation, but taking the right steps puts you back in control. ⚖️ Good news: most disputes in Turkey get resolved through mandatory mediation — no court needed. I've charted the most effective path for you, from a formal warning letter (ihtarname) through mediation, and into court proceedings if necessary. What documents do you have available right now?"
                    labels = {"ag":"Institutions / Agencies", "dc":"Documents You'll Need", "st":"Steps in the Process", "tm":"Estimated Timeline", "dy":"days"}
            
            business_type = lawyer_subtype
        else:
            return None

        step_specs = get_localized_steps(language, business_type)
        details = []
        steps_list = []
        for id_val, title, resp, note in step_specs:
            details.append(StepDetail(id=id_val, title=title, responsible=resp, status="pending", notes=note))
            steps_list.append(title)
            
        combined = CombinedPermitResult(
            permits=permits, agencies=agencies, documents=docs, steps=steps_list, 
            timeline_days=timeline, summary=summ, location=district, business_type=business_type
        )
        
        state = PermitState(
            business_profile={"raw_query": query, "language": language},
            combined_result=combined,
            permit_plan=PermitPlan(permits=permits, agencies=agencies, documents=docs),
            execution_plan=ExecutionPlan(steps=details, assigned_agents=["Planner", "Classifier"]),
            last_updated=datetime.now()
        )
        
        out_str = (
            f"💬 {summ}\n\n"
            f"📋 **{labels['ag']}:** {', '.join(agencies)}\n"
            f"📄 **{labels['dc']}:** {', '.join(docs[:6])}\n"
            f"✅ **{labels['st']}:**\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(steps_list)) +
            f"\n\n⏱️ **{labels['tm']}:** {timeline} {labels['dy']}"
        )
        
        dashboard_dump = state.model_dump()
        # Ensure datetimes are ISO for JSON
        if hasattr(dashboard_dump.get("last_updated"), "isoformat"):
            dashboard_dump["last_updated"] = dashboard_dump["last_updated"].isoformat()
            
        # Return tuple: (message, dictionary)
        return out_str, dashboard_dump

    # ------------------------------------------------------------------
    # 2. Keyword match → predefined response (0 tokens)
    # ------------------------------------------------------------------
    intent_group, sub_intent, confidence = detect_intent(query, assistant_type)

    if confidence > 0:
        if intent_group == "redirect":
            target_agent = sub_intent
            target_sub_intent = None
            if sub_intent and ":" in sub_intent:
                target_agent, target_sub_intent = sub_intent.split(":", 1)
            
            underlying_response = _pick_response(target_agent, target_sub_intent)
            
            if target_agent == "lawyer":
                suffix = "Please switch your mode to the **Lawyer Advisor** using the tabs above to continue."
                if language == "tr": suffix = "Lütfen devam etmek için yukarıdan **Avukat Danışmanı** moduna geçiş yapın."
                if language == "ar": suffix = "يرجى تبديل وضعك إلى **المستشار القانوني** للمتابعة."
            elif target_agent == "student":
                suffix = "Please switch your mode to the **Student Advisor** above to continue."
                if language == "tr": suffix = "Lütfen devam etmek için **Öğrenci Danışmanı** moduna geçiş yapın."
                if language == "ar": suffix = "يرجى تبديل وضعك إلى **المستشار الطلابي** للمتابعة."
            else:
                suffix = "Please switch your mode to the **Permit Advisor** above to continue."
                if language == "tr": suffix = "Lütfen devam etmek için **Ruhsat Danışmanı** moduna geçiş yapın."
                if language == "ar": suffix = "يرجى تبديل وضعك إلى **مستشار التراخيص** للمتابعة."

            if underlying_response:
                raw_response = f"{underlying_response}\n\n*( {suffix} )*"
            else:
                raw_response = f"*( {suffix} )*"
        else:
            raw_response = _pick_response(intent_group, sub_intent)
        
        # Override general greetings to be domain-specific and highly professional
        if intent_group == "greeting":
            if assistant_type == "permit":
                if language == "tr":
                    raw_response = "Merhaba! 👋 Ben profesyonel Ruhsat ve İzin Danışmanınızım. İster kafe, ister mağaza veya ofis açıyor olun; ihtiyacınız olan belgeleri, maliyetleri ve adımları sizin için planlayabilirim. Ne tür bir işletme açmayı düşünüyorsunuz?"
                elif language == "ar":
                    raw_response = "أهلاً بك! 👋 أنا مستشارك المهني للتراخيص. سواء كنت تفتح مقهى، متجر، أو مكتب؛ يمكنني تخطيط كل المستندات والتكاليف والخطوات لك. ما نوع العمل الذي تخطط لفتحه؟"
                else:
                    raw_response = "Hello! 👋 I am your professional Permit Advisor. Whether you're opening a café, retail shop, or tech company, I will map out your exact roadmap, timelines, and required documents. What type of business are you planning to start?"
            elif assistant_type == "lawyer":
                if language == "tr":
                    raw_response = "Merhaba! ⚖️ Ben uzman Hukuk Danışmanınızım. Sözleşme incelemesi, şirket kuruluşu veya iş hukuku uyuşmazlıkları konusunda size yol gösterebilirim. Size nasıl yardımcı olabilirim?"
                elif language == "ar":
                    raw_response = "أهلاً بك! ⚖️ أنا مستشارك القانوني المتخصص. أخبرني بوضعك — سواء كنت تحتاج لمراجعة عقد، تأسيس شركة، أو توجيه بشأن نزاع عمالي — لكي نرسم أفضل مسار قانوني لك."
                else:
                    raw_response = "Hello! ⚖️ I am your dedicated Legal Advisor. Tell me about your situation—whether you need a contract reviewed, a company formed, or guidance on a legal dispute—so we can chart the best path forward."
            elif assistant_type == "student":
                if language == "tr":
                    raw_response = "Merhaba! 🎓 Ben özel Öğrenci Danışmanınızım. Kayıt işlemlerinden Kimlik yenilenmesine kadar arkanı kolluyorum. Bugün sana nasıl yardımcı olabilirim?"
                elif language == "ar":
                    raw_response = "مرحباً! 🎓 أنا مستشارك الطلابي المخصص. من تجديد الإقامة (الكيمليك) إلى العثور على أفضل جامعة، أنا هنا لدعمك. كيف يمكنني مساعدتك اليوم؟"
                else:
                    raw_response = "Hi there! 🎓 I am your dedicated Student Advisor. From renewing your Kimlik to university registrations, I've got your back. How can I help you today?"


        if intent_group == "smalltalk":
            if assistant_type == "permit":
                if language == "tr":
                    raw_response = "Harikayım, sorduğun için teşekkürler! 😊 Ruhsat ve izin süreçleri için buradayım. Tüm gerekli adımları planlamaya başlamak ister misin?"
                elif language == "ar":
                    raw_response = "أنا بخير، شكراً لسؤالك! 😊 أنا هنا لمساعدتك في إجراءات الترخيص. هل تود أن نبدأ في تخطيط خطواتك؟"
                else:
                    raw_response = "I'm doing beautifully, thank you for asking! 😊 I'm right here and ready to map out your permit steps whenever you're ready to begin."
            elif assistant_type == "lawyer":
                if language == "tr":
                    raw_response = "Çok iyiyim, teşekkür ederim! 😊 Hukuki süreçleriniz için buradayım. Yardımcı olabileceğim bir konunuz var mı?"
                elif language == "ar":
                    raw_response = "أنا بخير، شكراً لك! 😊 أنا هنا لدعمك في أي مسألة قانونية. كيف يمكنني مساعدتك؟"
                else:
                    raw_response = "I'm doing great, thank you! 😊 Ready to assist you with any legal or contract matters you might have. How can I help today?"
            elif assistant_type == "student":
                if language == "tr":
                    raw_response = "Harika gidiyor, sorduğun için teşekkürler! 😊 Eğitim hayatını kolaylaştırmak için buradayım. Günün nasıl geçiyor?"
                elif language == "ar":
                    raw_response = "أنا بأفضل حال، شكراً لك! 😊 أنا هنا لتسهيل حياتك الجامعية. كيف يمكنني دعمك اليوم؟"
                else:
                    raw_response = "I'm doing fantastic, thanks for asking! 😊 I'm right here to sort out any student or university matters you have. What's on your mind?"

        if intent_group == "identity":
            if assistant_type == "permit":
                if language == "tr":
                    raw_response = "Ben PermitOps AI, İstanbul'da işletme ruhsatı süreçlerinde uzmanlaşmış profesyonel dijital danışmanınızım. 🏢 Vergi kaydından belediye ruhsatına kadar tüm adımları sizin için planlıyorum. Hangi tür işletme açmak istiyorsunuz?"
                elif language == "ar":
                    raw_response = "أنا PermitOps AI، مستشارك الرقمي المتخصص في إجراءات تراخيص الأعمال في إسطنبول. 🏢 أخطط لكل خطوة من التسجيل الضريبي إلى رخصة البلدية. ما نوع العمل الذي تريد فتحه؟"
                else:
                    raw_response = "I'm PermitOps AI — your professional digital advisor specializing in business permit processes across Istanbul. 🏢 From tax registration to municipal licensing, I plan every step for you. What type of business are you looking to open?"
            elif assistant_type == "lawyer":
                if language == "tr":
                    raw_response = "Ben PermitOps Hukuk Danışmanı AI, Türk hukuku alanında uzmanlaşmış dijital asistanınızım. ⚖️ Sözleşme incelemesi, şirket kuruluşu, iş hukuku ve oturma/çalışma izinleri konularında yardımcı oluyorum. Nasıl yardımcı olabilirim?"
                elif language == "ar":
                    raw_response = "أنا مستشار PermitOps القانوني، مساعدك الرقمي المتخصص في القانون التركي. ⚖️ أساعد في مراجعة العقود، تأسيس الشركات، قانون العمل، وتصاريح الإقامة/العمل. كيف يمكنني مساعدتك؟"
                else:
                    raw_response = "I'm the PermitOps Legal Advisor AI — your digital assistant specializing in Turkish law. ⚖️ I help with contract reviews, company formation, employment law, and residence/work permits. How can I assist you?"
            elif assistant_type == "student":
                if language == "tr":
                    raw_response = "Ben PermitOps Öğrenci Danışmanı AI, Türkiye'deki üniversite süreçlerinde uzmanlaşmış dijital rehberinizim. 🎓 Üniversite kaydı, öğrenci kimliği yenileme ve en iyi üniversiteleri bulma konusunda yardımcı oluyorum. Ne ile başlayalım?"
                elif language == "ar":
                    raw_response = "أنا مستشار PermitOps الطلابي، مرشدك الرقمي المتخصص في الإجراءات الجامعية في تركيا. 🎓 أساعد في التسجيل الجامعي، تجديد هوية الطالب، والعثور على أفضل الجامعات. من أين نبدأ؟"
                else:
                    raw_response = "I'm the PermitOps Student Advisor AI — your digital guide for university processes in Turkey. 🎓 I help with university registration, student ID renewal, and finding the best universities. Where shall we start?"

        if intent_group == "capabilities":
            if assistant_type == "permit":
                if language == "tr":
                    raw_response = "İşte size yardımcı olabileceğim konular: 📋 İşletme ruhsatı süreçleri, 📄 Gerekli belgeler listesi, 🏛️ İlçe belediyesi bilgileri, ⏱️ Süre tahminleri, ve 💰 Maliyet bilgileri. Hangi konuda yardım istersiniz?"
                elif language == "ar":
                    raw_response = "إليك ما يمكنني مساعدتك فيه: 📋 إجراءات تراخيص الأعمال، 📄 قوائم المستندات المطلوبة، 🏛️ معلومات بلدية المنطقة، ⏱️ تقديرات المدة الزمنية، و 💰 معلومات التكلفة. في أي موضوع تريد المساعدة؟"
                else:
                    raw_response = "Here's what I can help you with: 📋 Business permit processes, 📄 Required document checklists, 🏛️ District municipality info, ⏱️ Timeline estimates, and 💰 Cost breakdowns. What would you like to dive into?"
            elif assistant_type == "lawyer":
                if language == "tr":
                    raw_response = "Size şu konularda yardımcı olabilirim: 📝 Sözleşme incelemesi, 🏢 Şirket kuruluşu, 👷 İş hukuku, 🏠 Oturma/çalışma izinleri, ve ⚖️ Hukuki ihtilaflar. Hangi konuda desteğe ihtiyacınız var?"
                elif language == "ar":
                    raw_response = "يمكنني مساعدتك في: 📝 مراجعة العقود، 🏢 تأسيس الشركات، 👷 قانون العمل، 🏠 تصاريح الإقامة/العمل، و ⚖️ النزاعات القانونية. في أي مجال تحتاج الدعم؟"
                else:
                    raw_response = "I can help you with: 📝 Contract reviews, 🏢 Company formation, 👷 Employment law, 🏠 Residence/work permits, and ⚖️ Legal disputes. Which area do you need support with?"
            elif assistant_type == "student":
                if language == "tr":
                    raw_response = "Size şu konularda yardımcı olabilirim: 🎓 Üniversite kaydı, 🪪 Öğrenci kimliği yenileme, 🏫 En iyi üniversiteler listesi, ve 📋 Öğrenci ikamet izni. Hangi konuyla başlayalım?"
                elif language == "ar":
                    raw_response = "يمكنني مساعدتك في: 🎓 التسجيل الجامعي، 🪪 تجديد هوية الطالب، 🏫 قائمة أفضل الجامعات، و 📋 تصريح إقامة الطالب. بأي موضوع نبدأ؟"
                else:
                    raw_response = "I can help you with: 🎓 University registration, 🪪 Student ID (Kimlik) renewal, 🏫 Top universities list, and 📋 Student residence permits. Which one shall we start with?"

        if raw_response:
            variables = build_variables(user_name=user_name)
            response = render(raw_response, variables)

            # Cache this predefined response so repeated queries skip even step 2
            response_cache.set(query, response, assistant_type, language)

            print(
                f"[SmartRouter] KEYWORD HIT — intent={intent_group}.{sub_intent}, "
                f"assistant={assistant_type}"
            )
            return response

    # ------------------------------------------------------------------
    # 3. AI fallback — only for ambiguous queries that don't match
    #    any domain-specific keyword (permits, registration, legal steps).
    #    Complex domain queries fall through to orchestrators.
    # ------------------------------------------------------------------
    _DOMAIN_PASS_THROUGH_GROUPS = {"permit", "student", "lawyer"}

    if intent_group in _DOMAIN_PASS_THROUGH_GROUPS:
        # The query IS domain-specific but we had no predefined response for that sub-intent.
        # Let the full orchestrator handle it for rich structured output.
        print(
            f"[SmartRouter] PASS-THROUGH — domain-specific query with no library response "
            f"({intent_group}.{sub_intent}). Routing to orchestrator."
        )
        return None

    # Generic / ambiguous query — use AI fallback with 100-token cap
    ai_response = await ai_fallback_response(
        query=query,
        assistant_type=assistant_type,
        gemini_model=gemini_model,
        student_model=student_model,
        lawyer_model=lawyer_model,
    )

    if ai_response:
        # Cache the AI response to avoid paying for it again
        response_cache.set(query, ai_response, assistant_type, language)
        return ai_response

    # Everything failed — let the orchestrator take over
    return None
