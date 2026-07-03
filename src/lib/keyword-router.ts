/**
 * keyword-router.ts
 * Pure intent detection — no API calls, no tokens.
 * Ported from backend/smart_router/keyword_router.py
 */

type IntentPatterns = Record<string, RegExp[]>;

// ---------------------------------------------------------------------------
// Intent pattern map — ported from Python INTENT_MAP
// ---------------------------------------------------------------------------
const INTENT_MAP: IntentPatterns = {
  // Social
  greeting: [
    /\b(hi|hey|hello|good morning|good afternoon|good evening|good night|howdy|sup|yo|hiya|hey there|hi there|hello there|what's good|whats good|merhaba|selam|günaydın|iyi günler|iyi akşamlar|iyi geceler)\b/i,
    /(مرحبا|مرحبا|هلا|اهلا|اهلين|هلو|هاي|سلام|سﻻم|السلام عليكم|صباح الخير|مساء الخير|صباح النور|يا هلا|حياك|حياك الله|هلا والله)/,
  ],
  smalltalk: [
    /\b(how are you|how are u|how r u|how do you do|how you doing|how u doing|how r u doing|how are you doing|how have you been|how've you been|how u been|hows it going|how's it going|how is it going|what's up|whats up|how are things|you good|u good|you okay|you alright|you well|how's life|how is life|how's everything|nasılsın|naber|nasıl gidiyor|ne var ne yok)\b/i,
    // Lenient / typo-tolerant — NO trailing \b so "doingg", "doin", "doin'" still match.
    /\bhow\s*(are|r)?\s*(you|u|ya|yu)\s*(doin|doing|goin|going|feelin|feeling|holdin|been)/i, // how you doing(g), how u been
    /\bhow\s*(are|r)\s*(you|u|ya|yu)\b/i,                                                      // how are you / how r u
    /\bhow'?s\s*(it|things|life|everything|ur\s*day|your\s*day)\b/i,                           // how's it / how's life
    /\b(wh?at'?s*\s*up|wassup|wasup|wagwan|sup|how'?s\s*it\s*(going|goin|hangin))\b/i,         // wassup / sup / how's it going
    /^(am|i'?m)\s+(great|good|fine|alright|okay|well|awesome|fantastic|not bad|doing well|doing fine|doing great|doing good|doing okay)\b/i,
    /^doing\s+(well|great|good|fine|okay|fantastic|awesome)\b/i,
    // Arabic incl. Gulf/Levant/Egyptian dialects (matched against alef-normalized text too)
    /(كيف حالك|كيف الحال|كيف الامور|كيف الاحوال|شو اخبارك|شو الاخبار|الاخبار|اخبارك|اخباركم|شخبارك|شخبار|وش اخبارك|ايش اخبارك|شلونك|شلونكم|كيفك|كيفكم|عامل ايه|عامله ايه|ازيك|ازايك|عساك بخير|كيف صحتك)/,
  ],
  identity: [
    /\b(who are you|what are you|what is this|what do you do|your name|tell me about yourself|introduce yourself|what can you do|what do you help with)\b/i,
    /(من أنت|مين انت|ايش اسمك|من تكون|عرف عن نفسك|ماذا تفعل)/,
  ],
  farewell: [
    /\b(bye|goodbye|see you|see ya|later|take care|cya|farewell|catch you later|ttyl|gotta go|i'm off|peace out|night|good night|goodnight|till next time)\b/i,
    /(مع السلامة|مع السﻻمه|باي|باى|وداعا|وداعاً|في امان الله|الى اللقاء|بالسلامة|بالسﻻمه|يلا باي|تصبح على خير|الله معك|نشوفك)/,
  ],
  thanks: [
    /\b(thank(s| you)|thx|ty|tysm|cheers|much appreciated|appreciate it|thank u|thanks a lot|thanks so much|many thanks|big thanks|ta|grateful)\b/i,
    /(شكرا|شكرا جزيلا|يعطيك العافية|الله يعطيك العافية|تسلم|تسلم ايدك|مشكور|ما قصرت|ممتن|الف شكر|يسلمو|مشكورين)/,
  ],
  trust: [
    /\b(is (your )?(answer|response) (right|correct|true|accurate)|are you (sure|right|correct|certain)|is this (true|real|accurate)|can i trust|is this legit)\b/i,
    /(هل انت متأكد|متأكد|أكيد|هل هذا صحيح|صح|موثوق)/,
  ],



  // --- Permit specific questions (evaluate first) ---
  'permit.documents': [
    /\b(what documents|required docs|document(s)? needed|paperwork|what do i need to bring|belge|what do i need|evrak)\b/i,
    /\bdocuments (do i|needed|required)\b/i,
    /(المستندات|الوثائق|الاوراق|الأوراق المطلوبة|ماذا احتاج|المطلوب)/,
  ],
  'permit.cost': [
    /\b(permit cost|permit fee|registration (fee|cost)|total cost|business (cost|price)|kaç (lira|tl|para))\b/i,
    /\bhow much does (the permit|it|a business|opening) cost\b/i,
    /\bhow much (will it cost|does it cost|would it cost|is the cost|are the fees)\b/i,
    /\b(cost to open|cost of opening|cost to start|opening cost|budget (for|to open))\b/i,
    /(تكاليف الرخصة|رسوم الرخصة|كم ادفع للرخصة|كم تكلف|كم سيكلف|ما تكلفة)/,
  ],
  'permit.timeline': [
    /\b(permit timeline|permit time frame|how many days for permit|permit duration|how long does the permit take)\b/i,
    /\bhow long (does it|will it|would it|does the process) (take|last)\b/i,
    /\b(how many days|how many weeks|processing time|turnaround time)\b/i,
    /(كم تستغرق الرخصة|مدة الرخصة|كم تأخذ الرخصة وقت|كم يستغرق)/,
  ],
  'permit.foreigner': [
    /\b(can a foreigner|foreigner(s)? (open|start|run|own)|foreign national|foreign ownership|as a foreigner|non-turkish (citizen|national))\b/i,
    /\b(yabancı (açabilir|işletme|ruhsat)|foreigner (business|permit|company))\b/i,
    /(أجنبي|للأجانب|هل يمكن للأجنبي|تملك أجنبي|رخصة للأجانب)/,
  ],
  'permit.alcohol': [
    /\b(alcohol|tapdk|liquor|wine|beer|bar|spirits|drinks? permit)\b/i,
    /(كحول|شرب|بار|خمر|خمور|مشروبات كحولية)/,
  ],
  'permit.music': [
    /\b(music|live music|band|entertainment permit|canl[iı] m[uü]zik)\b/i,
    /(موسيقى|حفلات|فرقة|طرب|غناء|دي جي)/,
  ],
  'permit.steps': [
    /\b(permit steps|business process|permit procedure|what are the permit steps|14 steps|how many steps)\b/i,
    /(خطوات الرخصة|ما هي خطوات العمل)/,
  ],
  'permit.nace': [
    /\b(nace|nace code|business code|sector code|activity code|faaliyet kodu)\b/i,
    /(كود|نشاط|رمز نشاط|NACE)/,
  ],
  'permit.tax_id': [
    /\b(tax id|vergi (numarası|no)|tax number|tax registration|tax office|vergi dairesi)\b/i,
    /(رقم ضريبي|ضريبة|الرقم الضريبي|دائرة الضرائب)/,
  ],
  'permit.support': [
    /^(🆘|help|support)$/i,
    /(مساعدة|دعم|🆘)/,
  ],
  'permit.how_it_works': [
    /\b(how does the permit work|how it works for business|permit process overview)\b/i,
    /(كيف تعمل الرخصة|اشرح لي رخصة العمل)/,
  ],
  'permit.location': [
    /\b(district|belediye|which (district|area|municipality)|hangi ilçe|business location)\b/i,
    /(اي بلدية|أي منطقة|في أي منطقة)/,
  ],

  // --- Permit business types ---
  'permit.restaurant': [
    /\b(restaurant|restoran|lokanta|dinner|dining|food permit|yemek)\b/i,
    /(مطعم|بوفيه|مأكولات|وجبات|مطاعم)/,
  ],
  'permit.cafe': [
    /\b(cafe|cafeteria|kafe|coffee shop|tea house|pastry shop|kahvehane)\b/i,
    /(مقهى|كافيه|كافي|قهوة|محل عصير|كافتيريا)/,
  ],
  'permit.clothing': [
    /\b(clothing|clothes|apparel|boutique|garment|shoe|giyim|tekstil)\b/i,
    /(ملابس|ازياء|أزياء|ملبوسات|بوتيك|أحذية)/,
  ],
  'permit.retail': [
    /\b(retail|shop|store|market|grocery|bakkal|supermarket|ma[ğg]aza|d[üu]kkan)\b/i,
    /(بقالة|سوبر ماركت|تموينات|محل|معرض|تجزئة|دكان)/,
  ],
  'permit.office': [
    /\b(office|consulting|agency|sanal ofis|ofis|b[üu]ro|headquarters|coworking)\b/i,
    /(مكتب|مقر|وكالة|استشارات|سياحة|مكاتب)/,
  ],
  'permit.barber': [
    /\b(barber|hair salon|beauty|kuaf[öo]r|berber|g[üu]zellik|spa|nail salon)\b/i,
    /(حلاق|صالون|كوافير|تجميل|عناية|سبا|مشغل)/,
  ],
  'permit.gym': [
    /\b(gym|fitness|crossfit|spor|sports center|pilates|yoga studio)\b/i,
    /(نادي|صالة رياضية|جيم|حديد|كروسفيت)/,
  ],
  'permit.pharmacy': [
    /\b(pharmacy|eczane|chemist|drug store|medicine shop|ilaç)\b/i,
    /(صيدلية|ادوية|أدوية|عطارة)/,
  ],
  'permit.bakery': [
    /\b(bakery|f[ıi]r[ıi]n|bread|pastanesi|ekmek|börek)\b/i,
    /(مخبز|فرن|حلويات|مخبوزات|فطائر)/,
  ],
  'permit.hotel': [
    /\b(hotel|otel|hostel|pansiyon|guesthouse|accommodation|konaklama)\b/i,
    /(فندق|نزل|موتيل|استراحة|شقق فندقية)/,
  ],
  'permit.clinic': [
    /\b(clinic|klinik|medical (center|centre)|dental|doctor|veteriner|poliklinik)\b/i,
    /(عيادة|مستوصف|مركز طبي|طبيب|أسنان|بيطري)/,
  ],
  'permit.how_to_start': [
    /\b(how (do i|to) (start|open|begin|register|set up)|starting a business|open a business|new business)\b/i,
    /\b(i want to (open|start|register|set up)|get permits|what business)\b/i,
    /(كيف أبدأ|اريد فتح|أريد فتح|كيف افتح|فتح محل|فتح شركة|كيف أبدا|تأسيس|بدء مشروع)/,
  ],

  // --- Student intents ---
  'student.renew_id': [
    /\b(renew (my )?(student|uni|university|campus) (id|kimlik|card)|(student|uni) id renewal|expired (student id|uni id))\b/i,
    /\b(get (a |an |my )?(new |student )?(id|kimlik)|want (a |my )?(kimlik)|need (a |an )?(kimlik|student id)|apply (for|to) (a |an |my )?(kimlik|student id)|get kimlik|new kimlik)\b/i,
    /\b(wanna (get|apply|have) (a |an |my )?(id|kimlik|student id)|gonna (get|apply) (a |an )?(id|kimlik))\b/i,
    /\b(apply (for|to) (my |an |a )?id\b|i (need|want|wanna|gotta) (a |an |my )?(id|kimlik))\b/i,
    /(تجديد الهوية الجامعية|تجديد بطاقة الجامعة|بطاقة طالب|هوية طالب|الحصول على كيملك)/,
  ],
  'student.kimlik_lost': [
    /\b(lost (my )?(kimlik|student id|id card)|stolen (kimlik|card)|missing (kimlik|id))\b/i,
    /(ضاع|فقدت|ضياع|انسرق|مفقود).{0,10}(هوية|بطاقة|كيملك)/,
  ],
  'student.register_uni': [
    /\b(how (to|do i|can i) (register|enroll|apply)|university (registration|enrollment)|enroll (at|in)|register (at|for|to|in) (a |my )?(university|uni)|yoks[iı]s|roadmap|registration process)\b/i,
    /(تسجيل (جامعة|في الجامعة)|قبول جامعي|كيف اسجل بالجامعة|تسجيل جامعي|خارطة طريق)/,
  ],
  'student.top_universities': [
    /\b(top (10|ten|universities)|best university|best universities|which university|university (list|ranking))\b/i,
    /(أفضل الجامعات|احسن جامعة|ترتيب الجامعات|اي جامعة تنصحني)/,
  ],
  'student.health_insurance': [
    /\b(health insurance|sgk|sa[gğ]l[iı]k sigorta|student insurance|medical coverage)\b/i,
    /(تأمين طبي|تأمين صحي|SGK|تأمين الطالب|سيكورتا|التأمين)/,
  ],
  'student.residence_permit': [
    /\b(student (residence|ikamet)|ikamet (permit|renewal|application|card)|residence permit (renewal|for student|extension)|g[oö][cç] idaresi|migration (office|permit))\b/i,
    /\b(how (do i|to) (apply|get|obtain) (for |)(ikamet|residence permit|student permit))\b/i,
    /\b(apply (for|to) ikamet|get ikamet|ikamet (application|process|steps|documents|docs|requirements)|what do i need for ikamet)\b/i,
    /\b(ikamet|ikamett|residence card|residency card)\b/i,
    /\b(wanna (get|apply|have) (a |an |my )?(ikamet|residence permit)|i (need|want|wanna) (a |an |my )?(ikamet|residence permit))\b/i,
    // Both ة (ta marbuta) and ه (ha) forms — users write both variants colloquially.
    // normalizeArabic() folds ة→ه on the query side, but patterns are pre-compiled,
    // so we list both forms explicitly here.
    /(اقام[هة] طالب|إقام[هة] طالب|تجديد الاقام[هة]|اقام[هة]|الاقام[هة]|الاقامة الطلابية|ما هي أوراق الإقام[هة]|ابغا.{0,10}اقام[هة]|اريد.{0,10}اقام[هة])/,
  ],
  'student.yoksis': [
    /\b(yöksİs|yöksis|yoksis|yöks[iı]s|yoks[iı]s|higher education system|student information system|öğrenci bilgi sistemi|obs|student portal)\b/i,
    /(يوكسيس|نظام التعليم العالي|بوابة الطالب)/,
  ],
  'student.transport_card': [
    /\b(istanbulkart|transport card|student card|bus card|travel card|metro card|discount card)\b/i,
    /(كرت مواصلات|بطاقة مواصلات|اسطنبول كارت|كرت باص|مواصلات)/,
  ],
  'student.dormitory': [
    /\b(dormitory|dorm|yurt|kyk|housing|accommodation|where to stay|student housing)\b/i,
    /(سكن|سكن طلاب|سكن جامعي|عمارة طلاب|يورت|وين اسكن)/,
  ],
  'student.equivalency': [
    /\b(equivalency|denklik|diploma recognition|high school equivalency|y[oö]k denklik)\b/i,
    /(تعديل شهادة|دنكلك|معادلة|معادلة شهادة|دنكليك)/,
  ],
  'student.scholarships': [
    /\b(scholarship|scholarships|burs|turkiye burslari|ytb|financial aid|tuition funding)\b/i,
    /(منحة|منح|المنحة التركية|منحة دراسية|مساعدة مالية)/,
  ],
  'student.visa': [
    /\b(visas?|student visas?|vize|ogrenci vizesi)\b/i,
    /(فيزا|تأشيرة|تاشيرة|تأشيرة طالب|فيزا طالب)/,
  ],
  'student.work_rules': [
    /\b(can i work|work permit for student|student jobs|part time|part-time|working while studying)\b/i,
    /(شغل|الشغل|العمل|هل مسموح اشتغل|عمل كطالب|دوام جزئي)/,
  ],
  'student.documents': [
    /\b(student documents|what documents for (university|uni|registration)|required for (university|enrollment))\b/i,
    /(أوراق الجامعة|مستندات التقديم|ايش مطلوب للجامعة)/,
  ],
  'student.deadlines': [
    /\b(deadline|deadlines|when (does|do) (application|registration|enrollment) (end|close)|last day)\b/i,
    /(موعد|مواعيد|متى ينتهي|اخر موعد|نهاية التسجيل)/,
  ],
  'student.language_courses': [
    /\b(learn turkish|turkish course|tomer|t[oö]mer|language school|turkish classes)\b/i,
    /(تعلم تركي|تومر|كورس تركي|لغة تركية)/,
  ],
  'student.shelp': [
    /\b(student help|help student|help me with student|i need student help)\b/i,
    /(مساعدة الطالب)/,
  ],

  // --- Lawyer intents ---
  'lawyer.company_formation': [
    /\b(form (a |my )?company|start (a |my )?company|register (a |my )?(company|business|llc|ltd)|mersis|limited [şs]irket|company formation|incorporate)\b/i,
    /\b(minimum capital|share capital|starting capital|capital requirement|how much capital|minimum (investment|money) (to|for) (start|form|register))\b/i,
    /\b(ltd [şs]irket|anonim [şs]irket|llc in turkey|set up (a |my )?(company|ltd|business))\b/i,
    /(تأسيس شركة|انشاء شركة|فتح شركة|تسجيل شركة|شركة ليمتد|رأس المال|الحد الأدنى لرأس المال)/,
  ],
  'lawyer.contract_review': [
    /\b(review (my )?contract|check (my )?contract|contract (clause|terms|dispute|issue)|nda|non.?disclosure|service agreement|lease agreement)\b/i,
    /(مراجعة عقد|عقود|عقد|تدقيق عقد|استشارة عقد)/,
  ],
  'lawyer.employment_law': [
    /\b(fired|dismissed|termination|severance|notice period|k[iı]dem tazminat[iı]|labour law|labor law|employment (law|issue|rights)|unfair dismissal)\b/i,
    /(طرد|فصلوني|تعويض|حقوق العمال|نهاية خدمة|قانون العمل)/,
  ],
  'lawyer.real_estate': [
    /\b(buy|sell|rent|purchase|lease) (a |my )?(house|property|apartment|flat|commercial|real estate|tapu)\b/i,
    /\b(evict|eviction|rental increase|kira|tenant|landlord)\b/i,
    /(عقار|شراء بيت|شقة|ايجار|طابو|اخلاء|مستأجر|مالك)/,
  ],
  'lawyer.residence_permit': [
    /\b(work permit|work visa|ikamet (ba[şs]vuru|application)|residence permit|stay in turkey legally)\b/i,
    /(تصريح عمل|اذن عمل|إقامة|اقامة عمل|فيزا عمل)/,
  ],
  'lawyer.general_legal': [
    /\b(legal help|lawyer|law question|attorney|legal advice|solicitor|advocate)\b/i,
    /(محامي|استشارة قانونية|سؤال قانوني|محاماة|قانون|مستشار قانوني)/,
  ],
  'lawyer.dispute': [
    /\b(legal dispute|lawsuit|mediation|arabuluculuk|ihtarname|file a claim|take to court|sue (someone|my|the))\b/i,
    /(نزاع|خلاف|دعوى|محكمة|قضية|مطالبة|تقاضي)/,
  ],
  'lawyer.legal_timelines': [
    /\b(how long does a court case take|how long does the legal process take|court timeline|mediation timeline|how many (months|years))\b/i,
    /(كم تستغرق المحكمة|مدة القضية|كم تأخذ القضية وقت)/,
  ],
  'lawyer.criminal': [
    /\b(police|arrest|arrested|criminal|charge|jail|prison|detained|prosecutor|drug|drugs|theft|robbery|fraud|assault|violence)\b/i,
    /(شرطة|اعتقال|تهمة|سجن|مخدرات|سرقة|احتيال|اعتداء)/,
  ],
  'lawyer.debt': [
    /\b(debt|unpaid|invoice|money owed|icra|haciz|collection)\b/i,
    /(دين|مطلوبات|فاتورة غير مدفوعة|تحصيل|حجز|إعسار)/,
  ],
  'lawyer.support': [
    /\b(legal help|legal advice|lawyer|need a lawyer)\b/i,
    /(مساعدة قانونية|مشورة قانونية|محامي|أحتاج محامي)/,
  ],

  // --- Billing and Support (Evaluate last) ---
  'billing.price': [
    /\b(price|pricing|cost|how much|fee|fees|plan|plans|subscription cost|what does it cost)\b/i,
    /(سعر|اسعار|تكلفة|رسوم|كم السعر|الاشتراك|بكم)/,
  ],
  'billing.subscription': [
    /\b(subscription|cancel|upgrade|downgrade|renew|auto.?renew)\b/i,
    /(اشتراك|إلغاء اشتراك|تجديد|ترقية|باقة)/,
  ],
  'support.error': [
    /\b(error|exception|crashed|crash|500|404|bug|issue|not load|won.t load|can.t load)\b/i,
    /(خطأ|مشكلة|ايرور|عطل|تعليق)/,
  ],
  'support.not_working': [
    /\b(not working|doesn.t work|broken|stopped working|won.t work|failing)\b/i,
    /(لا يعمل|مو شغال|ما يشتغل|خربان)/,
  ]
};

// Intent → agent mapping (for cross-agent redirect detection)
const INTENT_AGENT: Record<string, string> = {};
for (const key of Object.keys(INTENT_MAP)) {
  if (key.startsWith('permit.')) INTENT_AGENT[key] = 'permit';
  else if (key.startsWith('student.')) INTENT_AGENT[key] = 'student';
  else if (key.startsWith('lawyer.')) INTENT_AGENT[key] = 'lawyer';
}

export interface IntentResult {
  intent: string;
  subIntent: string;
  confidence: number;
  redirectTo?: string; // if different agent needed
}

/**
 * Unify Arabic spelling variants so patterns match regardless of how the user
 * typed the word: strip harakat/tatweel, fold أ/إ/آ → ا, and ى → ي. People
 * very commonly drop the hamza ("اخبارك" vs "أخبارك"), which otherwise misses.
 */
function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْ]/g, '')               // harakat (tashkeel)
    .replace(/ـ/g, '')                          // tatweel
    .replace(/[أإآ]/g, 'ا')      // أ إ آ → ا
    .replace(/ى/g, 'ي')                   // ى → ي
    .replace(/ة/g, 'ه');                  // ta marbuta → ha ("اقامة"→"اقامه")
}

export function detectIntent(
  query: string,
  assistantType: string,
): IntentResult | null {
  const q = query.trim();
  const qn = normalizeArabic(q);

  for (const [intent, patterns] of Object.entries(INTENT_MAP)) {
    for (const pattern of patterns) {
      if (pattern.test(q) || (qn !== q && pattern.test(qn))) {
        const [group, sub] = intent.includes('.') ? intent.split('.') : [intent, intent];
        const agentForIntent = INTENT_AGENT[intent];

        // Cross-agent redirect
        if (agentForIntent && agentForIntent !== assistantType) {
          return {
            intent: group,
            subIntent: sub,
            confidence: 1.0,
            redirectTo: `${agentForIntent}:${intent}`,
          };
        }

        return { intent: group, subIntent: sub, confidence: 1.0 };
      }
    }
  }

  // Fuzzy fallback for short single-word queries
  if (q.split(/\s+/).length <= 4) {
    const lq = q.toLowerCase();
    if (/cafe|kafe|cof+ee|coffee/.test(lq)) return { intent: 'permit', subIntent: 'cafe', confidence: 0.85 };
    if (/rest[ao]u?r?a?n?t?/.test(lq)) return { intent: 'permit', subIntent: 'restaurant', confidence: 0.85 };
    if (/retail|shop|store|magaza|dukkan/.test(lq)) return { intent: 'permit', subIntent: 'retail', confidence: 0.85 };
    if (/tapdk/.test(lq)) return { intent: 'permit', subIntent: 'alcohol', confidence: 0.9 };
    if (/foreigner|yabanci|yabancı/.test(lq)) return { intent: 'permit', subIntent: 'foreigner', confidence: 0.85 };
    if (/ikamet|ikamett|ikamet\b/.test(lq)) return { intent: 'student', subIntent: 'residence_permit', confidence: 0.9 };
    if (/kimlik|kimli/.test(lq)) return { intent: 'student', subIntent: 'renew_id', confidence: 0.85 };
    if (/denklik|denkliik|denlik/.test(lq)) return { intent: 'student', subIntent: 'equivalency', confidence: 0.85 };
    if (/yoksis|y[oö]ks[iı]s/.test(lq)) return { intent: 'student', subIntent: 'yoksis', confidence: 0.9 };
    if (/arabuluculuk|mediation/.test(lq)) return { intent: 'lawyer', subIntent: 'dispute', confidence: 0.85 };
    if (/mersis/.test(lq)) return { intent: 'lawyer', subIntent: 'company_formation', confidence: 0.9 };
  }

  return null;
}
