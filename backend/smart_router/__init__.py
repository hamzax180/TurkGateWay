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
    # "I want to open / start / launch X"
    r"\b(i want to|i'd like to|i plan to|i'm planning to|i am planning to|how (do i|can i|to))\b.{0,30}\b(open|start|launch|set up|setup|register|create)\b",
    # "open a restaurant/cafe/shop in X"
    r"\bopen (a |an |my )?[\w\s]{1,30}(in|at|near)\b",
    # "want to open"
    r"\bwant to (open|start|register|set up)\b",
    # "how do I open / start / register"
    r"\bhow (do i|can i|to) (open|start|register|set up|get a permit|apply for)\b",
    # "I need a permit for"
    r"\b(need|get|apply for|obtain) (a |an )?(permit|ruhsat|lisans|licence|license)\b",
    # Student: enroll at / register for university
    r"\b(enroll|register|apply) (at|for|to|in) (a |the |my )?university\b",
    # Lawyer: I need legal help for / I need to form a company
    r"\b(form|create|register|incorporate|set up) (a |my |an )?(company|business|firm|ltd|aş)\b",
    r"\b(i need|i have|i got) (a |an )?(legal|contract|lawyer|employment) (problem|issue|dispute|case|question|matter)\b",
    # Lawyer topic button exact labels (sent verbatim by the frontend chip buttons)
    r"^(contract review|company formation|employment law|legal disputes|legal timelines|residency/permit|residency permit|work permit)$",
    # Lawyer general consultation triggers (typed queries)
    r"\b(review (my |a |the )?(contract|agreement|nda|clause)|check (my |this )?(contract|agreement))\b",
    r"\b(form|open|start|register|incorporate) (a |my )?(company|ltd|limited şirket|anonim şirket|business|firm)\b",
    r"\b(fired|wrongfully dismissed|unfair dismissal|severance pay|kıdem tazminat|employment dispute|labour court|iş mahkemesi)\b",
    r"\b(work permit|residence permit|ikamet (başvuru|application)|çalışma izni|stay in turkey legally|legal to work)\b",
    r"\b(legal dispute|lawsuit|mediation|arabuluculuk|ihtarname|file a claim|take to court|sue (someone|my|the))\b",
    r"\b(how long (does|will|do)).{0,40}(company|permit|contract|court|case|formation|residency|ikamet)\b",
    # Naked location changes mid-session ("cafe in besiktas")
    r"\b(cafe|kafe|restaurant|restoran|retail|office|ofis|pharmacy|eczane|bakery|f[ıi]r[ıi]n|barber|berber|gym|spor|shop|store|company|ma[ğg]aza|d[üu]kkan) (in|at) \b",
    # ID Renewal / Replacement
    r"\b(renew|replace).{1,15}(id|kimlik|student id)\b",
]
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
            # Determine business sub-intent
            _, sub, _ = detect_intent(query, "permit")
            business_type = sub.title() if sub else "Business"
            
            # Determine location
            district = "Istanbul"
            districts = ["Kadikoy", "Kadıköy", "Besiktas", "Beşiktaş", "Sisli", "Şişli", "Uskudar", "Üsküdar", "Zeytinburnu", "Bakirkoy", "Bakırköy", "Beyoglu", "Beyoğlu", "Fatih", "Sariyer", "Sarıyer", "Kagithene", "Kağıthane", "Eyup", "Eyüp", "Maltepe", "Atasehir", "Ataşehir"]
            lower_q = query.lower()
            for d in districts:
                if d.lower() in lower_q:
                    district = d.title()
                    break
            
            # Localized Municipality Name
            mun_name = f"{district} Belediyesi" if district != "Istanbul" else "District Municipality"
            if language == "tr":
                mun_name = f"{district} Belediyesi" if district != "Istanbul" else "İlçe Belediyesi"
            elif language == "ar":
                mun_name = f"بلدية {district}" if district != "Istanbul" else "بلدية المنطقة"

            if language == "tr":
                permits = [f"{district} İşyeri Açma ve Çalışma Ruhsatı"]
                agencies = [mun_name, "Vergi Dairesi"]
                docs = ["Kimlik", "Kira Sözleşmesi", "Vergi Levhası", "NACE Kodu Belgesi"]
                summ = f"Bu, {district} bölgesinde bir {business_type} açmak için çevrimdışı oluşturulmuş yol haritanızdır. İşlemleri takip etmek için soldaki Gösterge Paneli'ne (Dashboard) gidin."
                labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
            elif language == "ar":
                permits = [f"رخصة فتح وتشغيل من {district}"]
                agencies = [mun_name, "مكتب الضرائب"]
                docs = ["الهوية", "عقد الإيجار", "اللوحة الضريبية", "وثيقة رمز NACE"]
                summ = f"هذه هي خريطة الطريق الآلية التي تم إنشاؤها لفتح {business_type} في منطقة {district}. اذهب إلى لوحة التحكم (Dashboard) لبدء العملية."
                labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
            else:
                permits = [f"{district} Workplace Operating License"]
                agencies = [mun_name, "Tax Office"]
                docs = ["ID / Passport", "Lease Agreement", "Tax Plate", "NACE Code Certificate"]
                summ = f"This is your automated roadmap to officially open a {business_type} in {district}. Go to the Dashboard on the left to start your application process."
                labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}

            timeline = 30
            if business_type.lower() in ["restaurant", "cafe", "bakery", "food"]:
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
                    agencies.extend(["Fire Department"])

        elif assistant_type == "student":
            is_renew = "renew" in query.lower() or "replace" in query.lower()
            business_type = "student_renew" if is_renew else "Student"
            district = "Istanbul"
            timeline = 10 if is_renew else 30
            
            if language == "tr":
                permits = ["Öğrenci İkamet İzni Uzatması"] if is_renew else ["Öğrenci Kaydı", "Öğrenci İkamet İzni"]
                agencies = ["Göç İdaresi", "Noter", "Sigorta Şirketi"] if is_renew else ["Öğrenci İşleri", "Göç İdaresi", "SGK"]
                docs = ["Sağlık Sigortası", "Noter Onaylı Kira Sözleşmesi", "Öğrenci Belgesi", "Biyometrik Fotoğraf"] if is_renew else ["Pasaport", "Kabul Mektubu", "Sağlık Sigortası"]
                summ = "İlk olarak, mevcut kimlik kartınızın süresi doldu mu yoksa dilediğiniz zaman mı yenilemek istiyorsunuz? İkamet uzatma işleminiz için sigorta ve kira sözleşmesi adımlarını içeren yol haritası aşağıdadır." if is_renew else "Üniversite kayıt ve öğrenci kimliği işlemleriniz için oluşturulan adım adım yol haritanız."
                labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
            elif language == "ar":
                permits = ["تمديد إقامة الطالب"] if is_renew else ["تسجيل الجامعة", "إقامة الطالب"]
                agencies = ["إدارة الهجرة", "العدل (النوتر)", "شركة التأمين"] if is_renew else ["شؤون الطلاب", "إدارة الهجرة", "SGK"]
                docs = ["التأمين الصحي", "عقد إيجار موثق", "شهادة طالب", "صور شخصية"] if is_renew else ["جواز السفر", "خطاب القبول", "التأمين الصحي"]
                summ = "أولاً، هل انتهت صلاحية هويتك الحالية أم أنها ستنتهي قريباً؟ إليك خريطة الطريق لتجديد الإقامة التي تشمل خطوات التأمين وعقد السكن." if is_renew else "خريطة الطريق الآلية لاستكمال التسجيل الجامعي وإقامة الطالب."
                labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
            else:
                permits = ["Student Residence Permit Extension"] if is_renew else ["University Registration", "Student Residence Permit"]
                agencies = ["Migration Office (Göç İdaresi)", "Notary Public", "Insurance Provider"] if is_renew else ["Student Affairs", "Migration Directorate (Göç İdaresi)", "SGK"]
                docs = ["Health Insurance Policiy", "Notarized Lease Agreement", "Student Certificate", "Biometric Photos"] if is_renew else ["Passport", "Acceptance Letter", "Health Insurance"]
                summ = "First, is your current ID card already expired, or are you just planning to renew it early? Below is your residency (Kimlik) extension roadmap including insurance and housing steps." if is_renew else "Your automated roadmap for completing university registration and obtaining your Student Residence Permit."
                labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}

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
                    summ = "Sözleşmenizi dikkatle inceliyoruz. Hangi maddelerin sizi rahatsız ettiğini belirtirseniz avukat ekibimiz riskleri analiz edip yazılı bir revizyon taslağı hazırlayacak. Belgelerinizi yüklemek için Dashboard'ı kullanın."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["مراجعة العقد", "الإجراء القانوني"]
                    agencies = ["محامٍ / مكتب قانوني", "كاتب العدل", "نقابة المحامين التركية"]
                    docs = ["العقد الموقّع", "الملاحق والتعديلات", "المراسلات الإلكترونية ذات الصلة", "وثيقة هوية"]
                    summ = "نراجع عقدك بعناية. حدد البنود التي تقلقك وسيقوم فريقنا القانوني بتحليل المخاطر وإعداد مسودة تعديل خطية. استخدم لوحة التحكم لرفع مستنداتك."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
                else:
                    permits = ["Contract Review", "Legal Advisory"]
                    agencies = ["Lawyer / Law Firm", "Notary Public", "Turkish Bar Association"]
                    docs = ["Signed Contract", "Addendums & Amendments", "Relevant Email Correspondence", "Valid ID Document"]
                    summ = "We're reviewing your contract carefully. Tell us which clauses concern you, and our legal team will analyze the risks and prepare a written amendment draft. Use the Dashboard to upload your documents."
                    labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_company":
                timeline = 10
                if language == "tr":
                    permits = ["Ltd. Şirket Tescili", "Vergi Kaydı", "Ticaret Sicili Tescili"]
                    agencies = ["Ticaret Sicili Müdürlüğü", "Vergi Dairesi", "MERSİS Portalı", "Noter"]
                    docs = ["Pasaport / Kimlik (Tüm Ortaklar)", "Ana Sözleşme Taslağı", "Kira Sözleşmesi / Ofis Adresi", "Sermaye Deposu Makbuzu (Gerekirse)"]
                    summ = "Şirket kuruluşunuz için adım adım yol haritanız hazır. MERSİS'te ad rezervasyonundan Ticaret Sicili ve vergi kaydına kadar tüm süreci aşağıda görebilirsiniz. Dashboard üzerinden belge yükleyip işlemlerinizi takip edebilirsiniz."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تسجيل شركة ذات مسؤولية محدودة", "التسجيل الضريبي", "تسجيل السجل التجاري"]
                    agencies = ["مديرية السجل التجاري", "مكتب الضرائب", "بوابة MERSİS", "كاتب العدل"]
                    docs = ["جواز السفر / الهوية (جميع المساهمين)", "مسودة النظام الأساسي", "عقد الإيجار / عنوان المكتب", "إيصال إيداع رأس المال (إذا لزم)"]
                    summ = "خريطة طريقك للتأسيس الشركة جاهزة. من حجز الاسم في MERSİS إلى التسجيل في السجل التجاري ومكتب الضرائب. استخدم لوحة التحكم لرفع مستنداتك وتتبع تقدمك."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
                else:
                    permits = ["Ltd. Şirket Registration", "Tax Registration", "Trade Registry Entry"]
                    agencies = ["Trade Registry Directorate", "Tax Office (Vergi Dairesi)", "MERSİS Portal", "Notary Public (Noter)"]
                    docs = ["Passport / ID (All Shareholders)", "Articles of Association Draft", "Office Lease or Address Proof", "Capital Deposit Receipt (if applicable)"]
                    summ = "Your company formation roadmap is ready. From reserving your name in MERSİS to completing the Trade Registry and tax registrations — every step is mapped out below. Use the Dashboard to upload documents and track your progress."
                    labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_employment":
                timeline = 21
                if language == "tr":
                    permits = ["İş Mahkemesi Başvurusu", "Zorunlu Arabuluculuk"]
                    agencies = ["İş Mahkemesi", "Arabuluculuk Merkezi", "SGK", "Türkiye İş Kurumu (İŞKUR)"]
                    docs = ["İmzalı İş Sözleşmesi", "Tüm Bordro Belgeleri", "Yazılı Fesih Bildirimi", "İşverenden Gelen Her Türlü Yazışma", "Fazla Mesai / Mesai Kanıtı"]
                    summ = "İş haklarınızı savunmak için gerekli tüm adımlar aşağıda. Zorunlu arabuluculuktan başlayarak İş Mahkemesi sürecine kadar tüm hukuki yolu covering ediyoruz. Belgeleri Dashboard'a yükleyin, avukat ekibimiz değerlendirsin."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["دعوى محكمة العمل", "الوساطة الإجبارية"]
                    agencies = ["محكمة العمل", "مركز الوساطة", "SGK", "إدارة التوظيف التركية (İŞKUR)"]
                    docs = ["عقد العمل الموقّع", "جميع كشوف الرواتب", "إشعار الفسخ الخطي", "أي مراسلات من صاحب العمل", "دليل العمل الإضافي"]
                    summ = "جميع الخطوات اللازمة للدفاع عن حقوقك العمالية موضّحة أدناه. من الوساطة الإجبارية حتى رفع الدعوى في محكمة العمل. ارفع مستنداتك في لوحة التحكم وسيراجعها فريقنا القانوني."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
                else:
                    permits = ["Labour Court Claim", "Mandatory Mediation (Arabuluculuk)"]
                    agencies = ["Labour Court (İş Mahkemesi)", "Mediation Centre", "SGK (Social Security)", "Turkish Employment Agency (İŞKUR)"]
                    docs = ["Signed Employment Contract", "All Payslips / Salary Records", "Written Termination Notice", "Any Employer Correspondence", "Overtime / Hours Worked Proof"]
                    summ = "All the steps to defend your employment rights are mapped out below. From mandatory mediation through to the Labour Court — we cover the full legal path. Upload your documents to the Dashboard and our legal team will assess your case."
                    labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}
                    
            elif lawyer_subtype == "lawyer_residency":
                timeline = 35
                if language == "tr":
                    permits = ["Çalışma İzni", "İkamet İzni (Kimlik)"]
                    agencies = ["Göç İdaresi Genel Müdürlüğü", "Aile ve Çalışma Bakanlığı", "Sigorta Sağlayıcısı", "e-İkamet Portalı"]
                    docs = ["Geçerli Pasaport (6+ ay)", "Biyometrik Fotoğraflar (4 adet)", "Yabancı Sağlık Sigortası", "Noter Onaylı Kira Sözleşmesi", "İş Sözleşmesi (Çalışma İzni için)", "Başvuru Ücreti Makbuzu"]
                    summ = "Türkiye'de ikamet veya çalışma izni için hazırladığımız adım adım kılavuz. İzin türünüzü belirleyip e-İkamet sistemine başvurmaktan Göç İdaresi randevusuna kadar tüm süreci kapsıyor. Dashboard'dan belgelerinizi yükleyebilirsiniz."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["تصريح العمل", "إذن الإقامة (Kimlik)"]
                    agencies = ["الإدارة العامة للهجرة", "وزارة العمل والشؤون الاجتماعية", "شركة التأمين الصحي", "بوابة e-İkamet"]
                    docs = ["جواز سفر ساري (6+ أشهر)", "صور بيومترية (4 صور)", "تأمين صحي للأجانب", "عقد إيجار موثّق لدى كاتب العدل", "عقد العمل (لتصريح العمل)", "إيصال رسوم الطلب"]
                    summ = "دليلنا خطوة بخطوة للحصول على إقامة أو تصريح عمل في تركيا. من تحديد نوع التصريح والتقديم عبر e-İkamet إلى حضور موعد إدارة الهجرة. ارفع مستنداتك من لوحة التحكم."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
                else:
                    permits = ["Work Permit (Çalışma İzni)", "Residence Permit / Kimlik (İkamet)"]
                    agencies = ["Directorate General of Migration (Göç İdaresi)", "Ministry of Labour & Social Security", "Health Insurance Provider", "e-İkamet Portal"]
                    docs = ["Valid Passport (6+ months remaining)", "Biometric Photos (4 copies)", "Foreign Health Insurance Policy", "Notarized Rental Contract", "Employment Contract (for Work Permit)", "Application Fee Receipt"]
                    summ = "Your step-by-step guide to obtaining a residence or work permit in Turkey. From identifying your permit type and applying via e-İkamet to attending your Göç İdaresi appointment — the full process is below. Upload your documents from the Dashboard."
                    labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}
                    
            else:  # lawyer_dispute (default for general legal disputes)
                timeline = 25
                lawyer_subtype = "lawyer_dispute"
                if language == "tr":
                    permits = ["Hukuki İhtilaf Çözümü", "Arabuluculuk / Dava"]
                    agencies = ["Arabuluculuk Merkezi", "Ticaret Mahkemesi / Asliye Hukuk", "İcra Müdürlüğü", "Noter"]
                    docs = ["İlgili Tüm Sözleşmeler / Belgeler", "Fatura ve Ödeme Kayıtları", "E-posta / Yazışma Kayıtları", "Tanık Bilgileri (Varsa)", "Kimlik Belgesi"]
                    summ = "Hukuki ihtilafınızı çözmek için gereken tüm adımlar aşağıda. Resmi ihtarnameden zorunlu arabuluculuğa, oradan da mahkeme sürecine kadar tüm hukuki yolu kapsıyoruz. Belgelerinizi yüklemek için Dashboard'ı kullanın."
                    labels = {"ag":"Kurumlar", "dc":"Gerekli Belgeler", "st":"Adımlar", "tm":"Süre", "dy":"gün"}
                elif language == "ar":
                    permits = ["حل النزاع القانوني", "الوساطة / التقاضي"]
                    agencies = ["مركز الوساطة", "المحكمة التجارية / المدنية", "مديرية التنفيذ", "كاتب العدل"]
                    docs = ["جميع العقود / المستندات ذات الصلة", "الفواتير وسجلات الدفع", "سجلات البريد الإلكتروني / المراسلات", "معلومات الشهود (إن وجدوا)", "وثيقة هوية"]
                    summ = "جميع الخطوات اللازمة لحل نزاعك القانوني موضّحة أدناه. من الإخطار الرسمي إلى الوساطة الإجبارية وصولاً إلى التقاضي — نغطي المسار القانوني الكامل. ارفع مستنداتك من لوحة التحكم."
                    labels = {"ag":"المؤسسات", "dc":"المستندات المطلوبة", "st":"الخطوات", "tm":"الجدول الزمني", "dy":"يوم"}
                else:
                    permits = ["Legal Dispute Resolution", "Mediation / Litigation"]
                    agencies = ["Mediation Centre (Arabuluculuk)", "Commercial or Civil Court", "Enforcement Directorate (İcra Müdürlüğü)", "Notary Public (for ihtarname)"]
                    docs = ["All Relevant Contracts / Documents", "Invoices & Payment Records", "Email & Communication Logs", "Witness Information (if any)", "Valid ID Document"]
                    summ = "All the steps to resolve your legal dispute are mapped out below. From a formal warning letter (ihtarname) through mandatory mediation, and into court proceedings if needed — we cover the complete legal path. Upload your documents from the Dashboard."
                    labels = {"ag":"Institutions/Agencies", "dc":"Required Docs", "st":"Action Steps", "tm":"Timeline", "dy":"days"}
            
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
            f"📄 **{labels['dc']}:** {', '.join(docs[:6])}...\n"
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
