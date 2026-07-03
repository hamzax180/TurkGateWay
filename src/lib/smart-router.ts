/**
 * smart-router.ts
 * 5-layer pipeline — Gemini is layer 5, last resort only.
 *
 * Layer 1: Redis cache         (exact match, 0 tokens)
 * Layer 2: Keyword router      (intent → response library, 0 tokens)
 * Layer 3: Learning cache      (fuzzy DB match on previously AI-generated answers, 0 tokens)
 * Layer 4: Protocol engine     (hardcoded workflow steps for known services, 0 tokens)
 * Layer 5: Gemini AI fallback  (truly novel queries — uses tokens)
 */

import { redis, cacheKey, CACHE_TTL } from './redis';
import { db } from './db';
import { learningResponses, chatSessions, responseTemplates } from './schema';
import { eq, and } from 'drizzle-orm';
import { detectIntent } from './keyword-router';
import { buildWorkflow } from './protocol';
import { resolveWithContext, augmentQuery } from './context-engine';
import { render, buildVars } from './template-engine';
import { guidedFlow, DASHBOARD_READY } from './conversation-flow';
export interface RouterResult {
  content: string;
  source: 'cache' | 'keyword' | 'learned' | 'workflow' | 'ai';
  dashboard_state?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Response library lookup — loaded lazily from DB and cached.
// ---------------------------------------------------------------------------
let _libraries: Record<string, Record<string, string[]>> | null = null;
let _librariesLastFetched = 0;

// Social intents handled by general.json regardless of agent
const SOCIAL_INTENTS = new Set([
  'greeting', 'smalltalk', 'farewell', 'thanks', 'identity', 'trust',
  'billing.price', 'billing.subscription', 'billing.refund', 'billing.invoice',
  'support.error', 'support.not_working', 'support.slow',
]);

async function getLibraries(): Promise<Record<string, Record<string, string[]>>> {
  const now = Date.now();
  if (_libraries && (now - _librariesLastFetched < 60000)) {
    return _libraries; // Cache for 60 seconds
  }

  try {
    const rows = await db.select().from(responseTemplates);
    const libs: Record<string, Record<string, string[]>> = {
      general: {}, permit: {}, student: {}, lawyer: {}
    };

    for (const row of rows) {
      if (!libs[row.assistant_type]) {
        libs[row.assistant_type] = {};
      }
      try {
        libs[row.assistant_type][row.intent_key] = JSON.parse(row.responses);
      } catch (e) {
        // ignore bad JSON
      }
    }

    _libraries = libs;
    _librariesLastFetched = now;
  } catch (e) {
    console.error('[SmartRouter] Failed to load response libraries from DB:', e);
    if (!_libraries) {
      _libraries = { general: {}, permit: {}, student: {}, lawyer: {} };
    }
  }
  return _libraries;
}

function pickRandom(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}

// ---------------------------------------------------------------------------
// Inline translations for the high-frequency social intents. The response
// library in the DB is English-only, so without this every greeting/smalltalk
// would come back in English even when the user writes in Turkish/Arabic.
// Domain intents (cost, documents, etc.) are instead routed to Gemini for
// tr/ar (see pickResponse) which answers natively in the requested language.
// {name} placeholders are filled later by render(buildVars()).
// ---------------------------------------------------------------------------
const SOCIAL_I18N: Record<'tr' | 'ar', Record<string, string[]>> = {
  tr: {
    greeting: [
      'Merhaba **{name}**! 👋 Size nasıl yardımcı olabilirim?',
      'Selam **{name}**! 😊 Bugün ne yapmak istersiniz?',
      'Merhaba **{name}**! Hazır olduğunuzda buradayım. Ne lazım?',
    ],
    smalltalk: [
      'İyiyim, sorduğunuz için teşekkürler! 😊 Ya siz?',
      'Gayet iyiyim! Ya siz nasılsınız?',
      'Çok iyiyim, teşekkürler! 😄 Siz nasılsınız?',
    ],
    farewell: [
      'Kendinize iyi bakın! 👋',
      'Görüşmek üzere! 😊',
      'Hoşça kalın **{name}**! İhtiyacınız olursa buradayım.',
    ],
    thanks: [
      'Rica ederim! 😊',
      'Ne demek, her zaman! 👍',
      'Yardımcı olabildiysem ne mutlu! Başka bir şey var mı?',
    ],
    identity: [
      'Ben TurkGateway AI — Türkiye\'de iş, hukuk ve öğrenci hayatında size yol gösteren kişisel asistanınızım! 😄 Türk bürokrasisini sizin için kolaylaştırırım.',
    ],
    trust: [
      'Elimden geldiğince doğru bilgi veriyorum ama ben bir yapay zekâyım, lisanslı bir avukat değilim. Önemli kararlar için bir uzmana da danışmanızı öneririm. 🤝',
    ],
  },
  ar: {
    greeting: [
      'مرحباً **{name}**! 👋 كيف يمكنني مساعدتك؟',
      'أهلاً **{name}**! 😊 ماذا تريد أن تفعل اليوم؟',
      'مرحباً **{name}**! أنا هنا متى احتجتني. ما الذي تحتاجه؟',
    ],
    smalltalk: [
      'بخير، شكراً لسؤالك! 😊 وأنت؟',
      'كل شيء جيد! وكيف حالك أنت؟',
      'بخير تماماً، شكراً لك! 😄 وأنت كيف حالك؟',
    ],
    farewell: [
      'اعتنِ بنفسك! 👋',
      'إلى اللقاء! 😊',
      'مع السلامة **{name}**! أنا هنا متى احتجتني.',
    ],
    thanks: [
      'على الرحب والسعة! 😊',
      'لا شكر على واجب! 👍',
      'سعيد بمساعدتك! هل تحتاج شيئاً آخر؟',
    ],
    identity: [
      'أنا TurkGateway AI — مساعدك الشخصي للتنقل في عالم الأعمال والقانون وحياة الطلاب في تركيا! 😄 أبسّط لك البيروقراطية التركية.',
    ],
    trust: [
      'أحاول أن أكون دقيقاً قدر الإمكان، لكنني ذكاء اصطناعي ولست محامياً مرخصاً. للقرارات المهمة، أنصح باستشارة مختص أيضاً. 🤝',
    ],
  },
};

async function pickResponse(
  assistantType: string,
  subIntent: string,
  language: string,
): Promise<string | null> {
  const libs = await getLibraries();
  const lang = language === 'tr' ? 'tr' : language === 'ar' ? 'ar' : 'en';

  // Social intents always come from general.json (or the inline tr/ar set).
  const isSocial = SOCIAL_INTENTS.has(subIntent) ||
    [...SOCIAL_INTENTS].some(s => subIntent.startsWith(s));

  if (isSocial) {
    // Prefer a native-language social reply when available.
    if (lang !== 'en') {
      const i18n = SOCIAL_I18N[lang];
      const opts = i18n[subIntent] ?? i18n[subIntent.split('.').pop()!];
      if (opts?.length) return pickRandom(opts);
    }
    const gLib = libs['general'] ?? {};
    // Try exact key, then short key (billing.price → price)
    const gOpts = gLib[subIntent] ?? gLib[subIntent.split('.').pop()!];
    if (gOpts?.length) return pickRandom(gOpts);
    return null;
  }

  // Domain intents: the DB library is English-only. For tr/ar, return null so the
  // pipeline falls through to RAG/Gemini, which answer natively in the language.
  if (lang !== 'en') return null;

  const lib = libs[assistantType];
  if (!lib) return null;

  // Try exact sub-intent key
  const options = lib[subIntent];
  if (options?.length) return pickRandom(options);

  // Try short fallback (foo.bar → bar)
  if (subIntent.includes('.')) {
    const short = subIntent.split('.').pop()!;
    const opts = lib[short];
    if (opts?.length) return pickRandom(opts);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Layer 3: Learning cache fuzzy match
// ---------------------------------------------------------------------------
/** Word-level Jaccard similarity */
function wordSimilarity(a: string, b: string): number {
  const sa = new Set(a.toLowerCase().split(/\s+/));
  const sb = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...sa].filter(w => sb.has(w)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : intersection / union;
}

/** Character-level similarity (Levenshtein ratio approximation using common subsequence) */
function charSimilarity(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b;
  const longer  = a.length < b.length ? b : a;
  if (longer.length === 0) return 1.0;
  // sliding window character match count
  let matches = 0;
  const usedB = new Array(longer.length).fill(false);
  for (let i = 0; i < shorter.length; i++) {
    const ch = shorter[i];
    for (let j = Math.max(0, i - 3); j < Math.min(longer.length, i + 4); j++) {
      if (!usedB[j] && longer[j] === ch) {
        matches++;
        usedB[j] = true;
        break;
      }
    }
  }
  return (2.0 * matches) / (shorter.length + longer.length);
}

// Map of which intent prefixes belong to which agent — used to block cross-agent DB hits
const AGENT_INTENT_PREFIXES: Record<string, string[]> = {
  permit:  ['permit.'],
  student: ['student.'],
  lawyer:  ['lawyer.'],
  general: [],
};
const CROSS_AGENT_PREFIXES: Record<string, string[]> = {
  permit:  ['student.', 'lawyer.'],
  student: ['permit.', 'lawyer.'],
  lawyer:  ['permit.', 'student.'],
  general: [],
};

async function findLearned(
  query: string,
  assistantType: string,
  language: string,
): Promise<string | null> {
  // Guard: don't fuzzy-match on very short/ambiguous queries — too many false positives
  const words = query.trim().split(/\s+/);
  if (words.length === 1 && query.trim().length < 6) return null;
  if (query.trim().length < 4) return null;

  const blocked = CROSS_AGENT_PREFIXES[assistantType] ?? [];

  try {
    const rows = await db
      .select()
      .from(learningResponses)
      .where(
        and(
          eq(learningResponses.assistant_type, assistantType),
          eq(learningResponses.language, language),
        ),
      )
      .limit(200);

    let best: { response: string; id: number } | null = null;
    let bestScore = 0;

    for (const row of rows) {
      // Skip any row whose intent belongs to a different agent
      if (blocked.some(prefix => row.intent?.startsWith(prefix))) continue;

      const wScore = wordSimilarity(query, row.query);
      const cScore = charSimilarity(query.toLowerCase(), row.query.toLowerCase());

      // Typo detection: high char score alone is enough
      if (cScore >= 0.85 && cScore > bestScore) {
        bestScore = cScore;
        best = { response: row.response, id: row.id };
        continue;
      }
      // Paraphrase: both must pass
      if (cScore >= 0.65 && wScore >= 0.60) {
        const combined = (cScore + wScore) / 2;
        if (combined > bestScore) {
          bestScore = combined;
          best = { response: row.response, id: row.id };
        }
      }
    }

    if (best) {
      db.update(learningResponses)
        .set({ usage_count: (best as any).usage_count + 1 })
        .where(eq(learningResponses.id, best.id))
        .catch(() => {});
      return best.response;
    }
  } catch { /* DB unavailable — skip */ }
  return null;
}

// ---------------------------------------------------------------------------
// Persist a new AI-generated response to the learning cache
// ---------------------------------------------------------------------------
export async function persistLearned(
  query: string,
  response: string,
  assistantType: string,
  language: string,
) {
  if (response.length < 15) return;
  try {
    await db.insert(learningResponses).values({
      query: query.slice(0, 500),
      response: response.slice(0, 8000),
      assistant_type: assistantType,
      intent: 'learned',
      language,
      usage_count: 0,
    });
  } catch { /* ignore duplicate/overflow */ }
}

// ---------------------------------------------------------------------------
// Detect if query is a service-selection workflow trigger
// e.g. "Cafe & Restaurant - New Application in Kadıköy"
// ---------------------------------------------------------------------------
const WORKFLOW_PATTERN = /^(.+?) - (New|Renewal|Extension|Follow-up|Transfer|Re-registration|Get New|Find New|Set Up New|Form New|Review New|Hire|File New|New Transaction|New Matter)/i;

function parseWorkflowQuery(query: string): { service: string; location: string } | null {
  const m = query.match(WORKFLOW_PATTERN);
  if (!m) return null;
  const service = m[1].trim();
  const locationParts = query.split(' in ');
  const location = locationParts.length > 1 ? locationParts[locationParts.length - 1].trim() : 'Istanbul';
  return { service, location };
}

// ---------------------------------------------------------------------------
// Build a roadmap + dashboard_state for a known service + location, persist it to
// the session, and return a ready-to-render RouterResult. Shared by the explicit
// "X - New Application in Y" path and the guided-flow DASHBOARD_READY handoff.
// ---------------------------------------------------------------------------
function buildWorkflowResult(
  service: string,
  location: string,
  assistantType: string,
  language: string,
  sessionId?: string,
): RouterResult | null {
  const state = buildWorkflow(service, assistantType, language, location);
  if (!state) return null;

  if (sessionId) {
    db.update(chatSessions)
      .set({ dashboard_state: JSON.stringify(state), updated_at: new Date() })
      .where(eq(chatSessions.id, sessionId))
      .catch(() => {});
  }

  const summaryMsg = {
    en: `✅ **Your ${service} roadmap in ${location} is ready!**\n\n${state.combined_result.summary}\n\n📋 **${state.execution_plan.steps.length} steps** · ⏱️ **~${state.combined_result.timeline_days} days** · 📁 **${state.combined_result.permits.length} permits required**\n\n⬇️ Opening your Dashboard...`,
    tr: `✅ **${location} için ${service} yol haritanız hazır!**\n\n${state.combined_result.summary}\n\n📋 **${state.execution_plan.steps.length} adım** · ⏱️ **~${state.combined_result.timeline_days} gün** · 📁 **${state.combined_result.permits.length} izin gerekli**\n\n⬇️ Gösterge Paneliniz açılıyor...`,
    ar: `✅ **خارطة طريقك لـ ${service} في ${location} جاهزة!**\n\n${state.combined_result.summary}\n\n📋 **${state.execution_plan.steps.length} خطوة** · ⏱️ **~${state.combined_result.timeline_days} يوماً** · 📁 **${state.combined_result.permits.length} تصاريح مطلوبة**\n\n⬇️ يتم فتح لوحة القيادة...`,
  };
  const content = summaryMsg[language as keyof typeof summaryMsg] ?? summaryMsg.en;
  return { content, source: 'workflow', dashboard_state: state as unknown as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Not-understood: agent-specific redirect shown when a query doesn't match
// anything in the pipeline and seems off-topic for this agent.
// ---------------------------------------------------------------------------

const AGENT_RELEVANT: Record<string, RegExp> = {
  permit:  /\b(business|permit|ruhsat|cafe|restaurant|shop|store|office|company|open|start|launch|belediye|istanbul|ankara|izmir|district|visa|license|licence|trade|register|nace|alcohol|music|fire|safety|sign|tax|vergi|notary|izin|esnaf|ticaret|şirket|firma|dükkan|mağaza|işyeri|step|document|how do i|what do i|explain|roadmap|procedure|process|apply|application|fee|cost|time|days|week)\b/i,
  student: /\b(student|university|uni|ikamet|visa|denklik|dormitory|dorm|scholarship|registration|kimlik|id|enroll|register|degree|course|study|tuition|yoksis|kyk|yurt|transport|card|insurance|health|öğrenci|üniversite|kayıt|burs|sigorta|konut|vize|step|document|how do i|what do i|explain|procedure|process|apply|application|fee|cost|time|days|week)\b/i,
  lawyer:  /\b(law|legal|contract|company|court|dispute|employment|visa|permit|property|lawyer|attorney|turkish|mersis|notary|lease|rent|debt|criminal|divorce|tax|evict|sue|trademark|copyright|llc|ltd|hukuk|sözleşme|tapu|icra|tazminat|avukat|dava|step|document|how do i|what do i|explain|procedure|process|apply|application|fee|cost|time|days|week)\b/i,
};

function isAgentRelevant(query: string, assistantType: string): boolean {
  return AGENT_RELEVANT[assistantType]?.test(query) ?? true;
}

const NOT_UNDERSTOOD_RESPONSES: Record<string, Record<string, string[]>> = {
  permit: {
    en: [
      "Hmm, I didn't quite catch that! 😅 I'm here to help you open and licence businesses in Turkey. Check the suggested services below 👇",
      "That one went over my head! I specialise in business permits in Turkey — try one of the suggested services 👇",
      "I'm not sure I understood that. My expertise is business permits and company setup in Turkey. Have a look at the suggestions below 👇",
    ],
    tr: [
      "Bunu tam anlayamadım! 😅 Türkiye'de işyeri açma ve ruhsat konularında uzmanım — aşağıdaki önerilen hizmetlere bakın 👇",
      "Tam olarak anlamadım. Türkiye'deki işyeri ruhsatları konusunda yardımcı olabilirim — önerilen konulara göz atın 👇",
    ],
    ar: [
      "لم أفهم ذلك تماماً! 😅 أنا متخصص في تراخيص الأعمال في تركيا — ألقِ نظرة على الخدمات المقترحة أدناه 👇",
    ],
  },
  student: {
    en: [
      "Hmm, that's a bit outside my area! 😅 I'm here to help with student services in Turkey — check the suggested topics below 👇",
      "I didn't quite catch that one. I specialise in student life in Turkey — have a look at the suggested services 👇",
      "Not sure I understood that! I'm your guide for university, İkamet, and student services in Turkey. Try a suggested topic 👇",
    ],
    tr: [
      "Bunu tam anlayamadım! 😅 Türkiye'deki öğrenci hizmetleri konusunda uzmanım — önerilen konulara göz atın 👇",
      "Tam olarak anlamadım. Türkiye'deki öğrenci konularında yardımcı olabilirim — aşağıdaki önerilere bakın 👇",
    ],
    ar: [
      "لم أفهم ذلك تماماً! 😅 أنا هنا للمساعدة في خدمات الطلاب في تركيا — ألقِ نظرة على المواضيع المقترحة 👇",
    ],
  },
  lawyer: {
    en: [
      "Hmm, that's a bit outside my area! 😅 I'm your legal guide for Turkish law matters — check the suggested services below 👇",
      "I didn't quite get that one. I specialise in Turkish legal matters — contracts, companies, disputes. Take a look at the suggestions 👇",
      "Not sure I understood that! My expertise is Turkish law. Try one of the suggested topics below 👇",
    ],
    tr: [
      "Bunu tam anlayamadım! 😅 Türk hukuku konularında uzman rehberinizim — önerilen hizmetlere göz atın 👇",
      "Tam olarak anlamadım. Türk hukuku ve hukuki konularda yardımcı olabilirim — aşağıdaki önerilere bakın 👇",
    ],
    ar: [
      "لم أفهم ذلك تماماً! 😅 أنا مرشدك القانوني في تركيا — ألقِ نظرة على الخدمات المقترحة 👇",
    ],
  },
};

export const NOT_UNDERSTOOD = 'NOT_UNDERSTOOD:';

function pickNotUnderstood(assistantType: string, language: string): string {
  const lang = (language === 'tr' ? 'tr' : language === 'ar' ? 'ar' : 'en') as 'en' | 'tr' | 'ar';
  const opts = NOT_UNDERSTOOD_RESPONSES[assistantType]?.[lang]
    ?? NOT_UNDERSTOOD_RESPONSES[assistantType]?.['en']
    ?? NOT_UNDERSTOOD_RESPONSES.permit.en;
  return opts[Math.floor(Math.random() * opts.length)];
}

// Smart no-key fallback — runs when GEMINI_API_KEY is not configured.
// Shows an expert capability menu tailored to each agent.
// ---------------------------------------------------------------------------
function smartNoKeyResponse(
  query: string,
  language: string,
  assistantType: string,
): string {
  const menus: Record<string, Record<string, string>> = {
    permit: {
      en: `🏪 **Business Agent — Here's what I can help you with:**\n\n• 🏪 **Open a business** — Cafe, Restaurant, Retail, Office, Gym, Barber, Bakery, Hotel, Clinic\n• 📜 **Permits & licences** — İşyeri Ruhsatı, TAPDK alcohol, Live music\n• 📄 **Document checklists** — Exactly what to bring to the municipality\n• 💰 **Costs & fees** — Trade Registry, Notary, Municipal permit ranges\n• ⏱️ **Timelines** — How long each permit type takes by district\n• 🏢 **Company formation** — LTD şirketi full setup\n• 🔢 **NACE codes** — Which code applies to your business\n\n💬 Just tell me: **what type of business** do you want to open, and **which district**?`,
      tr: `🏪 **İşletme Asistanı — Size yardımcı olabileceğim konular:**\n\n• 🏪 **İşyeri açmak** — Kafe, Restoran, Mağaza, Ofis, Spor Salonu, Berber, Fırın, Otel, Klinik\n• 📜 **Ruhsatlar** — İşyeri Açma Ruhsatı, TAPDK, Canlı Müzik İzni\n• 📄 **Belge listeleri** — Belediyeye ne getireceğiniz\n• 💰 **Maliyetler** — Ticaret Sicili, Noter, Belediye ruhsat ücretleri\n• ⏱️ **Süreler** — Her ruhsat ne kadar sürer\n• 🏢 **Şirket kuruluşu** — LTD şirketi adımları\n\n💬 **Ne tür işletme** açmak istiyorsunuz ve **hangi ilçede**?`,
      ar: `🏪 **وكيل الأعمال — إليك ما يمكنني مساعدتك به:**\n\n• 🏪 **فتح نشاط تجاري** — مقهى، مطعم، محل، مكتب، صالة رياضية، حلاق، مخبز، فندق، عيادة\n• 📜 **التصاريح والرخص** — رخصة العمل، رخصة الكحول، ترخيص الموسيقى\n• 📄 **قوائم المستندات** — ما تحتاج إحضاره إلى البلدية بالضبط\n• 💰 **التكاليف والرسوم** — السجل التجاري، الكاتب العدل، رسوم البلدية\n• ⏱️ **المدة الزمنية** — كم تستغرق كل رخصة حسب الحي\n• 🏢 **تأسيس شركة** — تأسيس شركة محدودة بالكامل\n\n💬 فقط أخبرني: **ما نوع النشاط التجاري** الذي تريد فتحه، و**في أي حي**؟`,
    },
    student: {
      en: `🎓 **Student Agent — Here's what I can help you with:**\n\n• 🎓 **University registration** — Step-by-step for any Turkish university\n• 📋 **Denklik (Equivalency)** — Diploma recognition process\n• 🏠 **İkamet (Residence permit)** — Full student residence permit guide\n• 📅 **Deadlines** — Application windows, registration periods\n• 🎯 **Scholarships** — Türkiye Bursları (YTB) and other funding\n• ✈️ **Student visa** — How to apply before arriving in Turkey\n• 🏛️ **Top universities** — Rankings, specializations, admissions\n• 🚇 **İstanbulkart** — 50% student transport discount\n• 🏥 **Health insurance** — Requirements and where to get it\n\n💬 Which **university** are you interested in, or what do you need help with?`,
      tr: `🎓 **Öğrenci Asistanı — Size yardımcı olabileceğim konular:**\n\n• 🎓 **Üniversite kaydı** — Herhangi bir Türk üniversitesi\n• 📋 **Denklik** — Diploma denkleştirme süreci\n• 🏠 **İkamet** — Öğrenci ikamet izni\n• 📅 **Son tarihler** — Başvuru dönemleri\n• 🎯 **Burslar** — Türkiye Bursları (YTB)\n• ✈️ **Öğrenci vizesi**\n• 🚇 **İstanbulkart** — %50 öğrenci indirimi\n\n💬 Hangi **üniversiteyle** ilgileniyorsunuz?`,
      ar: `🎓 **وكيل الطلاب — إليك ما يمكنني مساعدتك به:**\n\n• 🎓 **التسجيل الجامعي** — خطوة بخطوة لأي جامعة تركية\n• 📋 **الدنكليك (معادلة الشهادة)** — عملية الاعتراف بالشهادة\n• 🏠 **الإقامة** — دليل كامل لإقامة الطالب\n• 📅 **المواعيد النهائية** — فترات التقديم والتسجيل\n• 🎯 **المنح الدراسية** — المنحة التركية (YTB) وغيرها\n• ✈️ **تأشيرة الطالب** — كيفية التقديم قبل الوصول إلى تركيا\n• 🚇 **إسطنبول كارت** — خصم 50% على المواصلات للطلاب\n• 🏥 **التأمين الصحي** — المتطلبات وأين تحصل عليه\n\n💬 ما **الجامعة** التي تهتم بها، أو بماذا تحتاج المساعدة؟`,
    },
    lawyer: {
      en: `⚖️ **Legal Agent — Here's what I can help you with:**\n\n• 🏢 **Company formation** — LTD şirketi, MERSİS, Trade Registry steps\n• 👔 **Employment law** — Severance pay, unfair dismissal, mediation\n• 📝 **Contracts** — Review, obligations under Turkish law\n• 🏠 **Residence & work permits** — İkamet, work permit via employer\n• 💸 **Debt collection** — İcra takibi, ihtarname process\n• 🏡 **Real estate** — Tapu, foreign ownership rules\n• ⚠️ **Criminal matters** — Rights, representation, legal process\n\n💬 What **legal matter** can I help you with?`,
      tr: `⚖️ **Hukuk Asistanı — Size yardımcı olabileceğim konular:**\n\n• 🏢 **Şirket kuruluşu** — LTD şirketi, MERSİS, Ticaret Sicili\n• 👔 **İş hukuku** — Kıdem tazminatı, haksız fesih, arabuluculuk\n• 📝 **Sözleşmeler** — İnceleme, Türk hukuku yükümlülükleri\n• 🏠 **İkamet ve çalışma izni**\n• 💸 **İcra takibi** — Borç tahsilatı\n\n💬 Hangi **hukuki konuda** yardıma ihtiyacınız var?`,
      ar: `⚖️ **الوكيل القانوني — إليك ما يمكنني مساعدتك به:**\n\n• 🏢 **تأسيس الشركات** — الشركة المحدودة، MERSİS، السجل التجاري\n• 👔 **قانون العمل** — مكافأة نهاية الخدمة، الفصل التعسفي، الوساطة\n• 📝 **العقود** — المراجعة والالتزامات وفق القانون التركي\n• 🏠 **الإقامة وتصاريح العمل**\n• 💸 **تحصيل الديون** — متابعة الإجراءات التنفيذية\n\n💬 ما هي **المسألة القانونية** التي يمكنني مساعدتك بها؟`,
    },
  };

  const lang = (language === 'tr' ? 'tr' : language === 'ar' ? 'ar' : 'en') as 'en' | 'tr' | 'ar';
  return menus[assistantType]?.[lang] ?? menus.permit[lang];
}

// ---------------------------------------------------------------------------
// Layer 5: Gemini AI fallback
// ---------------------------------------------------------------------------
async function geminiResponse(
  query: string,
  assistantType: string,
  language: string,
  isStepQuery: boolean = false,
): Promise<string> {
  // Lazy import so the module loads even if GEMINI_API_KEY is not set
  const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
  const { generateText } = await import('ai');

  const langLabel = language === 'tr' ? 'Turkish' : language === 'ar' ? 'Arabic' : 'English';
  // Reply natively in the user's language — never translate literally from English.
  const langLine = language === 'en'
    ? `Respond in English. Use markdown formatting.`
    : `Respond ONLY in ${langLabel}. Think and write natively in ${langLabel} with natural, fluent phrasing${language === 'ar' ? ' (use right-to-left Arabic, Modern Standard Arabic that is easy to read)' : ''} — do NOT translate word-for-word from English. Use markdown formatting.`;
  // Step queries always get answered (no off-topic refusal) — they come from a
  // roadmap the agent itself built, so they're guaranteed on-topic.
  const offTopicLine = isStepQuery
    ? ''
    : `If the question is unrelated to your specialty, reply with exactly: "NOT_UNDERSTOOD:${pickNotUnderstood(assistantType, language)}"`;
  const SYSTEM_PROMPTS: Record<string, string> = {
    permit: `You are the Business Agent — an expert guide for opening and licensing businesses in Turkey.
${langLine} Be concise and actionable, end with a follow-up question.
Only answer questions about business permits, company setup, licences, districts, costs, documents, NACE codes, or Turkish business regulations.
${offTopicLine}`,
    student: `You are the Student Agent — an expert guide for international students in Turkey.
${langLine} Use numbered steps. Be warm and practical.
Only answer questions about university registration, İkamet, student visas, Denklik, dormitories, scholarships, transport cards, or student life in Turkey.
${offTopicLine}`,
    lawyer: `You are the Legal Agent — a legal assistant for Turkish law matters.
${langLine} Be precise about legal requirements and recommend professional consultation for complex matters.
Only answer questions about Turkish law: contracts, company formation, employment, residence permits, real estate, debt, criminal matters.
${offTopicLine}`,
  };

  // For "Ask AI about this step", instruct a thorough, structured explanation.
  const STEP_INSTRUCTION = `\n\nThe user is asking about a specific step in their roadmap. Give a clear, thorough explanation structured as:\n**📝 What this step means** — plain-language overview.\n**✅ What exactly to do** — numbered, concrete actions.\n**📄 Documents needed** — bullet list (if any).\n**💡 Tips & common mistakes** — practical advice.\n**⏱️ Roughly how long it takes** — realistic estimate.\nBe specific to Turkey. End with a short encouraging line offering to clarify any part.`;

  const baseSystem = SYSTEM_PROMPTS[assistantType] ?? SYSTEM_PROMPTS.permit;
  const system = isStepQuery ? baseSystem + STEP_INSTRUCTION : baseSystem;

  if (!process.env.GEMINI_API_KEY) {
    return smartNoKeyResponse(query, language, assistantType);
  }

  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const { text } = await generateText({
    model: google('gemini-2.0-flash-exp'),
    system,
    prompt: query,
    maxOutputTokens: isStepQuery ? 1200 : 800,
  });
  return text;
}

// ---------------------------------------------------------------------------
// Main 5-layer pipeline
// ---------------------------------------------------------------------------
export async function smartRouter(
  query: string,
  language: string,
  assistantType: string,
  sessionId?: string,
  messages: Array<{ role: string; content: string }> = [],
  userName?: string,
  isStepQuery: boolean = false,
): Promise<RouterResult> {
  // ── Step-explanation fast path ─────────────────────────────────────────
  // "Ask AI about this step" sends a detailed step query. It must NOT enter the
  // guided flow (which would ask for a district again) or the keyword/off-topic
  // guards (which return generic one-liners). Go straight to RAG → Gemini for a
  // thorough, step-specific explanation.
  if (isStepQuery) {
    // RAG first (real knowledge base), then Gemini with a step-focused prompt.
    if (process.env.GEMINI_API_KEY) {
      try {
        const { retrieveChunks, generateRagResponse } = await import('./rag');
        const chunks = await retrieveChunks(query, assistantType, language, 3);
        if (chunks.length > 0) {
          const ragText = await generateRagResponse(query, assistantType, language, chunks);
          if (ragText) {
            const sources = [...new Set(chunks.map(c => c.title))];
            const lbl = language === 'tr' ? 'Kaynaklar' : language === 'ar' ? 'المصادر' : 'Sources';
            return { content: `${ragText}\n\n*_${lbl}: ${sources.join(', ')}_*`, source: 'learned' };
          }
        }
      } catch { /* RAG unavailable — fall through to Gemini */ }
    }
    const stepText = await geminiResponse(query, assistantType, language, true);
    return { content: stepText, source: 'ai' };
  }

  // ── Layer 0: Context engine — resolves short follow-ups ("yes", "ok",
  // "how much", "what docs") using conversation history. Must run first.
  if (messages.length >= 2) {
    const contextResponse = resolveWithContext(query, messages, assistantType, language);
    if (contextResponse) {
      return { content: contextResponse, source: 'keyword' };
    }
  }

  // Augment short/ambiguous queries with topic context before keyword matching
  const effectiveQuery = messages.length >= 2 ? augmentQuery(query, messages) : query;
  const key = cacheKey(effectiveQuery, language, assistantType);

  // ── Layer 0b: Workflow pattern ─────────────────────────────────────────
  // Queries like "Cafe & Restaurant - New Application in Kadıköy" are
  // service-selection triggers; they must reach the protocol engine, not the
  // keyword router (which would match "Cafe" and return a generic response).
  const workflowQueryEarly = parseWorkflowQuery(query);
  if (workflowQueryEarly) {
    const result = buildWorkflowResult(workflowQueryEarly.service, workflowQueryEarly.location, assistantType, language, sessionId);
    if (result) return result;
  }

  // Detect intent early so we can skip the SHARED cache for name-personalized
  // replies (greeting/farewell). Otherwise one user's name would be cached under
  // "hello" and served to every other user.
  const earlyIntent = detectIntent(effectiveQuery, assistantType);
  const isPersonalized = Boolean(userName) &&
    (earlyIntent?.subIntent === 'greeting' || earlyIntent?.subIntent === 'farewell');

  // ── Layer 1: Redis cache ───────────────────────────────────────────────
  if (!isPersonalized) {
    try {
      const cached = await redis.get<string>(key);
      if (cached) return { content: cached, source: 'cache' };
    } catch { /* Redis unavailable — continue */ }
  }

  // ── Layer 1.5: Guided conversation flow ────────────────────────────────
  const flowResponse = guidedFlow(query, messages, assistantType, language, earlyIntent?.subIntent ?? null);
  if (flowResponse) {
    // Guided flow collected both business + district → build the roadmap and hand
    // off to the Dashboard (never cache the raw sentinel).
    if (flowResponse.startsWith(DASHBOARD_READY)) {
      const [service, location] = flowResponse.slice(DASHBOARD_READY.length).split('|');
      const result = buildWorkflowResult(service, location || 'Istanbul', assistantType, language, sessionId);
      if (result) return result;
    }
    redis.set(key, flowResponse, { ex: 300 }).catch(() => {});
    return { content: flowResponse, source: 'keyword' };
  }

  // ── Layer 2: Keyword router → response library ─────────────────────────
  const intentResult = earlyIntent;
  if (intentResult) {
    if (intentResult.redirectTo) {
      // Cross-agent question — get the answer from the correct agent's library
      // and return a REDIRECT_NEW_CHAT signal so the frontend auto-switches agents
      const targetAgent = intentResult.redirectTo.split(':')[0];
      const crossResponse = await pickResponse(targetAgent, intentResult.subIntent, language);
      const displayMsg = crossResponse ?? `This question is best handled by the ${targetAgent} agent. Let me switch you over!`;
      return { content: `REDIRECT_NEW_CHAT:${targetAgent}|${displayMsg}`, source: 'keyword' };
    }
    const rawResponse = await pickResponse(assistantType, intentResult.subIntent, language);
    if (rawResponse) {
      const response = render(rawResponse, buildVars(userName));
      // Don't cache name-personalized replies — they differ per user.
      if (!isPersonalized) redis.set(key, response, { ex: CACHE_TTL }).catch(() => {});
      return { content: response, source: 'keyword' };
    }
  }

  // ── Layer 3: Learning cache ────────────────────────────────────────────
  const learned = await findLearned(query, assistantType, language);
  if (learned) return { content: learned, source: 'learned' };

  // ── Layer 4: RAG vector search ────────────────────────────────────────
  // Only runs if Gemini API key is set (needs embedding API)
  if (process.env.GEMINI_API_KEY) {
    try {
      const { retrieveChunks, generateRagResponse } = await import('./rag');
      const chunks = await retrieveChunks(query, assistantType, language, 3);
      if (chunks.length > 0) {
        const ragText = await generateRagResponse(query, assistantType, language, chunks);
        if (ragText) {
          // Add source citations
          const sources = [...new Set(chunks.map(c => c.title))];
          const lbl = language === 'tr' ? 'Kaynaklar' : language === 'ar' ? 'المصادر' : 'Sources';
          const cited = `${ragText}\n\n*_${lbl}: ${sources.join(', ')}_*`;
          persistLearned(query, cited, assistantType, language).catch(() => {});
          return { content: cited, source: 'learned' };
        }
      }
    } catch { /* RAG unavailable — continue to Gemini */ }
  }

  // ── Layer 4b: Smart catch-all ─────────────────────────────────────────────
  // Priority order: guided flow (with full messages) → agent library → smart default
  const catchAllFlowResponse = guidedFlow(query, messages, assistantType, language, null);
  if (catchAllFlowResponse) {
    if (catchAllFlowResponse.startsWith(DASHBOARD_READY)) {
      const [service, location] = catchAllFlowResponse.slice(DASHBOARD_READY.length).split('|');
      const result = buildWorkflowResult(service, location || 'Istanbul', assistantType, language, sessionId);
      if (result) return result;
    }
    return { content: catchAllFlowResponse, source: 'keyword' };
  }

  // ── Layer 4c: Off-topic / not-understood guard ────────────────────────────
  // The relevance heuristic relies on English/Turkish keywords with \b word
  // boundaries that don't match Arabic script — so only apply it for English.
  // For tr/ar we let Gemini judge relevance (it emits NOT_UNDERSTOOD: itself
  // when the query is genuinely off-topic), so real domain questions still get
  // a proper native-language answer instead of being wrongly blocked here.
  if (language === 'en' && !isAgentRelevant(query, assistantType)) {
    return { content: `${NOT_UNDERSTOOD}${pickNotUnderstood(assistantType, language)}`, source: 'keyword' };
  }

  // ── Layer 5: Gemini AI fallback (last resort) ──────────────────────────
  const aiText = await geminiResponse(query, assistantType, language);

  // Persist to learning cache and Redis for future hits
  persistLearned(query, aiText, assistantType, language).catch(() => {});
  redis.set(key, aiText, { ex: CACHE_TTL }).catch(() => {});

  return { content: aiText, source: 'ai' };
}
