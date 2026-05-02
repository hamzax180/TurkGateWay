"""
keyword_router.py
-----------------
Detects user intent using pure keyword matching — no AI required.
Returns (intent, sub_intent, confidence) tuple.
confidence = 1.0 for keyword match, 0.0 for no match (triggers AI fallback).
"""

import re
from typing import Tuple, Optional
from difflib import SequenceMatcher

# ---------------------------------------------------------------------------
# Keyword maps — ordered from most specific to least specific
# ---------------------------------------------------------------------------

INTENT_MAP = {
    "greeting": [
        r"\b(hi|hey|hello|good morning|good afternoon|good evening|howdy|sup|yo|merhaba|selam|günaydın|iyi günler)\b",
        r"(مرحبا|مرحباً|هلا|أهلا|أهلاً|سلام|السلام عليكم|صباح الخير|مساء الخير|كيف الحال)"
    ],
    "smalltalk": [
        r"\b(how are you|how do you do|hows it going|what's up|whats up|how are things|hows life|nasılsın|naber|nasıl gidiyor|how are u|how r u|hw r u|hw are u|how r uu|how are ytou)\b",
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
        r"\b(thank(s| you)|thx|cheers|nice|good|great|perfect|much appreciated|appreciate it)\b",
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
        r"\b(restaurant|restoran|lokanta|dinner|dining|food permit|yemek)\b",
        r"(مطعم|بوفيه|مأكولات|وجبات|مطاعم|مطعم صغير)"
    ],
    "permit.cafe": [
        r"\b(cafe|cafeteria|kafe|coffee shop|tea house|pastry shop|kahvehane)\b",
        r"(مقهى|كافيه|كافي|قهوة|محل عصير|كافتيريا)"
    ],
    "permit.clothing": [
        r"\b(clothing|clothes|apparel|boutique|garment|shoe|giyim|tekstil)\b",
        r"(ملابس|ازياء|أزياء|ملبوسات|بوتيك|أحذية|احذية|شنط|حقائب)"
    ],
    "permit.retail": [
        r"\b(retail|shop|store|market|grocery|bakkal|supermarket|ma[ğg]aza|d[üu]kkan)\b",
        r"(بقالة|سوبر ماركت|تموينات|محل|معرض|تجزئة|دكان)"
    ],
    "permit.office": [
        r"\b(office|consulting|agency|sanal ofis|ofis|b[üu]ro|headquarters|coworking)\b",
        r"(مكتب|مقر|شركة (عقارات|استشارات)|وكالة|استشارات|سياحة|مكاتب)"
    ],
    "permit.barber": [
        r"\b(barber|hair salon|beauty|kuaf[öo]r|berber|g[üu]zellik|spa|nail salon|kuafor)\b",
        r"(حلاق|صالون|كوافير|تجميل|عناية|سبا|مشغل)"
    ],
    "permit.gym": [
        r"\b(gym|fitness|crossfit|spor|sports center|pilates|yoga studio)\b",
        r"(نادي|صالة رياضية|جيم|حديد|كروسفيت|نادي رياضي)"
    ],
    "permit.pharmacy": [
        r"\b(pharmacy|eczane|chemist|drug store|medicine shop|ilaç)\b",
        r"(صيدلية|ادوية|أدوية|عطارة|اعشاب)"
    ],
    "permit.bakery": [
        r"\b(bakery|f[ıi]r[ıi]n|bread|pastanesi|ekmek|börek)\b",
        r"(مخبز|فرن|حلويات|مخبوزات|فطائر|معجنات)"
    ],
    "permit.hotel": [
        r"\b(hotel|otel|hostel|pansiyon|guesthouse|accommodation|konaklama|apart otel)\b",
        r"(فندق|نزل|موتيل|استراحة|شقق فندقية)"
    ],
    "permit.clinic": [
        r"\b(clinic|klinik|medical (center|centre)|dental|doktor|doctor|veteriner|poliklinik)\b",
        r"(عيادة|مستوصف|مركز طبي|طبيب|أسنان|بيطري)"
    ],
    "permit.school": [
        r"\b(school|okul|dershane|kurs|eğitim merkezi|language school|tutoring|çocuk kulübü)\b",
        r"(مدرسة|مركز تعليمي|دروس خصوصية|كورسات|دار حضانة)"
    ],
    "permit.restaurant_typo": [
        r"\b(resteruant|resteraunt|restarant|restuarant|resturant|restrant|restruant|restaurent|restaurnt)\b"
    ],
    "permit.cafe_typo": [
        r"\b(caffe|cafee|cafetaria|cafeterya|coffe shop|coffe|coffeshop|cofee|cofffee|kahve dukkan)\b"
    ],

    "permit.how_to_start": [
        r"\b(how (do i|to) (start|open|begin|register|set up)|starting a business|open a business|open my business|new business|open business)\b",
        r"\b(i want to (open|start|register|set up)|what business (do i|you) want|obtain a business permit|i want to obtain|get permits)\b",
        r"\b(what business|which business|type of business|hangi i[şs]|ne i[şs]|nasıl başlarım|is kurmak|iş kurmak|işletme aç|izin al)\b",
        r"^(what permit do you want\??)$",
        r"^(what business (you|do you) want to open\??)$",
        r"(كيف أبدأ|اريد فتح|أريد فتح|كيف افتح|فتح محل|فتح شركة(?! استشارات)|كيف أبدا|تأسيس|أريد تأسيس|انشاء شركة|بدء مشروع|ودي افتح|فتح عمل|الحصول على تصريح)"
    ],
    "correction": [
        r"\b(i (said|meant|mean)|it (was|is)|actually|no (it's|its|it is)|not (x|y) it('s| is)|i was (saying|referring)|correction|i corrected|wrong( district| type)?|i said)\b",
        r"\b(it was|i meant|i said|no it|not that|i mean|actually it)\b",
        r"(قصدي|قصدت|أقصد|لا قصدي|المقصود|يعني|بالضبط|أصلح|تصحيح|أعني)"
    ],
    "permit.documents": [
        r"\b(what documents|required docs|document(s)? needed|paperwork|what do i need to bring|belge|what do i need|evrak|gerekli belgeler)\b",
        r"\b(documents (do i|needed|required)|need (for|to open)|checklist|what to bring|required (docs|papers))\b",
        r"^(what documents do i need\??)$",
        r"(المستندات|الوثائق|الاوراق|الأوراق المطلوبة|ماذا احتاج|المطلوب|ايش الاوراق|شنو الاوراق|ايش المطلوب|شنو المطلوب)"
    ],
    "permit.cost": [
        r"\b(permit cost|permit fee|registration (fee|cost)|total cost|business (cost|price)|maliy(et)?|maliyetler|kaç (lira|tl|para))\b",
        r"\b(how much does the permit cost)\b",
        r"^(how much does it cost\??)$",
        r"(تكاليف الرخصة|رسوم الرخصة|كم ادفع للرخصة|كم تكلفة التصريح)"
    ],
    "permit.location": [
        r"\b(district|belediye|which (district|area|municipality)|hangi ilçe|ilçe kuralları|business location)\b",
        r"\b(where|which|location|district).{0,20}(besiktas|kadikoy|sisli|uskudar|fatih|beyoglu|bakirkoy|zeytinburnu|sariyer|beyo[gğ]lu|be[sş]ikta[sş])\b",
        r"^(where is your business located\??)$",
        r"(اي بلدية|أي منطقة|وين البلدية|في أي منطقة|قواعد المنطقة)"
    ],
    "permit.how_it_works": [
        r"\b(how does the permit work|how it works for business|how (does|do) (the )?(business|permit) work|nasıl çalışıyor)\b",
        r"\b(permit process overview|general permit guide|business process guide)\b",
        r"^(how does permit work\??)$",
        r"(كيف تعمل الرخصة|اشرح لي رخصة العمل|كيف تتم عملية البلدية|كيف الإجراء للمحلات)"
    ],
    "permit.timeline": [
        r"\b(permit timeline|permit time frame|when will the permit|how many days for permit|permit duration|ruhsat ne kadar s[üu]r|ruhsat kaç gün)\b",
        r"\bHow long does the permit take\b",
        r"^(how long does the permit take\??)$",
        r"(كم تستغرق الرخصة|مدة الرخصة|كم تأخذ الرخصة وقت|جداول الرخصة الزمنية)"
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
        r"\b(permit steps|business process|permit procedure|what are the permit steps|14 steps|ruhsat adımlar|ruhsat süreç)\b",
        r"(خطوات الرخصة|ما هي خطوات العمل|سير عمل الرخصة)"
    ],
    "permit.nace": [
        r"\b(nace|nace code|business code|sector code|activity code|faaliyet kodu)\b",
        r"(كود|نشاط|نزه|نص|نية|نیس|رمز نشاط|NACE)"
    ],
    "permit.tax_id": [
        r"\b(tax id|vergi (numarası|no)|tax number|tax registration|tax office|vergi dairesi)\b",
        r"(رقم ضريبي|ضريبة|ضرائب|الرقم الضريبي|دائرة الضرائب)"
    ],
    "permit.support": [
        r"\b(🆘|help|support|contact support|customer service|need help)\b",
        r"(مساعدة|دعم|تواصل|🆘)"
    ],


    # --- Student Agent intents ---
    "student.renew_id": [
        r"\b(renew (my )?(student|uni|university|campus) (id|kimlik|card)|(student|uni) id renewal|expired (student id|uni id)|replace (my )?(student|uni) (id|card))\b",
        r"(تجديد [اأ]?ل?هوي[ةه] [اأ]?ل?جامعي[ةه]|تجديد بطاق[ةه] [اأ]?ل?جامع[ةه]|بطاق[ةه] طالب|هوي[ةه] طالب|تجديد [اأ]?ل?كارنيه [اأ]?ل?جامعي)"
    ],
    "student.kimlik_lost": [
        r"\b(lost (my )?(kimlik|student id|id card)|stolen (kimlik|card)|missing (kimlik|id))\b",
        r"(ضاع|فقدت|ضياع|انسرق|مفقود) (هوية|بطاقة|كيملك|كملك|كارت|كارت الجامعة)"
    ],
    "student.register_uni": [
        r"\b(how (to|do i|can i|should i) (register|enroll|apply)|university (registration|enrollment|enrolment)|academic help|academic support|enroll (at|in)|register (at|for|to|in) (a |my )?(university|uni)|yoks[i\u0131]s|roadmap|registration process|uni registration|how to enroll|register to uni|register at uni|register for uni)\b",
        r"(تسجيل (جامعة|في الجامعة)|تقديم على (جامعة|الجامعة)|قبول جامعي|كيف اسجل بالجامعة|كيف سجل بالجامعة|كيف اسجل|كيف اسجل في الجامعة|كيف اقدم|قيد جامعة|تسجيل جامعي|خارطة طريق|خريطة طريق)"
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
        r"\b(student (residence|ikamet)|ikamet (permit|renewal|application|izni)|residence permit (renewal|for student|extension)|g[o\xf6]\xc3\xa7 idaresi|goc idaresi|migration (office|permit))\b",
        r"(اقامة طالب|إقامة طالب|تجديد الاقامة|اقامة|الاقامة الطلابية|تجديد الكملك|تجديد الإقامة)"
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
    "student.deadlines": [
        r"\b(deadline|deadlines|when (does|do) (application|registration|enrollment) (end|close)|son ba\u015fvuru|last day)\b",
        r"(موعد|مواعيد|متى ينتهي|اخر موعد|آخر موعد|متى يغلق|نهاية التسجيل)"
    ],
    "student.visa": [
        r"\b(visas?|student visas?|vize|ogrenci vizesi|[o\u0131g]renci vizesi)\b",
        r"(فيزا|تأشيرة|تاشيرة|تأشيرة طالب|فيزا طالب|فيزة)"
    ],
    "student.work_rules": [
        r"\b(can i work|work permit for student|student jobs|part time|part-time|working while studying|legal to work)\b",
        r"(شغل|الشغل|العمل|هل مسموح اشتغل|عمل كطالب|دوام جزئي|وظيفة طالب)"
    ],
    "student.language_courses": [
        r"\b(learn turkish|turkish course|tomer|tömer|language school|language center|turkish classes)\b",
        r"(تعلم تركي|تومر|كورس تركي|معهد لغات|لغة تركية|دراسة لغة)"
    ],
    "student.shelp": [
        r"\b(🆘|help|support|student help|help student|help me with student|i need student help)\b",
        r"(مساعدة الطالب|مساعدة|🆘)"
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
        r"\b(drug|drugs|narcotic|narcotics|weed|cocaine|hashish|trafficking|possession|uyuşturucu|madde|esrar|caught (with|wit)|zaza)\b",
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
    "lawyer.support": [
        r"\b(🆘|help|support|contact support|customer service|need help)\b",
        r"(مساعدة|دعم|تواصل|🆘)"
    ],
}

# ---------------------------------------------------------------------------
# Pre-compile Regexes for 0ms Latency
# ---------------------------------------------------------------------------
COMPILED_INTENT_MAP = {
    key: [re.compile(p, flags=re.IGNORECASE) for p in patterns]
    for key, patterns in INTENT_MAP.items()
}
# ---------------------------------------------------------------------------
# Public function
# ---------------------------------------------------------------------------

def detect_intent(
    message: str,
    assistant_type: str = "permit",
    context_text: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str], float]:
    """
    Scan the message for keyword matches.
    If context_text is provided, it's weighted to help resolve ambiguous queries (e.g. "from riyadh" + context "visa").
    """
    text = message.lower().strip()
    
    # Context Augmentation: If query is short, boost it with context clues
    # GUARD: Skip context injection when user's raw query clearly signals a NEW topic
    # to prevent stale context (e.g. visa) from polluting new intents (e.g. registration)
    _new_topic_signals = ["register", "enroll", "apply to", "university", "uni ", "uni?",
                          "company", "contract", "formation", "open a", "start a"]
    _has_new_topic = any(s in text for s in _new_topic_signals)
    
    if context_text and len(text.split()) < 10 and not _has_new_topic:
        # Extract potential domain keywords from context (assistant output)
        # We only take the most relevant markers to avoid pollution
        context_lower = context_text.lower()
        clues = []
        if "consulate" in context_lower or "embassy" in context_lower or "visa" in context_lower: clues.append("visa")
        if "roadmap" in context_lower or "register" in context_lower: clues.append("register")
        if "insurance" in context_lower or "sigorta" in context_lower: clues.append("insurance")
        if "ikamet" in context_lower or "permit" in context_lower: clues.append("residence permit")
        
        if clues:
            augmented_text = f"{' '.join(clues)} {text}"
            print(f"[KeywordRouter] Context Clues: {clues} -> Augmented: '{augmented_text}'")
            text = augmented_text

    # Phonetic/Shorthand Normalization
    normalization_map = {
        r"\bu\b": "you",
        r"\br\b": "are",
        r"\bytou\b": "you",
        r"\byu\b": "you",
        r"\bhow r uu\b": "how are you",
        r"\bhow r u\b": "how are you",
        r"\bhw r u\b": "how are you",
        r"\bhw r uu\b": "how are you",
        r"\bhow are ytou\b": "how are you",
        r"\bhow r ytou\b": "how are you",
        r"\bn\b": "and",
        r"\bthx\b": "thanks",
        r"\bur\b": "your",
        r"\bplz\b": "please",
    }
    
    for pattern, replacement in normalization_map.items():
        text = re.sub(pattern, replacement, text)

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

    sorted_intents = sorted(COMPILED_INTENT_MAP.items(), key=priority)
    
    candidates = []

    # Pass 1: Strict Regex Matches (Confidence 1.0)
    for intent_key, compiled_patterns in sorted_intents:
        if assistant_type == "student" and intent_key == "billing.subscription":
            if re.search(r"\b(id|kimlik)\b", text): continue

        for compiled_pattern in compiled_patterns:
            if compiled_pattern.search(text):
                parts = intent_key.split(".", 1)
                group, sub = parts[0], (parts[1] if len(parts) > 1 else None)
                
                # Priority: If it matches the CURRENT assistant domain or is GLOBAL, return immediately
                if group == assistant_type or group in {"greeting", "trust", "smalltalk", "thanks", "farewell", "identity", "capabilities"}:
                    return group, sub, 1.0
                
                # Otherwise, store it as a redirection candidate
                candidates.append((group, sub, 1.0))

    # Pass 2: Fuzzy Logic Typos (Confidence 0.7 - 0.95)
    words = text.split()
    
    # Ignore common verb/phrase tokens from fuzzy matching to prevent false positives
    stop_words = {
        "what", "whats", "what's", "when", "where", "which", "know", "take", "long", "tell", "need", 
        "some", "want", "have", "with", "this", "that", "from", "your", "does", "will", 
        "hows", "about", "like", "make", "work", "just", "time", "sure", "right", 
        "correct", "true", "accurate", "help", "good", "great", "perfect"
    }
    
    for intent_key, _ in sorted_intents:
        original_patterns = INTENT_MAP[intent_key]
        for pattern in original_patterns:
            clean_pattern = re.sub(r'[\^$*+?{}[\]\\|()]', ' ', pattern)
            pattern_words = clean_pattern.split()
            
            for pw in pattern_words:
                pw_lower = pw.lower()
                if len(pw_lower) < 4: continue
                if pw_lower in stop_words: continue
                
                for tw in words:
                    tw_lower = tw.lower()
                    if len(tw_lower) < 4: continue
                    if tw_lower in stop_words: continue
                    
                    ratio = SequenceMatcher(None, tw_lower, pw_lower).ratio()
                    
                    if ratio == 1.0: continue # Exact word match out-of-context, skip it
                    
                    # Tighten threshold for short words to prevent 'nice' matching 'notice' (0.8)
                    min_ratio = 0.85 if len(tw) <= 4 else 0.80
                    if ratio >= min_ratio:
                        parts = intent_key.split(".", 1)
                        group, sub = parts[0], (parts[1] if len(parts) > 1 else None)
                        
                        # Weighting: current assistant domain gets a boost
                        score = ratio
                        if group == assistant_type: score += 0.05
                        
                        candidates.append((group, sub, min(score, 0.95)))

    # If we have candidates, pick the "Correctest" (highest confidence)
    if candidates:
        # Sort by confidence descending
        candidates.sort(key=lambda x: x[2], reverse=True)
        best_group, best_sub, best_conf = candidates[0]
        
        # Redirection logic
        agent_domains = {"permit", "student", "lawyer"}
        if best_group in agent_domains and best_group != assistant_type:
            return "redirect", f"{best_group}:{best_sub}" if best_sub else best_group, best_conf
            
        return best_group, best_sub, best_conf

    # Pass 3: Hard-coded fallback keywords
    if any(w in words for w in ["right", "correct", "true", "accurate"]):
        return "trust", None, 0.8

    return None, None, 0.0
