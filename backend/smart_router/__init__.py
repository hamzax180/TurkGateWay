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
_LIBRARY_PATH = os.path.join(os.path.dirname(__file__), "response_library.json")
_library: dict = {}

try:
    with open(_LIBRARY_PATH, "r", encoding="utf-8") as f:
        _library = json.load(f)
    print("[SmartRouter] Response library loaded successfully.")
except Exception as e:
    print(f"[SmartRouter] WARNING: Failed to load response library: {e}")


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
    r"\b(how long (does|will|do)).{0,40}(company|permit|contract|court|case|formation|residency|ikamet)\b",
    # Naked location changes mid-session ("cafe in besiktas")
    r"\b(cafe|kafe|restaurant|restoran|retail|office|ofis|pharmacy|eczane|bakery|f[\u0131i]r[\u0131i]n|barber|berber|gym|spor|shop|store|company|ma[\u011fg]aza|d[\u00fcu]kkan) (in|at) \b",
    # ID Renewal / Replacement
    r"\b(renew|replace).{1,15}(id|kimlik|student id)\b",
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
) -> Optional[str]:
    """
    Try to handle the query without (or with minimal) AI usage.

    Returns:
        A ready-to-send response string, or None if this query needs
        the full orchestrator pipeline.
    """

    # ------------------------------------------------------------------
    # 1. Cache check (0 tokens)
    # ------------------------------------------------------------------
    cached = response_cache.get(query)
    if cached:
        return cached

    # ------------------------------------------------------------------
    # 0.5. NEW CONSULTATION GUARD — offline dynamic dashboard (0 tokens)
    # If the query is an initial plan request, we bypass AI completely
    # and generate the 14-step permit dashboard directly in Python.
    # ------------------------------------------------------------------
    if _NEW_CONSULTATION_RE.search(query):
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
            lower_q = query.lower()
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
            business_type = "Business"  # fallback
            for kw_list, display_name in _BUSINESS_KEYWORDS:
                if any(kw in lower_q for kw in kw_list):
                    business_type = display_name
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

            for key, (dname, mun_en, note) in _DISTRICT_INFO.items():
                if key in lower_q:
                    district_en = dname
                    district_display = dname
                    mun_name_en = mun_en
                    district_note = note
                    break

            # If no district found, ask which district
            no_district = district_display is None
            district = district_display or "Istanbul"

            # Localized Municipality Name
            mun_name = mun_name_en
            if language == "tr":
                mun_name = f"{district} Belediyesi" if not no_district else "İlçe Belediyesi"
            elif language == "ar":
                mun_name = f"بلدية {district}" if not no_district else "بلدية المنطقة"

            if language == "tr":
                permits = [f"{district} İşyeri Açma ve Çalışma Ruhsatı"]
                agencies = [mun_name, "Vergi Dairesi"]
                docs = ["Kimlik", "Kira Sözleşmesi", "Vergi Levhası", "NACE Kodu Belgesi"]
                if no_district:
                    summ = f"Mükemmel! {business_type} açmak için harika bir karar. 🎉 Adım adım yol haritanız aşağıda hazır — ancak başvuracağınız belediye ilçenize göre değişir. Hangi ilçedesiniz? (Örn: Kadıköy, Beşiktaş, Şişli, Üsküdar...)"
                else:
                    summ = f"Mükemmel seçim! {district}'de {business_type} açmak için bilmeniz gereken her şeyi hazırladım. 🎉 Önemli not: {district_note} Aşağıdaki yol haritasını takip edin ve merak ettiğinizi sorun!"
                labels = {"ag": "Kurumlar", "dc": "Gerekli Belgeler", "st": "Adımlar", "tm": "Tahmini Süre", "dy": "gün"}
            elif language == "ar":
                permits = [f"رخصة فتح وتشغيل من {district}"]
                agencies = [mun_name, "مكتب الضرائب"]
                docs = ["الهوية", "عقد الإيجار", "اللوحة الضريبية", "وثيقة رمز NACE"]
                if no_district:
                    summ = f"رائع! فتح {business_type} قرار ممتاز. 🎉 خريطة الطريق جاهزة أدناه — لكن الجهة المختصة تختلف حسب المنطقة. في أي منطقة ستفتح؟ (مثل: كاديكوي، بشيكتاش، شيشلي...)"
                else:
                    summ = f"اختيار رائع! أعددت لك كل ما تحتاجه لفتح {business_type} في {district}. 🎉 ملاحظة مهمة: {district_note} راجع الخطوات أدناه واسألني عن أي شيء!"
                labels = {"ag": "المؤسسات", "dc": "المستندات المطلوبة", "st": "الخطوات", "tm": "المدة الزمنية المتوقعة", "dy": "يوم"}
            else:
                permits = [f"{district} Workplace Operating License"]
                agencies = [mun_name, "Tax Office (Vergi Dairesi)"]
                docs = ["ID / Passport", "Lease Agreement", "Tax Plate", "NACE Code Certificate"]
                if no_district:
                    summ = (
                        f"Great choice — opening a {business_type} is an exciting step! 🚀 "
                        f"I've mapped out your full roadmap below. One thing: the exact municipality you'll apply to depends on your district. "
                        f"**Which district of Istanbul are you opening in?** (e.g. Kadıköy, Beşiktaş, Şişli, Üsküdar, Bakırköy, Ataşehir…) "
                        f"Each district has its own belediye with slightly different processing times and rules."
                    )
                else:
                    summ = (
                        f"Great choice — I've put together your complete roadmap for opening a {business_type} in {district}! 🚀 "
                        f"📍 **{district} note:** {district_note} "
                        f"Follow the steps below and feel free to ask me anything along the way."
                    )
                labels = {"ag": "Institutions / Agencies", "dc": "Documents You'll Need", "st": "Your Action Steps", "tm": "Estimated Timeline", "dy": "days"}

            timeline = 30
            if any(kw in lower_q for kw in ["restaurant", "restoran", "cafe", "kafe", "bakery", "fırın", "firın", "food", "gıda"]):
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
        raw_response = _pick_response(intent_group, sub_intent)

        if raw_response:
            variables = build_variables(user_name=user_name)
            response = render(raw_response, variables)

            # Cache this predefined response so repeated queries skip even step 2
            response_cache.set(query, response)

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
        response_cache.set(query, ai_response)
        return ai_response

    # Everything failed — let the orchestrator take over
    return None
