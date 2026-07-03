/**
 * context-engine.ts
 * Ported from backend/smart_router/context_engine.py
 *
 * Parses recent chat history to track:
 *   - current_topic   (what are we discussing?)
 *   - last_offer      (what did the agent offer to show next?)
 *   - business_type   (cafe, restaurant, retail, etc.)
 *   - assistant_type  (permit, student, lawyer)
 *
 * Then resolves short/ambiguous follow-ups ("yes", "ok", "how much", "what docs")
 * WITHOUT touching the keyword router or Gemini.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConversationState {
  currentTopic: string | null;    // e.g. 'cafe', 'alcohol', 'company_formation'
  lastOffer: string | null;       // e.g. 'roadmap', 'documents', 'cost', 'steps', 'checklist'
  businessType: string | null;    // e.g. 'cafe', 'restaurant', 'retail'
  assistantMention: string | null;// last assistant message snippet (for debug)
}

// ── Affirmatives & negatives ──────────────────────────────────────────────────

const AFFIRMATIVES = new Set([
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'of course', 'please',
  'go ahead', 'do it', 'definitely', 'absolutely', 'great', 'sounds good',
  'let\'s do it', 'let\'s go', 'proceed', 'continue', 'next', 'show me',
  'tell me', 'go on', 'alright', 'evet', 'tamam', 'olur', 'tabii',
  'نعم', 'أكيد', 'موافق', 'تفضل', 'طبعاً', 'حسنا', 'يلا', 'اوكي',
]);

// Negatives — short replies that must NOT be domain-augmented or fuzzy-matched
const NEGATIVES = new Set([
  'no', 'nope', 'nah', 'not', 'never', 'no thanks', 'nein',
  'hayır', 'yok', 'değil', 'لا', 'لأ', 'مش',
]);

// ── Topic extraction from assistant messages ─────────────────────────────────

const TOPIC_PATTERNS: Array<[RegExp, string]> = [
  // Business types (permit agent)
  [/\bcafe\b|\bcoffee shop\b|\bkahvehane\b|\bكافيه\b|\bكافي\b/i,                 'cafe'],
  [/\brestaurant\b|\brestoran\b|\blokanta\b|\bمطعم\b/i,                           'restaurant'],
  [/\bretail\b|\bshop\b|\bstore\b|\bm[aä]gaz[ae]\b|\bمحل\b|\bبقالة\b/i,         'retail'],
  [/\boffice\b|\bconsulting\b|\bofis\b|\bمكتب\b/i,                                'office'],
  [/\bbarber\b|\bhair salon\b|\bkuaf[öo]r\b|\bصالون\b|\bحلاق\b/i,               'barber'],
  [/\bgym\b|\bfitness\b|\bspor\b|\bجيم\b|\bصالة رياضية\b/i,                     'gym'],
  [/\bbakery\b|\bf[ıi]r[ıi]n\b|\bمخبز\b|\bفرن\b/i,                              'bakery'],
  [/\bpharmacy\b|\beczane\b|\bصيدلية\b/i,                                         'pharmacy'],
  [/\bhotel\b|\botel\b|\bفندق\b/i,                                                'hotel'],
  [/\bclinic\b|\bklinik\b|\bعيادة\b/i,                                            'clinic'],
  // Alcohol (permit sub-topic)
  [/\btapdk\b|\balcohol\b|\bliquor\b|\bwine\b|\bbeer\b|\bكحول\b|\bخمر\b/i,      'alcohol'],
  // Lawyer topics
  [/\bcompany formation\b|\bltd\b|\bmersis\b|\bتأسيس شركة\b/i,                   'company_formation'],
  [/\bcontract\b|\bnda\b|\bagreement\b|\bعقد\b/i,                                 'contract_review'],
  [/\bfired\b|\bdismissed\b|\bseverance\b|\bقانون العمل\b/i,                     'employment_law'],
  [/\bdispute\b|\blawsuit\b|\bmediation\b|\bنزاع\b/i,                             'dispute'],
  // Student topics
  [/\bikamet\b|\bresidence permit\b|\bإقامة\b|\baقامة\b/i,                       'residence_permit'],
  [/\bdenklik\b|\bequivalency\b|\bمعادلة\b/i,                                    'equivalency'],
  [/\buniversity\b|\bregist(er|ration)\b|\btasj?il\b|\bتسجيل جامعة\b/i,         'university_reg'],
  [/\bscholarship\b|\bburs\b|\bمنحة\b/i,                                         'scholarship'],
  [/\bvisa\b|\bvize\b|\bتأشيرة\b|\bفيزا\b/i,                                    'visa'],
  [/\btax (id|number|office)\b|\bvergi\b|\bرقم ضريبي\b/i,                       'tax_id'],
  [/\bnace\b|\bactivity code\b|\bكود نشاط\b/i,                                   'nace'],
  // General
  [/\bhow to start\b|\bopen a business\b|\bكيف أبدأ\b/i,                         'how_to_start'],
  [/\bdocuments?\b|\bpaperwork\b|\bوثائق\b|\bالمستندات\b/i,                     'documents'],
  [/\btimeline\b|\bhow long\b|\bكم تستغرق\b/i,                                  'timeline'],
  [/\bcost\b|\bfee\b|\bhow much\b|\bسعر\b|\bتكلفة\b/i,                          'cost'],
];

// What did the agent offer? ("Want the checklist?", "Shall I walk you through?")
const OFFER_PATTERNS: Array<[RegExp, string]> = [
  [/\b(want|shall i|should i|would you like).{0,40}(roadmap|road map|walk(through| you through))/i, 'roadmap'],
  [/\b(want|shall i|should i|would you like).{0,40}(checklist|document list|full list|docs)/i,      'documents'],
  [/\b(want|shall i|should i|would you like).{0,40}(cost|budget|fee|price)/i,                       'cost'],
  [/\b(want|shall i|should i|would you like).{0,40}(timeline|how long|step)/i,                      'timeline'],
  [/\b(want|shall i|should i|would you like).{0,40}(includ|add).{0,20}(roadmap|map)/i,              'roadmap'],
  [/\bwant that includ\b|\binclude.{0,20}roadmap\b/i,                                               'roadmap'],
  [/\b(shall we|ready for|let's start|want to start|want me to)/i,                                  'steps'],
];

// ── Parse conversation history ────────────────────────────────────────────────

/**
 * Takes recent chat messages [{role, content}] and returns conversation state.
 * Looks at the last ~6 messages (3 turns) to infer context.
 */
export function parseContext(
  messages: Array<{ role: string; content: string }>,
): ConversationState {
  const state: ConversationState = {
    currentTopic: null,
    lastOffer: null,
    businessType: null,
    assistantMention: null,
  };

  // Work through messages newest-first so we pick up the most recent context
  const recent = messages.slice(-6);

  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    const text = msg.content;

    // Extract topic from any message (user or assistant)
    if (!state.currentTopic) {
      for (const [pattern, topic] of TOPIC_PATTERNS) {
        if (pattern.test(text)) {
          state.currentTopic = topic;
          // If it's a business type also set businessType
          const bizTypes = ['cafe', 'restaurant', 'retail', 'office', 'barber', 'gym', 'bakery', 'pharmacy', 'hotel', 'clinic'];
          if (bizTypes.includes(topic)) state.businessType = topic;
          break;
        }
      }
    }

    // Extract what the assistant last offered (only from assistant messages)
    if (!state.lastOffer && msg.role === 'assistant') {
      for (const [pattern, offer] of OFFER_PATTERNS) {
        if (pattern.test(text)) {
          state.lastOffer = offer;
          state.assistantMention = text.slice(0, 120);
          break;
        }
      }
    }
  }

  return state;
}

// ── Resolve follow-up ────────────────────────────────────────────────────────

type Lang = 'en' | 'tr' | 'ar';

function pick(en: string, tr: string, ar: string, lang: string): string {
  if (lang === 'tr') return tr;
  if (lang === 'ar') return ar;
  return en;
}

/** Inline pre-built responses for common context resolutions — zero tokens */
function roadmapOffer(topic: string, lang: string): string {
  const label = topic.replace(/_/g, ' ');
  return pick(
    `✅ **Great! Let's map out your ${label} journey.**\n\nTo generate your full roadmap, please type:\n\n> **"${label.charAt(0).toUpperCase() + label.slice(1)} - New Application in [your district]"**\n\nFor example: *"Cafe & Restaurant - New Application in Kadıköy"*\n\nThis will unlock your personalised step-by-step plan on the Dashboard! 📋`,
    `✅ **Harika! ${label} sürecinizi adım adım planlayalım.**\n\nTam yol haritanız için şunu yazın:\n\n> **"${label} - New Application in [ilçeniz]"**\n\nÖrnek: *"Cafe & Restaurant - New Application in Kadıköy"*`,
    `✅ **رائع! دعنا نخطط لمسار ${label} خطوة بخطوة.**\n\nلإنشاء خارطة الطريق الكاملة، اكتب:\n\n> **"${label} - New Application in [منطقتك]"**\n\nمثال: *"Cafe & Restaurant - New Application in Kadıköy"*`,
    lang,
  );
}

function documentsOffer(topic: string, lang: string): string {
  const docs: Record<string, Record<string, string[]>> = {
    cafe:        { en: ['Passport + Notarized Translation', 'Signed Lease Agreement', 'Tax ID (Vergi Numarası)', 'NACE Code (56.10)', 'Floor Plan', 'İtfaiye Fire Safety Report', 'Baca (Chimney) Certificate', 'Food Registry (Gıda Sicil)'], tr: ['Pasaport + Noter Tercümesi', 'Kira Sözleşmesi', 'Vergi Kimlik Numarası', 'NACE Kodu (56.10)', 'Kat Planı', 'İtfaiye Raporu', 'Baca Uygunluk Belgesi', 'Gıda Sicil Belgesi'], ar: ['جواز السفر + ترجمة معتمدة', 'عقد الإيجار الموقّع', 'الرقم الضريبي', 'كود NACE (56.10)', 'مخطط الطابق', 'تقرير الإطفاء', 'شهادة المدخنة', 'سجل الأغذية'] },
    restaurant:  { en: ['Passport + Notarized Translation', 'Signed Lease', 'Tax ID', 'NACE Code (56.10)', 'Floor Plan', 'İtfaiye Report', 'Baca Certificate', 'Gıda Sicil Belgesi', 'TAPDK (if serving alcohol)'], tr: ['Pasaport + Tercüme', 'Kira Sözleşmesi', 'Vergi No', 'NACE (56.10)', 'Kat Planı', 'İtfaiye', 'Baca', 'Gıda Sicil'], ar: ['جواز سفر', 'عقد إيجار', 'رقم ضريبي', 'NACE', 'مخطط', 'إطفاء', 'مدخنة', 'سجل غذائي'] },
    retail:      { en: ['Passport + Translation', 'Signed Lease', 'Tax ID', 'NACE Code (47.xx)', 'Floor Plan'], tr: ['Pasaport', 'Kira', 'Vergi No', 'NACE (47.xx)', 'Kat Planı'], ar: ['جواز سفر', 'عقد إيجار', 'رقم ضريبي', 'NACE', 'مخطط'] },
    alcohol:     { en: ['Full Business Permit (Ruhsat) — must be obtained first', 'TAPDK Application Form', 'Criminal Background Check (all shareholders)', 'Distance Compliance Certificate (from schools/mosques)', 'Health Certificate'], tr: ['İşyeri Ruhsatı (önce alınmalı)', 'TAPDK Başvuru Formu', 'Sabıka Kaydı (tüm ortaklar)', 'Mesafe Uygunluk Belgesi', 'Sağlık Sertifikası'], ar: ['رخصة العمل الكاملة (يجب الحصول عليها أولاً)', 'نموذج طلب TAPDK', 'سجل الشرطة (جميع المساهمين)', 'شهادة الامتثال للمسافة', 'شهادة صحية'] },
    company_formation: { en: ['Shareholders\' Passports (notarized translations)', 'Signature Circular (İmza Sirküleri)', 'Articles of Association (MERSİS PDF)', 'Share Capital Deposit Receipt (min 10,000 TL)', 'Office Lease / Virtual Office Agreement'], tr: ['Hissedar Pasaportları (noter tercümeli)', 'İmza Sirküleri', 'Ana Sözleşme (MERSİS)', 'Sermaye Makbuzu (min 10.000 TL)', 'Kira Sözleşmesi'], ar: ['جوازات المساهمين (مترجمة)', 'توقيع دائري', 'النظام الأساسي (MERSİS)', 'إيصال رأس المال (10,000 TL كحد أدنى)', 'عقد المكتب'] },
    residence_permit: { en: ['Passport (valid 60+ days beyond permit)', '4 Biometric Photos', 'Health Insurance Policy (1 year)', 'Rental Contract / Dorm Letter', 'Tax Number', 'University Enrollment Certificate (Öğrenci Belgesi)', 'İkamet Fee Receipt'], tr: ['Pasaport', '4 Biyometrik Fotoğraf', '1 Yıllık Sağlık Sigortası', 'Kira Sözleşmesi / Yurt Belgesi', 'Vergi Numarası', 'Öğrenci Belgesi', 'İkamet Harcı Makbuzu'], ar: ['جواز السفر', '4 صور بيومترية', 'تأمين صحي لسنة', 'عقد إيجار / خطاب السكن', 'رقم ضريبي', 'شهادة تسجيل جامعي', 'إيصال رسوم الإقامة'] },
  };

  const langKey = (lang === 'tr' ? 'tr' : lang === 'ar' ? 'ar' : 'en') as 'en' | 'tr' | 'ar';
  const topicDocs = docs[topic]?.[langKey] ?? docs['cafe'][langKey];
  const listStr = topicDocs.map(d => `• ${d}`).join('\n');
  const title = topic.replace(/_/g, ' ');

  return pick(
    `📄 **Documents required for ${title}:**\n\n${listStr}\n\n> 💡 Pro tip: Always have notarized copies ready — originals + 2 photocopies for each document.\n\nNeed help with any specific step?`,
    `📄 **${title} için gerekli belgeler:**\n\n${listStr}\n\nBelirli bir adımda yardıma ihtiyacınız var mı?`,
    `📄 **المستندات المطلوبة لـ ${title}:**\n\n${listStr}\n\nهل تحتاج مساعدة في أي خطوة محددة؟`,
    lang,
  );
}

function costOffer(topic: string, lang: string): string {
  const costs: Record<string, string> = {
    cafe:       pick('Cafe/Restaurant permit total: **~5,000–15,000 TL** (Trade Registry ~500–1,500 TL + Notary ~500–2,000 TL + Municipal Permit ~2,000–5,000 TL + Fire/Hygiene inspections ~1,500–5,000 TL). Timeline: 45–90 days.', 'Kafe/Restoran ruhsatı toplam: **~5.000–15.000 TL**. Süre: 45–90 gün.', 'إجمالي تصريح المقهى/المطعم: **~5,000–15,000 TL**. المدة: 45–90 يوماً.', lang),
    retail:     pick('Retail permit total: **~2,000–5,000 TL** (Trade Registry + Notary + Municipal Permit). Timeline: 15–30 days.', 'Perakende ruhsatı: **~2.000–5.000 TL**. Süre: 15–30 gün.', 'إجمالي تصريح التجزئة: **~2,000–5,000 TL**. المدة: 15–30 يوماً.', lang),
    office:     pick('Office/Service business: **~1,500–3,000 TL** total. Fastest permit type — 10–20 days.', 'Ofis/Hizmet işletmesi: **~1.500–3.000 TL**. En hızlı ruhsat türü: 10–20 gün.', 'مكتب/خدمات: **~1,500–3,000 TL** إجمالاً. أسرع أنواع التصاريح: 10–20 يوماً.', lang),
    alcohol:    pick('TAPDK alcohol license: **~3,000–8,000 TL** (separate from business permit). Takes 4–8 weeks after business permit is issued.', 'TAPDK alkol lisansı: **~3.000–8.000 TL**. İşletme ruhsatından sonra 4–8 hafta.', 'رخصة TAPDK للكحول: **~3,000–8,000 TL**. تستغرق 4–8 أسابيع بعد رخصة العمل.', lang),
    company_formation: pick('Company formation (LTD): **~3,000–8,000 TL** total (Trade Registry ~500–1,500 TL + Notary ~1,000–3,000 TL + Bank capital deposit min 10,000 TL). Timeline: 5–10 business days.', 'Şirket kuruluşu (LTD): **~3.000–8.000 TL** + min. 10.000 TL sermaye. Süre: 5–10 iş günü.', 'تأسيس الشركة (LTD): **~3,000–8,000 TL** + إيداع رأس المال (10,000 TL على الأقل). المدة: 5–10 أيام عمل.', lang),
    residence_permit: pick('Student İkamet (residence permit): **~650–1,500 TL** (Health insurance ~650 TL/year + İkamet fee ~500–800 TL + 4 photos ~50 TL). Timeline: 3–6 weeks after appointment.', 'Öğrenci ikameti: **~650–1.500 TL**. Süre: Randevudan sonra 3–6 hafta.', 'إقامة الطالب: **~650–1,500 TL**. المدة: 3–6 أسابيع بعد الموعد.', lang),
  };

  const cost = costs[topic] ?? pick('Cost depends on your specific business type and district. Could you tell me exactly what type of business/service you need the cost for?', 'Maliyet, işletme türünüze ve ilçenize göre değişir. Tam olarak ne için maliyet istiyorsunuz?', 'التكلفة تعتمد على نوع عملك ومنطقتك. ما الذي تريد معرفة تكلفته تحديداً؟', lang);

  return pick(
    `💰 **Cost breakdown:**\n\n${cost}\n\nWould you like me to generate your full roadmap with all the steps?`,
    `💰 **Maliyet özeti:**\n\n${cost}\n\nTam adım adım yol haritanızı oluşturmamı ister misiniz?`,
    `💰 **تفاصيل التكلفة:**\n\n${cost}\n\nهل تريد مني إنشاء خارطة الطريق الكاملة بجميع الخطوات؟`,
    lang,
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Try to resolve a short/ambiguous follow-up query using conversation context.
 * Returns a response string if resolved, null if the router should continue normally.
 */
export function resolveWithContext(
  query: string,
  messages: Array<{ role: string; content: string }>,
  assistantType: string,
  language: string,
): string | null {
  if (messages.length < 2) return null; // No history to use

  const q = query.trim().toLowerCase().replace(/[?!.]+$/, '');
  const state = parseContext(messages);

  // ── 1. Affirmative resolution ────────────────────────────────────────────
  if (AFFIRMATIVES.has(q)) {
    const offer = state.lastOffer;
    const topic = state.currentTopic ?? assistantType;

    if (offer === 'roadmap' || offer === 'steps') return roadmapOffer(topic, language);
    if (offer === 'documents')                     return documentsOffer(topic, language);
    if (offer === 'cost')                          return costOffer(topic, language);

    // Generic affirmative with a known topic but unknown offer
    if (topic) return roadmapOffer(topic, language);

    return null; // Let the router handle it
  }

  // ── 1b. Negative resolution ──────────────────────────────────────────────
  // When user says "no" in context, show a helpful menu for the current topic
  // instead of letting it fall through and return wrong-agent content.
  if (NEGATIVES.has(q) && state.currentTopic) {
    const topic = state.currentTopic;
    const label = topic.replace(/_/g, ' ');
    return pick(
      `No problem! 😊 We were discussing your **${label}** — what would you like to know?\n\n• 📄 Documents required\n• 💰 Costs & fees\n• ⏱️ Timeline\n• 📋 Full step-by-step roadmap`,
      `Sorun değil! 😊 **${label}** hakkında konuşuyorduk — ne öğrenmek istersiniz?\n\n• 📄 Gerekli belgeler\n• 💰 Maliyetler\n• ⏱️ Süre\n• 📋 Tam yol haritası`,
      `لا بأس! 😊 كنا نتحدث عن **${label}** — ماذا تريد أن تعرف؟\n\n• 📄 المستندات المطلوبة\n• 💰 التكاليف\n• ⏱️ المدة الزمنية\n• 📋 خارطة الطريق الكاملة`,
      language,
    );
  }

  // ── 2. Keyword follow-ups in context ────────────────────────────────────
  const topic = state.currentTopic;
  if (!topic) return null;

  // "what documents", "what do I need", "list of docs"
  if (/\b(document|docs|papers|bring|need|required|paperwork|checklist)\b/i.test(q)) {
    return documentsOffer(topic, language);
  }

  // "how much", "cost", "fee", "price", "budget"
  if (/\b(how much|cost|fee|price|budget|expensive|cheap|afford|pay|كم|سعر|تكلفة)\b/i.test(q)) {
    return costOffer(topic, language);
  }

  // "how long", "timeline", "days", "when"
  if (/\b(how long|timeline|days|weeks|when|duration|time frame|süre|كم يستغرق)\b/i.test(q)) {
    const timelines: Record<string, string> = {
      cafe:       pick('Cafe/restaurant permits take **45–90 days** in Istanbul due to fire and hygiene inspections. Retail shops are faster at 15–30 days.', 'Kafe/restoran ruhsatı **45–90 gün** sürer. Perakende için 15–30 gün.', 'تستغرق رخصة المقهى/المطعم **45–90 يوماً** في إسطنبول.', language),
      restaurant: pick('Restaurant permits take **45–90 days** (fire + hygiene inspections are the main delay).', 'Restoran ruhsatı **45–90 gün** sürer.', 'رخصة المطعم تستغرق **45–90 يوماً**.', language),
      retail:     pick('Retail shop permits: **15–30 days** from Trade Registry to operating licence.', 'Perakende ruhsatı: **15–30 gün**.', 'رخصة التجزئة: **15–30 يوماً**.', language),
      office:     pick('Office/service business: **10–20 days** — the fastest type.', 'Ofis/hizmet: **10–20 gün** — en hızlı.', 'مكتب/خدمات: **10–20 يوماً** — الأسرع.', language),
      alcohol:    pick('TAPDK alcohol licence takes **4–8 weeks** after your business permit is issued.', 'TAPDK lisansı işletme ruhsatından sonra **4–8 hafta** sürer.', 'رخصة TAPDK تستغرق **4–8 أسابيع** بعد رخصة العمل.', language),
      company_formation: pick('Company formation (LTD) takes **5–10 business days** once all documents are ready.', 'Şirket kuruluşu **5–10 iş günü** sürer.', 'تأسيس الشركة يستغرق **5–10 أيام عمل**.', language),
      residence_permit: pick('Student residence permit: **3–6 weeks** after your appointment at the Migration Office.', 'Öğrenci ikameti: randevudan sonra **3–6 hafta**.', 'إقامة الطالب: **3–6 أسابيع** بعد الموعد.', language),
    };
    const tl = timelines[topic];
    if (tl) {
      return pick(
        `⏱️ **Timeline for ${topic.replace(/_/g, ' ')}:**\n\n${tl}\n\nWant me to generate the full step-by-step roadmap?`,
        `⏱️ **${topic.replace(/_/g, ' ')} için süre:**\n\n${tl}\n\nTam yol haritanızı ister misiniz?`,
        `⏱️ **المدة الزمنية لـ ${topic.replace(/_/g, ' ')}:**\n\n${tl}\n\nهل تريد خارطة الطريق الكاملة؟`,
        language,
      );
    }
  }

  return null; // Nothing matched — let the normal router handle it
}

/**
 * Augments a short query with context keywords so the keyword router
 * and learning cache get better signal.
 * e.g. "how much?" → "cafe cost"
 * Does NOT augment negatives or affirmatives — they are handled by resolveWithContext.
 */
export function augmentQuery(
  query: string,
  messages: Array<{ role: string; content: string }>,
): string {
  if (messages.length < 2) return query;
  const q = query.trim();
  const qLower = q.toLowerCase().replace(/[?!.]+$/, '');

  // Never augment negatives or affirmatives — handled by resolveWithContext
  if (NEGATIVES.has(qLower) || AFFIRMATIVES.has(qLower)) return q;

  // Don't augment already substantial queries
  if (q.split(/\s+/).length >= 6) return q;

  const state = parseContext(messages);
  const prefixes: string[] = [];
  if (state.currentTopic) prefixes.push(state.currentTopic.replace(/_/g, ' '));
  if (state.businessType && state.businessType !== state.currentTopic) prefixes.push(state.businessType);

  return prefixes.length ? `${prefixes.join(' ')} ${q}` : q;
}
