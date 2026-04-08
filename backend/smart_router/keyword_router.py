"""
keyword_router.py
-----------------
Detects user intent using pure keyword matching — no AI required.
Returns (intent, sub_intent, confidence) tuple.
confidence = 1.0 for keyword match, 0.0 for no match (triggers AI fallback).
"""

import re
from typing import Tuple, Optional

# ---------------------------------------------------------------------------
# Keyword maps — ordered from most specific to least specific
# ---------------------------------------------------------------------------

INTENT_MAP = {
    "greeting": [
        r"\b(hi|hey|hello|good morning|good afternoon|good evening|howdy|sup|yo|merhaba|selam|günaydın|iyi günler)\b",
        r"(مرحبا|مرحباً|هلا|أهلا|أهلاً|سلام|السلام عليكم|صباح الخير|مساء الخير|كيف الحال)"
    ],
    "smalltalk": [
        r"\b(how are you|how do you do|hows it going|what's up|whats up|how are things|hows life|nasılsın|naber|nasıl gidiyor)\b",
        r"(كيف حالك|شو أخبارك|شخبارك|شلونك|كيفك|كيف الحال|عساك بخير|عامل ايه|شمسوي)"
    ],
    "identity": [
        r"\b(who are you|what are you|what is this|what do you do|your name|tell me about yourself|introduce yourself)\b",
        r"(من أنت|مين انت|ايش انت|ايش اسمك|من تكون|ماهي هويتك|عرف عن نفسك|مين معايا)"
    ],
    "capabilities": [
        r"\b(what can you do|how can you help|what do you offer|what are your features|help me)\b",
        r"(كيف تقدر تساعدني|ايش وظيفتك|شلون تقدر تساعدني|بشنو تخدم|وش تقدر تسوي|ما هي قدراتك|ميزاتك|تساعدني|مساعدة)"
    ],
    "farewell": [
        r"\b(bye|goodbye|see you|later|take care|cya|farewell)\b",
        r"(مع السلامة|باي|وداعا|في أمان الله|اشوفك على خير|وداعاً)"
    ],
    "thanks": [
        r"\b(thank(s| you)|thx|cheers|much appreciated|appreciate it)\b",
        r"(شكرا|شكراً|يعطيك العافية|تسلم|مشكور|ما قصرت|ممتن|تشكرات|الف شكر)"
    ],
    "trust": [
        r"\b(is your (answer|response) (right|correct|true|accurate)|can i trust|how do i know)\b",
        r"\b(are you (sure|right|correct|certain))\b",
        r"\b(is this (true|real|accurate))\b",
        r"(هل انت متأكد|متأكد|أكيد|هل هذا صحيح|صح|موثوق|دقيق|مضبوط|اكيد)"
    ],

    # Billing intents
    "billing.price": [
        r"\b(price|pricing|cost|how much|fee|fees|plan|plans|subscription cost|what does it cost)\b",
        r"(سعر|اسعار|تكلفة|رسوم|كم السعر|الاشتراك|بكم|كم يكلف)"
    ],
    "billing.refund": [
        r"\b(refund|money back|charge|overcharged|cancel and get|reimburs)\b",
        r"(استرداد|ترجيع فلوس|تعويض|إلغاء واسترجاع|رجعوا فلوسي)"
    ],
    "billing.invoice": [
        r"\b(invoice|receipt|billing statement|bill|payment proof)\b",
        r"(فاتورة|إيصال|وصل دفع|كشف حساب|فواتير)"
    ],
    "billing.subscription": [
        r"\b(subscription|cancel|upgrade|downgrade|renew|auto.?renew)\b",
        r"(اشتراك|إلغاء اشتراك|تجديد اشتراك|تجديد الباقة|ترقية|باقة|اشتراكي)"
    ],

    # Support intents
    "support.error": [
        r"\b(error|exception|crashed|crash|500|404|bug|issue|not load|won.t load|can.t load)\b",
        r"(خطأ|مشكلة|ايرور|عطل|تعليق|نافذة خطأ)"
    ],
    "support.not_working": [
        r"\b(not working|doesn.t work|broken|stopped working|won.t work|failing|fail|can.t access)\b",
        r"(لا يعمل|مو شغال|ما يشتغل|خربان|متوقف|في مشكلة|عطلان)"
    ],
    "support.slow": [
        r"\b(slow|lag|laggy|loading forever|taking too long|unresponsive|hangs)\b",
        r"(بطيء|يعلق|ياخذ وقت|النت ضعيف|الصفحة بطيئة|معلق)"
    ],

    # --- Permit Agent intents ---
    "permit.restaurant": [
        r"\b(restaurant|restoran|lokanta|dinner|dining|food permit)\b",
        r"(مطعم|بوفيه|مأكولات|وجبات|مطاعم)"
    ],
    "permit.cafe": [
        r"\b(cafe|cafeteria|kafe|coffee shop|tea house|pastry shop)\b",
        r"(مقهى|كافيه|كافي|قهوة|محل عصير|كافتيريا)"
    ],
    "permit.clothing": [
        r"\b(clothing|clothes|apparel|boutique|garment|shoe|giyim)\b",
        r"(ملابس|ازياء|أزياء|ملبوسات|بوتيك|أحذية|احذية|شنط|حقائب)"
    ],
    "permit.retail": [
        r"\b(retail|shop|store|market|grocery|bakkal|supermarket|ma[ğg]aza|d[üu]kkan)\b",
        r"(بقالة|سوبر ماركت|تموينات|محل|معرض|تجزئة|دكان)"
    ],
    "permit.office": [
        r"\b(office|consulting|agency|sanal ofis|ofis|b[üu]ro|headquarters)\b",
        r"(مكتب|مقر|شركة (عقارات|استشارات)|وكالة|استشارات|سياحة|مكاتب)"
    ],
    "permit.barber": [
        r"\b(barber|hair salon|beauty|kuaf[öo]r|berber|g[üu]zellik|spa)\b",
        r"(حلاق|صالون|كوافير|تجميل|عناية|سبا|مشغل)"
    ],
    "permit.gym": [
        r"\b(gym|fitness|crossfit|spor|sports center)\b",
        r"(نادي|صالة رياضية|جيم|حديد|كروسفيت|نادي رياضي)"
    ],
    "permit.pharmacy": [
        r"\b(pharmacy|eczane|chemist|drug store|medicine shop)\b",
        r"(صيدلية|ادوية|أدوية|عطارة|اعشاب)"
    ],
    "permit.bakery": [
        r"\b(bakery|f[ıi]r[ıi]n|bread|pastanesi)\b",
        r"(مخبز|فرن|حلويات|مخبوزات|فطائر|معجنات)"
    ],

    "permit.how_to_start": [
        r"\b(how (do i|to) (start|open|begin|register|set up)|starting a business|open a business|open my business)\b",
        r"\b(i want to (open|start|register|set up)|what business (do i|you) want|obtain a business permit|i want to obtain)\b",
        r"\b(what business|which business|type of business|hangi i[şs]|ne i[şs]|nasıl başlarım|is kurmak|iş kurmak)\b",
        r"^(what permit do you want\??)$",
        r"^(what business (you|do you) want to open\??)$",
        r"(كيف أبدأ|اريد فتح|أريد فتح|كيف افتح|فتح محل|فتح شركة(?! استشارات)|كيف أبدا|تأسيس|أريد تأسيس|انشاء شركة|بدء مشروع|ودي افتح|ما هو التصريح الذي تريده|التصريح الذي تريده|اي تصريح|أي تصريح|وش التصريح|شنو التصريح|نوع التصريح)"
    ],
    "permit.documents": [
        r"\b(what documents|required docs|document(s)? needed|paperwork|what do i need to bring|belge|what do i need|evrak|gerekli belgeler)\b",
        r"\b(documents (do i|needed|required)|need (for|to open)|checklist|what to bring|required (docs|papers))\b",
        r"^(what documents do i need\??)$",
        r"(المستندات|الوثائق|الاوراق|الأوراق المطلوبة|ماذا احتاج|المطلوب|ايش الاوراق|شنو الاوراق|ايش المطلوب|شنو المطلوب)"
    ],
    "permit.cost": [
        r"\b(how much|cost|price|fee(s)?|payment|expensive|affordable|budget|maliy(et)?|ne kadar|kaç (lira|tl|para)|ücret)\b",
        r"\b(does it cost|permit cost|permit fee|registration (fee|cost)|total cost)\b",
        r"^(how much does it cost\??)$",
        r"(كم التكلفة|كم السعر|الرسوم|التكلفة|كم يكلف|بكم|تكاليف|رسوم الرخصة|كم ادفع)"
    ],
    "permit.location": [
        r"\b(where (is|are)|location|district|belediye|which (district|area|municipality)|located in|where do i go|nerede|hangi ilçe)\b",
        r"\b(besiktas|kadikoy|sisli|uskudar|fatih|beyoglu|bakirkoy|zeytinburnu|sariyer|beyo[gğ]lu|be[sş]ikta[sş])\b",
        r"^(where is your business located\??)$",
        r"(اين|أين|موقع|اي بلدية|أي منطقة|وين|في أي منطقة|مكانكم|وين موجودين)"
    ],
    "permit.how_it_works": [
        r"\b(how does it work|how (does|do) (the )?(process|system|permit|it)|explain|overview|what is|tell me about|nasıl çalışıyor|süreç nedir)\b",
        r"\b(how it works|what happens|what (is|are) the|process overview|general (info|guide|overview))\b",
        r"^(how does it work\??)$",
        r"(كيف يعمل|اشرح لي|كيف تعمل|كيف تتم العملية|ما هو الإجراء|كيف النظام|طريقة العمل|شلون الطريقة|كيف الإجراء|وش النظام)"
    ],
    "permit.timeline": [
        r"\b(how long|timeline|time frame|when will|how many days|duration|takes (how|long)|ne kadar s[üu]r|kaç gün)\b",
        r"\bHow long does it take\b",
        r"^(how long does it take\??)$",
        r"(كم يستغرق|كم يوم|المدة|كم يأخذ وقت|متى يخلص|كم من الوقت|متى بتخلص|متى تجهز|وش كثر تاخذ)"
    ],
    "permit.alcohol": [
        r"\b(alcohol|tapdk|liquor|wine|beer|bar|spirits|drinks? permit)\b",
        r"(كحول|شرب|بار|خمر|خمور|مشروبات كحولية)"
    ],
    "permit.music": [
        r"\b(music|live music|band|entertainment permit|canl[iı] m[uü]zik)\b",
        r"(موسيقى|حفلات|فرقة|طرب|غناء|دي جي|لايف ميوزك)"
    ],
    "permit.steps": [
        r"\b(steps|process|procedure|what are the steps|guide me|walk me through|14 steps|know the steps|i want to know|adımlar|süreç)\b",
        r"(الخطوات|ما هي الخطوات|مراحل|دلني|كيف الخطوات|ماهي خطوات|سير العمل|وش اسوي)"
    ],
    "permit.nace": [
        r"\b(nace|nace code|business code|sector code|activity code|faaliyet kodu)\b",
        r"(كود|نشاط|نزه|نص|نية|نیس|رمز نشاط|NACE)"
    ],
    "permit.tax_id": [
        r"\b(tax id|vergi (numarası|no)|tax number|tax registration|tax office|vergi dairesi)\b",
        r"(رقم ضريبي|ضريبة|ضرائب|الرقم الضريبي|دائرة الضرائب)"
    ],

    # --- Student Agent intents ---
    "student.renew_id": [
        r"\b(renew (my )?(student )?(id|kimlik|card)|kimlik renew|id renewal|expired (kimlik|id|card)|replace (my )?(student )?(id|card))\b",
        r"(تجديد [اأ]?ل?هوي[ةه]|تجديد [اأ]?ل?بطاق[ةه]|بطاق[ةه] طالب|هوي[ةه] طالب|تجديد [اأ]?ل?كارنيه|تجديد [اأ]?ل?كملك|بطاقة)"
    ],
    "student.kimlik_lost": [
        r"\b(lost (my )?(kimlik|student id|id card)|stolen (kimlik|card)|missing (kimlik|id))\b",
        r"(ضاع|فقدت|ضياع|انسرق|مفقود) (هوية|بطاقة|كيملك|كملك|كارت|كارت الجامعة)"
    ],
    "student.register_uni": [
        r"\b(how (to|do i) (register|enroll|apply)|university (registration|enrollment|enrolment)|enroll (at|in)|register (at|for) (a |my )?university|yoks[i\u0131]s)\b",
        r"(تسجيل (جامعة|في الجامعة)|تقديم على (جامعة|الجامعة)|قبول جامعي|كيف اسجل بالجامعة|كيف سجل بالجامعة|كيف اسجل|كيف اسجل في الجامعة|كيف اقدم|قيد جامعة|تسجيل جامعي)"
    ],
    "student.top_universities": [
        r"\b(top (10|ten|universities)|best university|best universities|which university|university (list|ranking)|ranked universities)\b",
        r"(أفضل الجامعات|احسن جامعة|ترتيب الجامعات|جامعات قوية|اي جامعة تنصحني)"
    ],
    "student.health_insurance": [
        r"\b(health insurance|sgk|sa\u011fl[i\u0131]k sigorta|student insurance|medical coverage|insurance (for student|plan))\b",
        r"(تأمين طبي|تأمين صحي|SGK|تأمين الطالب|سيكورتا|التأمين)"
    ],
    "student.documents": [
        r"\b(student documents|what documents for (university|uni|registration|enrollment)|required for (university|enrollment))\b",
        r"(أوراق الجامعة|مستندات التقديم|ايش مطلوب للجامعة|وثائق الجامعة|ملف التسجيل)"
    ],
    "student.residence_permit": [
        r"\b(student (residence|ikamet)|ikamet (permit|izni)|residence permit (for student)|g[o\xf6]\xc3\xa7 idaresi)\b",
        r"(اقامة طالب|إقامة طالب|تجديد الاقامة|اقامة|الاقامة الطلابية)"
    ],
    "student.transport_card": [
        r"\b(istanbulkart|transport card|student card|bus card|travel card|metro card|m\u00fczekart|discount card)\b",
        r"(كرت مواصلات|بطاقة مواصلات|اسطنبول كارت|كرت باص|مواصلات|كرت المترو)"
    ],
    "student.dormitory": [
        r"\b(dormitory|dorm|yurt|kyk|housing|accommodation|where to stay|student housing)\b",
        r"(سكن|سكن طلاب|سكن جامعي|عمارة طلاب|يورت|وين اسكن)"
    ],
    "student.equivalency": [
        r"\b(equivalency|denklik|diploma recognition|high school equivalency|y\u00f6k denklik)\b",
        r"(تعديل شهادة|دنكلك|معادلة|معادلة شهادة|تعديل الثانوية|دنكليك)"
    ],
    "student.scholarships": [
        r"\b(scholarship|scholarships|burs|turkiye burslari|ytb|financial aid|tuition funding)\b",
        r"(منحة|منح|المنحة التركية|منحة دراسية|مساعدة مالية|منحة مجانية)"
    ],
    "student.work_rules": [
        r"\b(can i work|work permit for student|student jobs|part time|part-time|working while studying|legal to work)\b",
        r"(شغل|الشغل|العمل|هل مسموح اشتغل|عمل كطالب|دوام جزئي|وظيفة طالب)"
    ],

    # --- Lawyer Agent intents ---
    "lawyer.company_formation": [
        r"\b(form (a |my )?company|start (a |my )?company|register (a |my )?(company|business|llc|ltd)|mersis|limited \u015eirket|anonim \u015eirket|incorporate|company formation)\b",
        r"(تأسيس شركة|انشاء شركة|فتح شركة|شركتي|تسجيل شركة|شركة ليمتد|محدودة|شركات)"
    ],
    "lawyer.contract_review": [
        r"\b(review (my )?contract|check (my )?contract|contract (clause|terms|dispute|issue)|nda|non.disclosure|service agreement|lease agreement)\b",
        r"(مراجعة عقد|عقود|عقد|تدقيق عقد|استشارة عقد|شروط العقد)"
    ],
    "lawyer.legal_timelines": [
        r"\b(how long (does|will)|timeline|time frame|how many (days|weeks)|duration|processing time|when will i).{0,40}(permit|company|contract|court|case|dispute|visa|ikamet|formation)\b",
        r"\b(company formation|contract review|work permit|residence permit|court case).{0,30}(take|long|weeks|days|months)\b",
        r"(كم تاخذ القضية|مدة المحكمة|كم وقت المحكمة|طول القضية|كم تاخذ وقت القضية)"
    ],
    "lawyer.real_estate": [
        r"\b(buy|sell|rent|purchase|lease) (a |my )?(house|property|apartment|flat|commercial|real estate|tapu)\b",
        r"\b(evict|eviction|rental increase|kiracı|ev sahibi|kira|tenant|landlord)\b",
        r"(عقار|شراء بيت|شقة|ايجار|طابو|اخلاء|مستأجر|مالك|طرد مستأجر|رفع ايجار)"
    ],
    "lawyer.employment_law": [
        r"\b(fired|dismissed|termination|severance|notice period|k[i\u0131]dem tazminat[i\u0131]|labour law|labor law|employment (law|issue|rights)|unfair dismissal|job (rights|dispute))\b",
        r"(طرد|فصلوني|تعويض|حقوق العمال|نهاية خدمة|قانون العمل|مسائل عمالية|الفصل التعسفي)"
    ],
    "lawyer.residence_permit": [
        r"\b(work permit|work visa|ikamet (ba\u015fvuru|application)|residence permit|stay in turkey legally|legal to work)\b",
        r"(تصريح عمل|اذن عمل|إقامة|اقامة عمل|فيزا عمل|اقامة سياحية|تجديد الاقامة)"
    ],
    "lawyer.dispute": [
        r"\b(dispute|lawsuit|sue|court|legal action|arabuluculuk|mediation|arbitration|claim against|ihtarname)\b",
        r"\b(i have|i got|i need help with) (a |an |my )?(case|problem|issue|situation)\b",
        r"\b(my rights|what are my rights|know my rights)\b",
        r"(نزاع|قضية|دعوى|محكمة|ارفع قضية|محامي|شكوى|منازعة)"
    ],
    "lawyer.dispute_defendant": [
        r"\b(against me|im being sued|i am being sued|they are suing me|defend|defendant)\b",
        r"\b(bana karşı|bana dava|dava açıldı|sanık|davalı)\b",
        r"(مرفوع ضدي|يشتكيني|رفع علي قضية|مدعى عليه|خصم)"
    ],
    "lawyer.dispute_plaintiff": [
        r"\b(someone else|against someone|i want to sue|i am suing|plaintiff|claim against them|suing someone)\b",
        r"\b(başkasına|başkalarına|dava açmak istiyorum|birine karşı|davacı)\b",
        r"(ارفع قضية على|بشتكي|مدعي|اشتكيت|ابغى ارفع قضية)"
    ],
    "lawyer.criminal_accused": [
        r"\b(accused|wrongly accused|suspect|arrested|detained|i was framed|suçlanıyorum|şüpheli)\b",
        r"(متهم|تهمة|مشتبه|احتجاز|موقوف|انظلمت|مسكوني)"
    ],
    "lawyer.criminal_victim": [
        r"\b(victim|reporting|i am reporting|to report|report a crime|someone did this|şikayet|mağdur|şikayetçi)\b",
        r"(ضحية|مبلغ|شكوى|انسرقت|تعرضت لـ|انصب علي)"
    ],
    "lawyer.criminal": [
        r"\b(police|arrest|arrested|criminal|charge|jail|prison|detained|prosecutor|savcı|karakol|suç)\b",
        r"(شرطة|مخفر|سجن|جنائي|نيابة|مدعي عام|مباحث|جناية|جريمة)"
    ],
    "lawyer.criminal_drugs": [
        r"\b(drug|drugs|narcotic|narcotics|weed|cocaine|hashish|trafficking|possession|uyuşturucu|madde|esrar|caught with)\b",
        r"(مخدرات|حشيش|كبتاغون|تعاطي|ترويج|حبوب)"
    ],
    "lawyer.criminal_theft": [
        r"\b(theft|steal|stole|robbery|fraud|scam|dolandır|hırsız|embezzlement)\b",
        r"(سرقة|نصب|احتيال|حرامي|نصاب|اختلاس|باقوني|سرقني)"
    ],
    "lawyer.criminal_violence": [
        r"\b(assault|fight|attacked|violence|hit me|injured|yaralama|darp|kavga|meşru müdafaa)\b",
        r"(اعتداء|ضرب|هوشة|مضاربة|عنف|طعن|اعتدى علي)"
    ],
    "lawyer.debt": [
        r"\b(debt|unpaid|invoice|money owed|icra|haciz|collection|bank account frozen|alacak)\b",
        r"(دين|فلوس|شيك|ديون|حجز|تجميد حساب|مطالبة مالية|كمبيالة|شيكات)"
    ],
    "lawyer.general_legal": [
        r"\b(legal (question|advice|help|guidance|issue|problem|situation|case)|turkish law|lawyer|attorney|need a lawyer|legal matter)\b",
        r"\b(i need|i want|looking for) (a |an )?(lawyer|legal|attorney|advice|help)\b",
        r"\b(can you help|help me|i have a question|legal question)\b",
        r"(استشارة قانونية|استشاره|محامي|سؤال قانوني|مشورة|استفسار قانوني|نصيحة قانونية)"
    ],
}
# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

def detect_intent(
    message: str,
    assistant_type: str = "permit",
) -> Tuple[Optional[str], Optional[str], float]:
    """
    Scan the message for keyword matches.
    """
    text = message.lower().strip()

    # Walk the intent map in priority order: 
    # 1. Global social/trust intents (greeting, trust, identity, farewell, thanks)
    # 2. Domain intents matching the assistant_type
    # 3. Other domain intents (which trigger redirects)
    # 4. Support/Billing intents
    
    def priority(item):
        key = item[0]
        # Global social/trust/identity/etc at the very top to prevent domain hijacking
        globals = {"greeting", "trust", "identity", "capabilities", "farewell", "thanks", "smalltalk"}
        if key in globals: return 0
        if key.startswith(f"{assistant_type}."): return 1
        return 2

    sorted_intents = sorted(INTENT_MAP.items(), key=priority)
    
    # 1. Check for very specific intent matches first (e.g. renew id)
    # 2. Prevent billing from matching if 'id' or 'kimlik' is present in student context
    for intent_key, patterns in sorted_intents:
        # Hijack Prevention: if student assistant and we see 'renew id', don't let billing win
        if assistant_type == "student" and intent_key == "billing.subscription":
            if re.search(r"\b(id|kimlik)\b", text):
                continue

        for pattern in patterns:
            if re.search(pattern, text, flags=re.IGNORECASE):
                parts = intent_key.split(".", 1)
                group = parts[0]
                sub = parts[1] if len(parts) > 1 else None

                # If a user asks a lawyer question inside the permit agent, catch it and redirect
                agent_domains = {"permit", "student", "lawyer"}
                if group in agent_domains and group != assistant_type:
                    return "redirect", f"{group}:{sub}" if sub else group, 1.0

                return group, sub, 1.0

    # 3. If no direct match found, try a greedy fuzzy match pass over the intent keys
    #    to catch typos in keywords like "isnyout" vs "is your"
    #    (threshold 0.75 for tight matching)
    from difflib import SequenceMatcher

    words = text.split()
    for intent_key, patterns in sorted_intents:
        # Check all patterns' literal words against input words
        for pattern in patterns:
            # Simple word-level fuzzy comparison for keywords buried in patterns
            # (Remove regex special chars from basic keyword checking)
            clean_pattern = re.sub(r'[\^$*+?{}[\]\\|()]', ' ', pattern)
            pattern_words = clean_pattern.split()
            
            for pw in pattern_words:
                if len(pw) < 5: continue
                for tw in words:
                    if len(tw) < 5: continue
                    # Similarity ratio
                    ratio = SequenceMatcher(None, tw, pw).ratio()
                    if ratio >= 0.85: # Stricter typo match
                        parts = intent_key.split(".", 1)
                        group = parts[0]
                        sub = parts[1] if len(parts) > 1 else None
                        
                        # Apply same redirection logic as regex
                        agent_domains = {"permit", "student", "lawyer"}
                        if group in agent_domains and group != assistant_type:
                            return "redirect", f"{group}:{sub}" if sub else group, 0.9
                            
                        return group, sub, 0.9

    # 4. Final last-resort specialized checks
    if any(w in words for w in ["right", "rightlj", "true", "accurate"]):
        return "trust", None, 0.8

    return None, None, 0.0
