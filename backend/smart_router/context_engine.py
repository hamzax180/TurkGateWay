"""
context_engine.py
-----------------
Local Context Understanding Engine — Pure Python, Zero API Cost.
Supports ALL agents: Permit, Student, Lawyer.

This module understands the state of a conversation based on chat history and 
produces context-aware enhancements and direct answers WITHOUT any AI call.

How it works:
  1. `parse_context(history_text)` builds a ConversationState from chat history
  2. ConversationState tracks: current_topic, entities (city, university, etc.),
     conversation_stage, and unresolved questions.
  3. `resolve_followup(query, state, assistant_type, language)` checks if the
     current query is a direct follow-up that can be answered locally using
     the conversation state. Returns a response string or None.
  4. `augment_query(query, state)` merges context keywords into the query text
     so keyword routing and fuzzy matching work with full context.
"""

import re
from typing import Optional, List, Dict
from dataclasses import dataclass, field

# ═══════════════════════════════════════════════════════════════════════════
# ENTITY DATABASES (local knowledge, zero tokens)
# ═══════════════════════════════════════════════════════════════════════════

_CITY_ALIASES: Dict[str, str] = {
    "riyadh": "Riyadh, Saudi Arabia", "jeddah": "Jeddah, Saudi Arabia",
    "dubai": "Dubai, UAE", "abu dhabi": "Abu Dhabi, UAE",
    "cairo": "Cairo, Egypt", "amman": "Amman, Jordan",
    "beirut": "Beirut, Lebanon", "baghdad": "Baghdad, Iraq",
    "muscat": "Muscat, Oman", "doha": "Doha, Qatar",
    "kuwait city": "Kuwait City, Kuwait", "manama": "Manama, Bahrain",
    "london": "London, UK", "berlin": "Berlin, Germany",
    "paris": "Paris, France", "istanbul": "Istanbul, Turkey",
    "ankara": "Ankara, Turkey", "new york": "New York, USA",
    "washington": "Washington D.C., USA", "toronto": "Toronto, Canada",
}

_COUNTRY_ALIASES: Dict[str, str] = {
    "saudi arabia": "Saudi Arabia", "saudi": "Saudi Arabia", "ksa": "Saudi Arabia",
    "uae": "UAE", "emirates": "UAE", "egypt": "Egypt",
    "jordan": "Jordan", "lebanon": "Lebanon", "iraq": "Iraq",
    "oman": "Oman", "qatar": "Qatar", "kuwait": "Kuwait",
    "bahrain": "Bahrain", "uk": "UK", "britain": "UK",
    "germany": "Germany", "france": "France", "usa": "USA",
    "america": "USA", "canada": "Canada", "australia": "Australia",
    "morocco": "Morocco", "tunisia": "Tunisia", "algeria": "Algeria",
    "libya": "Libya", "syria": "Syria", "pakistan": "Pakistan",
    "india": "India", "china": "China",
}

_CONSULATE_INFO: Dict[str, Dict[str, str]] = {
    "Riyadh, Saudi Arabia": {"name": "Turkish Embassy in Riyadh", "address": "Riyadh Diplomatic Quarter, Al-Naseem", "appointment": "https://vize.mfa.gov.tr", "tip": "Book appointments early — slots fill fast during peak season (May-September)."},
    "Jeddah, Saudi Arabia": {"name": "Turkish Consulate General in Jeddah", "address": "Al Naeem District, Jeddah", "appointment": "https://vize.mfa.gov.tr", "tip": "Jeddah consulate also serves pilgrims, avoid booking during Hajj/Umra season."},
    "Dubai, UAE": {"name": "Turkish Consulate General in Dubai", "address": "Dubai World Trade Centre, Sheikh Zayed Rd", "appointment": "https://vize.mfa.gov.tr", "tip": "UAE nationals and some residents can get e-Visa instead."},
    "Cairo, Egypt": {"name": "Turkish Embassy in Cairo", "address": "Maadi District, Cairo", "appointment": "https://vize.mfa.gov.tr", "tip": "Cairo embassy serves all of Egypt. Bring confirmed university acceptance letter."},
    "London, UK": {"name": "Turkish Consulate General in London", "address": "Rutland Gardens, Knightsbridge, London SW7", "appointment": "https://vize.mfa.gov.tr", "tip": "UK applicants should also check if they qualify for e-Visa."},
    "Berlin, Germany": {"name": "Turkish Embassy in Berlin", "address": "Tiergartenstraße 19-21, Berlin", "appointment": "https://vize.mfa.gov.tr", "tip": "Germany has high demand — book appointment 4-6 weeks in advance."},
}

# ═══════════════════════════════════════════════════════════════════════════
# TOPIC KNOWLEDGE per agent
# ═══════════════════════════════════════════════════════════════════════════

# Keywords that reveal what topic the conversation is about
_TOPIC_KEYWORDS: Dict[str, List[str]] = {
    # --- Student ---
    "visa":             ["visa", "vize", "student visa", "tourist visa", "consulate", "embassy", "appointment"],
    "consulate":        ["consulate", "embassy", "apply from", "appointment"],
    "residence_permit": ["ikamet", "residence permit", "residence", "permit renewal", "extend stay", "goc idaresi", "migration"],
    "university_reg":   ["register", "enroll", "enrollment", "roadmap", "university", "student affairs", "admission"],
    "health_insurance": ["health insurance", "sgk", "sigorta", "insurance policy", "medical insurance", "coverage"],
    "dormitory":        ["dormitory", "dorm", "yurt", "kyk", "housing", "where to stay"],
    "scholarships":     ["scholarship", "burs", "turkiye burslari", "financial aid", "tuition"],
    "equivalency":      ["equivalency", "denklik", "diploma recognition", "apostille"],
    "transport":        ["istanbulkart", "transport card", "bus card", "metro card"],
    "deadlines":        ["deadline", "last day", "registration close", "son basvuru"],
    # --- Permit ---
    "business_permit":  ["permit", "ruhsat", "license", "licence", "workplace", "open a business", "business opening"],
    "tax_registration": ["tax", "vergi", "tax office", "tax id", "vergi dairesi", "vergi numarasi"],
    "nace_code":        ["nace", "nace code", "activity code", "faaliyet kodu", "sector code"],
    "fire_safety":      ["fire", "itfaiye", "fire safety", "fire report", "chimney", "baca"],
    "signage":          ["sign", "signage", "tabela", "frontage", "facade"],
    "alcohol_license":  ["alcohol", "tapdk", "liquor", "bar", "wine", "beer"],
    "music_license":    ["music", "live music", "canli muzik", "entertainment"],
    # --- Lawyer ---
    "company_formation":["company", "şirket", "ltd", "limited", "mersis", "trade registry", "incorporate", "formation"],
    "contract_review":  ["contract", "sözleşme", "nda", "agreement", "clause", "terms", "signing"],
    "employment_law":   ["fired", "dismissed", "termination", "severance", "employment", "kıdem", "labour", "labor"],
    "real_estate":      ["property", "apartment", "house", "rent", "lease", "tapu", "buy", "sell", "eviction"],
    "criminal":         ["police", "arrest", "criminal", "charge", "jail", "prison", "drugs", "theft", "fraud"],
    "dispute":          ["dispute", "lawsuit", "sue", "court", "mediation", "arbitration", "claim"],
    "debt":             ["debt", "unpaid", "invoice", "icra", "haciz", "collection", "money owed"],
    "work_permit":      ["work permit", "çalışma izni", "legal to work"],
    # --- Shared ---
    "documents":        ["document", "documents", "paperwork", "required", "bring", "what do i need", "papers"],
    "cost":             ["cost", "fee", "how much", "price", "pay", "payment", "lira", "tl", "ücret"],
    "timeline":         ["how long", "when", "days", "weeks", "months", "duration", "time", "süre"],
}

# ═══════════════════════════════════════════════════════════════════════════
# CONVERSATION STATE
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class ConversationState:
    current_topic: Optional[str] = None
    sub_topic: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    university: Optional[str] = None
    business_type: Optional[str] = None
    district: Optional[str] = None
    stage: str = "start"
    last_assistant_topic: Optional[str] = None
    last_assistant_offer: Optional[str] = None   # What was the assistant asking/offering?
    # Visa state tracking for smart multi-turn conversations
    visa_status: Optional[str] = None  # "unknown" | "not_applied" | "applied" | "approved"
    visa_consulate: Optional[str] = None  # e.g., "Riyadh, Saudi Arabia"
    visa_asked_clarify: bool = False  # Track if we already asked "did you get it?"


# ═══════════════════════════════════════════════════════════════════════════
# PARSER
# ═══════════════════════════════════════════════════════════════════════════

def parse_context(history_text: str) -> ConversationState:
    state = ConversationState()
    if not history_text:
        return state

    lower = history_text.lower()

    # 1. Detect topic scores
    topic_scores: Dict[str, int] = {}
    for topic, keywords in _TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in lower)
        if score > 0:
            topic_scores[topic] = score

    if topic_scores:
        state.current_topic = max(topic_scores, key=topic_scores.get)
        # Sub-topics
        if "consulate" in topic_scores and state.current_topic == "visa":
            state.sub_topic = "consulate"
        elif "documents" in topic_scores:
            state.sub_topic = "documents"
        elif "cost" in topic_scores:
            state.sub_topic = "cost"
        elif "timeline" in topic_scores:
            state.sub_topic = "timeline"

    # 2. Extract city
    for alias, canonical in _CITY_ALIASES.items():
        if alias in lower:
            state.city = canonical
            break

    # 3. Extract country
    if not state.city:
        for alias, canonical in _COUNTRY_ALIASES.items():
            if re.search(rf"\b{re.escape(alias)}\b", lower):
                state.country = canonical
                break

    # 4. Extract business type if Permit topic
    _BUSINESS_WORDS = {
        "restaurant": "Restaurant", "restoran": "Restaurant", "cafe": "Café", "kafe": "Café",
        "bakery": "Bakery", "pharmacy": "Pharmacy", "eczane": "Pharmacy",
        "barber": "Barber", "berber": "Barber", "gym": "Gym", "office": "Office",
        "retail": "Retail", "shop": "Shop", "clothing": "Clothing Store",
    }
    for kw, name in _BUSINESS_WORDS.items():
        if kw in lower:
            state.business_type = name
            break

    # 5. Extract district
    _DISTRICTS = ["besiktas", "kadikoy", "fatih", "beyoglu", "sisli", "bakirkoy",
                  "uskudar", "sariyer", "maltepe", "pendik", "esenyurt", "basaksehir",
                  "zeytinburnu", "kartal", "atasehir", "umraniye", "kagithane", "eyup"]
    for d in _DISTRICTS:
        if d in lower:
            state.district = d.title()
            break

    # 6. Stage and last assistant analysis
    assistant_parts = history_text.lower().split("[assistant]:")
    if len(assistant_parts) > 2:
        state.stage = "informed"
    elif len(assistant_parts) > 1:
        state.stage = "clarifying"

    if len(assistant_parts) > 1:
        last_a = assistant_parts[-1][:500].lower()
        # Detect what the assistant was offering
        state.last_assistant_offer = _detect_offer(last_a)
        # Detect topic of last message
        for topic, keywords in _TOPIC_KEYWORDS.items():
            if any(kw in last_a for kw in keywords[:3]):
                state.last_assistant_topic = topic
                break

    # NEW: Detect visa status from conversation history (for smart multi-turn conversations)
    if state.current_topic == "visa":
        lower_hist = history_text.lower()
        
        # Check if we already asked the clarifying question "did you get your visa?"
        if any(phrase in lower_hist for phrase in [
            "did you already get", "have you got", "do you have your visa",
            "already obtain", "obtained your", "هل حصلت على الفيزا", "فيزا حصلت",
            "almış mısınız", "aldınız mı", "получили ли вы"
        ]):
            state.visa_asked_clarify = True
        
        # Extract visa status from user responses
        if any(word in lower_hist for word in ["yes", "already have", "got it", "obtained", "i have", "evet", "aldım", "نعم", "حصلت"]):
            state.visa_status = "approved"
        elif any(word in lower_hist for word in ["no", "not yet", "haven't", "need to apply", "not applied", "hayır", "almadım", "لا", "لم أحصل"]):
            state.visa_status = "not_applied"
        
        # Extract consulate location from mentions like "apply from riyadh" or "dubai consulate"
        for city, canonical in _CITY_ALIASES.items():
            if city in lower_hist and any(word in lower_hist for word in ["apply from", "apply at", "from", "consulate", "embassy", "apply", "باستخدام", "من", "في"]):
                state.visa_consulate = canonical
                state.sub_topic = "consulate"
                break

    return state


def _detect_offer(msg: str) -> Optional[str]:
    """What was the assistant offering/asking in its last message?"""
    if any(w in msg for w in ["document", "preparing", "papers", "what you need", "you'll need", "do you need help with"]):
        return "documents"
    if any(w in msg for w in ["consulate", "embassy", "appointment portal"]):
        return "consulate"
    if any(w in msg for w in ["cost", "fee", "price", "how much"]):
        return "cost"
    if any(w in msg for w in ["how long", "timeline", "duration", "days"]):
        return "timeline"
    if any(w in msg for w in ["nationality", "passport", "which country"]):
        return "nationality"
    if any(w in msg for w in ["register", "university", "enroll", "which university"]):
        return "registration"
    if any(w in msg for w in ["insurance", "sigorta", "sgk"]):
        return "insurance"
    if any(w in msg for w in ["district", "ilçe", "municipality", "belediye"]):
        return "district"
    if any(w in msg for w in ["business", "işletme", "type of business", "what type"]):
        return "business_type"
    if any(w in msg for w in ["contract", "sözleşme", "clause"]):
        return "contract"
    if any(w in msg for w in ["company", "şirket", "trade registry"]):
        return "company"
    if any(w in msg for w in ["step", "walk you through", "adım", "next step"]):
        return "steps"
    if any(w in msg for w in ["equivalency", "denklik", "apostille"]):
        return "equivalency"
    if any(w in msg for w in ["dorm", "yurt", "housing", "accommodation"]):
        return "dormitory"
    return None


# ═══════════════════════════════════════════════════════════════════════════
# AFFIRMATIVES
# ═══════════════════════════════════════════════════════════════════════════

_AFFIRMATIVES = {
    "yes", "yeah", "yep", "sure", "ok", "okay", "of course", "absolutely",
    "please", "go ahead", "tell me", "show me", "let's go", "yea", "ya",
    "evet", "tamam", "olur", "tabi", "tabii", "lütfen",
    "نعم", "ايوه", "أجل", "طبرا", "طبراً", "ماشي", "اكيد", "بلا", "أكيد",
}


# ═══════════════════════════════════════════════════════════════════════════
# RESPONSE TEMPLATES (all local, zero tokens)
# ═══════════════════════════════════════════════════════════════════════════

def _r(en: str, tr: str, lang: str) -> str:
    return tr if lang == "tr" else en


# --- STUDENT RESPONSES ---

def _visa_documents(lang: str) -> str:
    return _r(
        "📄 **Documents needed for a Turkish Student Visa:**\n\n"
        "1. Valid passport (min. 6 months validity)\n"
        "2. University acceptance/admission letter\n"
        "3. Completed visa application form\n"
        "4. Biometric photos (2 copies)\n"
        "5. Proof of sufficient funds (bank statement)\n"
        "6. Health insurance policy\n"
        "7. Accommodation proof (dorm approval or lease)\n\n"
        "Once you have these ready, book your appointment at **vize.mfa.gov.tr** 🗓️\n\nNeed help with any of these? 😊",
        "📄 **Öğrenci vizesi için gerekli belgeler:**\n\n"
        "1. Geçerli pasaport (en az 6 ay)\n"
        "2. Üniversite kabul mektubu\n"
        "3. Doldurulmuş vize başvuru formu\n"
        "4. Biyometrik fotoğraf (2 adet)\n"
        "5. Yeterli mali kaynak belgesi (banka hesap özeti)\n"
        "6. Sağlık sigortası poliçesi\n"
        "7. Konaklama belgesi (yurt onayı veya kira sözleşmesi)\n\n"
        "Belgeler hazır olunca randevu alabiliriz! Başka sorun var mı? 😊", lang)


def _ikamet_documents(lang: str) -> str:
    return _r(
        "📄 **Documents for Student Residence Permit (İkamet):**\n\n"
        "1. Valid passport (min. 60 days validity)\n"
        "2. Biometric photos (4 copies)\n"
        "3. Student enrollment certificate (current)\n"
        "4. Health insurance policy\n"
        "5. Address declaration (e-Devlet)\n"
        "6. Residence permit application fee receipt\n\n"
        "Shall I walk you through each step? 😊",
        "📄 **İkamet izni (öğrenci) için gerekli belgeler:**\n\n"
        "1. Pasaport (en az 60 gün geçerli)\n2. Biyometrik fotoğraf (4 adet)\n"
        "3. Öğrenci belgesi (güncel)\n4. Sağlık sigortası poliçesi\n"
        "5. Adres beyanı (e-Devlet)\n6. İkamet başvuru ücreti dekontu\n\n"
        "Adım adım anlatmamı ister misin? 😊", lang)


def _uni_documents(lang: str) -> str:
    return _r(
        "📄 **Documents for University Registration:**\n\n"
        "1. Admission / acceptance letter\n2. Passport (original + copy)\n"
        "3. High school diploma / transcripts (originals)\n"
        "4. Apostille or equivalency certificate (Denklik)\n"
        "5. Biometric photos (6 copies)\n6. Student visa\n\n"
        "Would you like help with the equivalency (Denklik) process? 🎓",
        "📄 **Üniversite kaydı için gerekli belgeler:**\n\n"
        "1. Kabul mektubu\n2. Pasaport\n3. Diploma / Transkript (orijinal)\n"
        "4. Apostille veya denklik belgesi\n5. Biyometrik fotoğraf (6 adet)\n"
        "6. Öğrenci vizesi\n\nDenklik süreci hakkında bilgi ister misin? 🎓", lang)


def _insurance_info(lang: str) -> str:
    return _r(
        "🏥 **Health Insurance for Students in Turkey:**\n\n"
        "• **SGK (State):** ~700-900 TL/year — covers public hospitals\n"
        "• **Private:** 1,500-4,000 TL/year — faster service, private hospitals\n"
        "• You can get SGK by applying at your university's Student Affairs office\n"
        "• For residence permit applications, insurance must cover your full stay\n\n"
        "Would you like to compare insurance providers? 💡",
        "🏥 **Türkiye'de Öğrenci Sağlık Sigortası:**\n\n"
        "• **SGK (Devlet):** ~700-900 TL/yıl — devlet hastaneleri\n"
        "• **Özel sigorta:** 1,500-4,000 TL/yıl — özel hastaneler\n"
        "• SGK başvurusu üniversite öğrenci işlerinden yapılabilir\n"
        "• İkamet başvurusu için sigorta tüm kalış sürenizi kapsamalı\n\n"
        "Sigorta şirketlerini karşılaştırmak ister misin? 💡", lang)


def _dorm_info(lang: str) -> str:
    return _r(
        "🏠 **Student Housing Options in Turkey:**\n\n"
        "1. **KYK Dormitories (State):** ~700-1,500 TL/month — apply via kyk.gov.tr\n"
        "2. **University Dorms:** Varies — apply through your university portal\n"
        "3. **Private Dorms:** 3,000-8,000 TL/month — more comfort, modern facilities\n"
        "4. **Shared Apartment:** 3,000-7,000 TL/month per person (sahibinden.com)\n\n"
        "💡 KYK applications open in August. Apply early — spaces fill fast!\n\nWant help finding housing near your university? 🏠",
        "🏠 **Türkiye'de Öğrenci Konaklama Seçenekleri:**\n\n"
        "1. **KYK Yurdu (Devlet):** ~700-1,500 TL/ay — kyk.gov.tr'den başvur\n"
        "2. **Üniversite Yurdu:** Değişir — üniversite portalından başvur\n"
        "3. **Özel Yurt:** 3,000-8,000 TL/ay\n"
        "4. **Paylaşımlı Daire:** 3,000-7,000 TL/ay kişi başı (sahibinden.com)\n\n"
        "💡 KYK başvuruları Ağustos'ta açılır. Erken başvur!\nKonaklama bulmak için yardım ister misin? 🏠", lang)


def _equivalency_info(lang: str) -> str:
    return _r(
        "📜 **Diploma Equivalency (Denklik) Process:**\n\n"
        "1. Go to the nearest MEB (Ministry of Education) İl Müdürlüğü\n"
        "2. Or apply online via **turkiye.gov.tr** (e-Devlet)\n"
        "3. Required: High school diploma (original), Apostille, Turkish translation (notarized), Passport copy\n"
        "4. Processing time: 2-6 weeks\n5. Fee: ~250 TL\n\n"
        "Need help finding the nearest MEB office? 📍",
        "📜 **Denklik İşlemi:**\n\n"
        "1. En yakın MEB İl Müdürlüğü'ne git\n"
        "2. veya **turkiye.gov.tr** (e-Devlet) üzerinden başvur\n"
        "3. Gerekli: Lise diploması (orijinal), Apostille, Türkçe tercüme (noter), Pasaport fotokopisi\n"
        "4. İşlem süresi: 2-6 hafta\n5. Ücret: ~250 TL\n\n"
        "En yakın MEB ofisini bulmak için yardım ister misin? 📍", lang)


def _visa_cost(lang: str) -> str:
    return _r("💰 Turkish student visa fees vary by nationality, typically **50–100 EUR**. Some countries have reciprocal agreements. Which country are you applying from? 🎯",
              "💰 Öğrenci vizesi ücreti ülkeden ülkeye değişir, ortalama **50-100 EUR**. Hangi ülkeden başvuruyorsun?", lang)


def _visa_timeline(lang: str) -> str:
    return _r("⏱️ Turkish student visa processing takes **5–15 business days**. During summer it can be 3-4 weeks. Start **4–6 weeks before** your travel date. 📅\n\nWould you like tips on preparing documents faster?",
              "⏱️ Öğrenci vizesi işlemi **5-15 iş günü** sürer. Yaz döneminde 3-4 hafta olabilir. **4-6 hafta önceden** başvurmanı öneririm. 📅", lang)


# --- PERMIT RESPONSES ---

def _permit_documents(lang: str, business: str = "Business") -> str:
    return _r(
        f"📄 **Documents needed for a {business} Operating Permit:**\n\n"
        "1. ID / Passport (original + copy)\n"
        "2. Notarized lease agreement (Kira Sözleşmesi)\n"
        "3. Tax plate (Vergi Levhası) from your Tax Office\n"
        "4. NACE code certificate (activity classification)\n"
        "5. Signed application form (from municipality)\n"
        "6. Commercial registry gazette (for companies)\n"
        "7. Fire safety report (for food/hospitality businesses)\n\n"
        "Would you like me to explain the NACE code process? 🎯",
        f"📄 **{business} İşletme Ruhsatı İçin Gerekli Belgeler:**\n\n"
        "1. Kimlik / Pasaport\n2. Noterden onaylı kira sözleşmesi\n"
        "3. Vergi levhası\n4. NACE kodu belgesi\n"
        "5. İmzalı başvuru formu (belediyeden)\n6. Ticaret sicil gazetesi (şirketler için)\n"
        "7. İtfaiye raporu (gıda/konaklama işletmeleri için)\n\n"
        "NACE kodu süreci hakkında bilgi ister misin? 🎯", lang)


def _permit_cost(lang: str) -> str:
    return _r(
        "💰 **Business Permit Cost Breakdown (Approximate):**\n\n"
        "• Municipality permit fee: 2,000–5,000 TL\n"
        "• Fire safety report: 1,500–3,000 TL\n"
        "• Notary fees: 500–1,500 TL\n"
        "• Tax registration: Free\n"
        "• Total estimate: **5,000–15,000 TL** depending on district and business type\n\n"
        "Which district are you opening in? That'll give me a more precise figure. 📍",
        "💰 **İşletme Ruhsatı Maliyet Tahmini:**\n\n"
        "• Belediye ruhsat harcı: 2,000–5,000 TL\n"
        "• İtfaiye raporu: 1,500–3,000 TL\n"
        "• Noter masrafları: 500–1,500 TL\n"
        "• Vergi kaydı: Ücretsiz\n"
        "• Tahmini toplam: **5,000–15,000 TL**\n\n"
        "Hangi ilçede açacaksın? Daha kesin bilgi verebilirim. 📍", lang)


def _permit_timeline(lang: str) -> str:
    return _r("⏱️ Business permit processing in Istanbul typically takes **30–45 days** for standard businesses, **45–60 days** for food/hospitality. The fire safety report is usually the bottleneck. 📅\n\nWant me to show the step-by-step timeline?",
              "⏱️ İstanbul'da işletme ruhsatı süreci standart işletmeler için **30-45 gün**, gıda/konaklama için **45-60 gün** sürer. İtfaiye raporu genellikle en uzun adımdır. 📅\n\nAdım adım zaman çizelgesini göstereyim mi?", lang)


def _nace_info(lang: str) -> str:
    return _r(
        "🔢 **NACE Code (Activity Code) Guide:**\n\n"
        "The NACE code classifies your business activity for tax and permit purposes.\n\n"
        "• Get it from your Tax Office (Vergi Dairesi) during registration\n"
        "• Common codes: 56.10 (Restaurant), 56.30 (Café/Bar), 47.71 (Clothing), 47.73 (Pharmacy)\n"
        "• Your accountant (Mali Müşavir) can help choose the right code\n"
        "• Wrong code = wrong permit category → delays!\n\n"
        "What type of business are you opening? I'll find your NACE code. 🎯",
        "🔢 **NACE Kodu (Faaliyet Kodu) Rehberi:**\n\n"
        "NACE kodu vergi ve ruhsat için işletme faaliyetinizi sınıflandırır.\n\n"
        "• Vergi Dairesi'nden kayıt sırasında alınır\n"
        "• Yaygın kodlar: 56.10 (Restoran), 56.30 (Kafe/Bar), 47.71 (Giyim), 47.73 (Eczane)\n"
        "• Mali müşaviriniz doğru kodu seçmenize yardımcı olabilir\n\n"
        "Hangi tür işletme açıyorsun? NACE kodunu bulayım. 🎯", lang)


def _tax_info(lang: str) -> str:
    return _r(
        "🧾 **Tax Registration for Business in Turkey:**\n\n"
        "1. Visit your nearest **Vergi Dairesi** (Tax Office)\n"
        "2. Bring: Passport/ID, lease agreement, NACE code\n"
        "3. Register for a **Vergi Numarası** (Tax Number)\n"
        "4. Get your **Vergi Levhası** (Tax Plate) — needed for the permit\n"
        "5. Processing: Same day!\n\n"
        "Do you already have an accountant (Mali Müşavir)? They make this much easier. 💡",
        "🧾 **Türkiye'de Vergi Kaydı:**\n\n"
        "1. En yakın **Vergi Dairesi**'ne git\n"
        "2. Getir: Kimlik, kira sözleşmesi, NACE kodu\n"
        "3. **Vergi Numarası** al\n"
        "4. **Vergi Levhası** al — ruhsat için gerekli\n"
        "5. İşlem süresi: Aynı gün!\n\n"
        "Mali müşavirin var mı? Süreci çok kolaylaştırır. 💡", lang)


# --- LAWYER RESPONSES ---

def _company_formation_docs(lang: str) -> str:
    return _r(
        "📄 **Documents for Company Formation (Ltd. Şti.) in Turkey:**\n\n"
        "1. Notarized passport copy (+ Turkish translation)\n"
        "2. Turkish Tax Number (Vergi Numarası)\n"
        "3. Articles of Association (Ana Sözleşme) — drafted by lawyer\n"
        "4. Signature declaration (İmza Beyannamesi — from notary)\n"
        "5. Company address proof (lease agreement)\n"
        "6. Initial capital deposit receipt (min. 10,000 TL for Ltd.)\n\n"
        "Shall I explain the Trade Registry (Ticaret Sicili) process? ⚖️",
        "📄 **Şirket Kuruluşu (Ltd. Şti.) İçin Gerekli Belgeler:**\n\n"
        "1. Noterden onaylı pasaport (+ Türkçe tercüme)\n"
        "2. Vergi numarası\n3. Ana sözleşme (avukat hazırlar)\n"
        "4. İmza beyannamesi (noterden)\n5. Şirket adresi belgesi (kira sözleşmesi)\n"
        "6. Sermaye yatırma dekontu (min. 10,000 TL)\n\n"
        "Ticaret Sicili sürecini anlatmamı ister misin? ⚖️", lang)


def _company_formation_cost(lang: str) -> str:
    return _r(
        "💰 **Company Formation Cost (Ltd. Şti.):**\n\n"
        "• Notary fees: 1,500–3,000 TL\n• Trade Registry: 2,000–4,000 TL\n"
        "• Accountant setup: 2,000–5,000 TL\n• Lawyer (optional): 5,000–15,000 TL\n"
        "• Min. capital: 10,000 TL (deposited and usable after)\n"
        "• **Total: ~15,000–30,000 TL**\n\n"
        "Want me to break down the timeline too? ⏱️",
        "💰 **Şirket Kuruluş Maliyeti (Ltd. Şti.):**\n\n"
        "• Noter: 1,500–3,000 TL\n• Ticaret Sicili: 2,000–4,000 TL\n"
        "• Mali Müşavir: 2,000–5,000 TL\n• Avukat (opsiyonel): 5,000–15,000 TL\n"
        "• Min. sermaye: 10,000 TL\n• **Toplam: ~15,000–30,000 TL**\n\n"
        "Zaman çizelgesini de anlatayım mı? ⏱️", lang)


def _company_formation_timeline(lang: str) -> str:
    return _r("⏱️ Company formation in Turkey takes **5–10 business days** with e-signature, up to **2–3 weeks** with physical signatures. MERSİS registration is online and takes 1-2 days. 📅",
              "⏱️ Türkiye'de şirket kuruluşu e-imza ile **5-10 iş günü**, fiziksel imza ile **2-3 hafta** sürer. MERSİS kaydı online ve 1-2 gün sürer. 📅", lang)


def _contract_review_docs(lang: str) -> str:
    return _r(
        "📄 **For a Contract Review, please prepare:**\n\n"
        "1. The full contract (all pages, including annexes)\n"
        "2. Any correspondence related to the contract\n"
        "3. Your ID / Passport\n4. Power of Attorney (Vekâletname) if someone else signed\n\n"
        "💡 **Tip:** Never sign a contract written only in Turkish if you don't read Turkish — always get a certified translation first.\n\nWant me to highlight the common red flags in Turkish contracts? ⚠️",
        "📄 **Sözleşme İncelemesi İçin Hazırlayın:**\n\n"
        "1. Sözleşmenin tamamı (ekler dahil)\n"
        "2. İlgili yazışmalar\n"
        "3. Kimlik / Pasaport\n4. Vekâletname (başkası imzaladıysa)\n\n"
        "💡 **İpucu:** Türkçe bilmiyorsanız, yalnızca Türkçe yazılmış sözleşmeleri imzalamadan önce yeminli tercüme yaptırın.\n\nTürk sözleşmelerindeki riskli maddeleri anlatayım mı? ⚠️", lang)


def _employment_law_info(lang: str) -> str:
    return _r(
        "⚖️ **Employment Law in Turkey — Key Rights:**\n\n"
        "• **Notice period:** 2-8 weeks depending on years of service\n"
        "• **Severance (Kıdem Tazminatı):** 1 month salary per year worked (if >1 year)\n"
        "• **Wrongful dismissal:** You can file a reinstatement lawsuit within 1 month\n"
        "• **Unpaid wages:** Labour Court (İş Mahkemesi) handles disputes\n"
        "• **Important:** Before court, mandatory mediation (Arabuluculuk) is required\n\n"
        "Were you fired, or are you dealing with a different employment issue? 🤝",
        "⚖️ **Türkiye İş Hukuku — Temel Haklar:**\n\n"
        "• **İhbar süresi:** Çalışma süresine göre 2-8 hafta\n"
        "• **Kıdem tazminatı:** Yıl başına 1 aylık maaş (1 yıldan fazla ise)\n"
        "• **Haksız fesih:** 1 ay içinde işe iade davası açılabilir\n"
        "• **Ödenmemiş maaş:** İş Mahkemesi yoluyla çözülür\n"
        "• **Önemli:** Dava öncesi zorunlu arabuluculuk gerekir\n\n"
        "İşten mi çıkarıldın, yoksa başka bir iş hukuku sorunu mu var? 🤝", lang)


def _real_estate_docs(lang: str) -> str:
    return _r(
        "📄 **Documents for Real Estate Transactions in Turkey:**\n\n"
        "**For Buying:**\n1. Passport (+ Turkish translation)\n"
        "2. Turkish Tax Number\n3. Property valuation report (SPK licensed)\n"
        "4. DASK earthquake insurance\n5. Title deed (Tapu) transfer appointment\n\n"
        "**For Renting:**\n1. Passport/ID\n2. Signed lease agreement\n"
        "3. Deposit (usually 1-3 months)\n4. Guarantor (Kefil) may be required\n\n"
        "Are you buying or renting? 🏠",
        "📄 **Türkiye'de Gayrimenkul İşlemleri İçin Belgeler:**\n\n"
        "**Satın Alma:**\n1. Pasaport (+ Türkçe tercüme)\n"
        "2. Vergi numarası\n3. SPK lisanslı değerleme raporu\n"
        "4. DASK deprem sigortası\n5. Tapu devir randevusu\n\n"
        "**Kiralama:**\n1. Kimlik/Pasaport\n2. İmzalı kira sözleşmesi\n"
        "3. Depozito (genellikle 1-3 ay)\n4. Kefil gerekebilir\n\n"
        "Satın alıyor musun yoksa kiralıyor musun? 🏠", lang)


def _criminal_info(lang: str) -> str:
    return _r(
        "⚠️ **Criminal Law — What You Should Know:**\n\n"
        "1. **Right to a lawyer:** You have the right to an attorney at every stage\n"
        "2. **Detention limit:** Max 24 hours without court order (can extend to 4 days for organized crime)\n"
        "3. **Don't sign anything** in Turkish without a translator present\n"
        "4. **Contact your embassy** immediately if you're a foreign national\n"
        "5. **Drug charges** carry heavy sentences in Turkey (4-12 years for possession)\n\n"
        "Are you the accused, a victim, or asking for someone else? This helps me advise correctly. ⚖️",
        "⚠️ **Ceza Hukuku — Bilmeniz Gerekenler:**\n\n"
        "1. **Avukat hakkı:** Her aşamada avukat talep edebilirsiniz\n"
        "2. **Gözaltı süresi:** Mahkeme kararı olmadan max 24 saat\n"
        "3. **Tercümansız Türkçe belge imzalamayın**\n"
        "4. **Yabancıysanız büyükelçiliğinize haber verin**\n"
        "5. **Uyuşturucu suçları** Türkiye'de ağır cezalar taşır\n\n"
        "Sanık mısınız, mağdur musunuz, yoksa başkası için mi soruyorsunuz? ⚖️", lang)


def _debt_info(lang: str) -> str:
    return _r(
        "💳 **Debt Collection & İcra (Enforcement) in Turkey:**\n\n"
        "• **İcra Takibi:** Creditor files at the Enforcement Office (İcra Dairesi)\n"
        "• **7-day objection window** after receiving the payment order\n"
        "• **Bank account freeze (Haciz):** Court can freeze your accounts\n"
        "• **Salary garnishment:** Max 1/4 of your salary can be seized\n"
        "• **Defense:** File an objection (itiraz) within 7 days to stop the process\n\n"
        "Are you the creditor or the debtor? 🤝",
        "💳 **İcra ve Borç Tahsilat Süreci:**\n\n"
        "• **İcra Takibi:** Alacaklı İcra Dairesi'ne başvurur\n"
        "• Ödeme emri aldıktan sonra **7 gün itiraz süresi** var\n"
        "• **Hesap haczi:** Mahkeme hesaplarınızı dondurabilir\n"
        "• **Maaş haczi:** Maaşınızın max 1/4'ü kesilebilir\n"
        "• **Savunma:** 7 gün içinde itiraz (dilekçe) ile süreci durdurabilirsiniz\n\n"
        "Alacaklı mısınız yoksa borçlu musunuz? 🤝", lang)


# ═══════════════════════════════════════════════════════════════════════════
# CONSULATE FORMATTER
# ═══════════════════════════════════════════════════════════════════════════

def _format_consulate(city: str, info: dict, lang: str) -> str:
    return _r(
        f"📍 **Turkish Consulate info for {city}:**\n\n"
        f"🏛️ **Name:** {info['name']}\n📬 **Address:** {info['address']}\n"
        f"🌐 **Appointment Portal:** [{info['appointment']}]({info['appointment']})\n\n"
        f"💡 **Pro Tip:** {info['tip']}\n\n"
        f"Would you like help preparing the documents you'll need for your appointment? 📄",
        f"📍 **{city} için Türk Konsolosluğu bilgileri:**\n\n"
        f"🏛️ **Adı:** {info['name']}\n📬 **Adres:** {info['address']}\n"
        f"🌐 **Randevu:** {info['appointment']}\n\n"
        f"💡 **İpucu:** {info['tip']}\n\n"
        f"Belgeleri hazırlamana yardımcı olayım mı? 📄", lang)


# ═══════════════════════════════════════════════════════════════════════════
# LOCATION EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════

_LOCATION_PATTERNS = [re.compile(p, re.IGNORECASE) for p in [
    r"\bfrom\s+(\w[\w\s]{1,20})\b", r"\bin\s+(\w[\w\s]{1,20})\b",
    r"\b(apply|applying)\s+(from|in)\s+(\w[\w\s]{1,20})\b",
    r"\b(at|from)\s+(\w[\w\s]{1,20})\s+(consulate|embassy)\b",
]]

def _extract_location(query: str) -> Optional[str]:
    q = query.lower()
    for alias, canonical in _CITY_ALIASES.items():
        if alias in q: return canonical
    for alias, canonical in _COUNTRY_ALIASES.items():
        if re.search(rf"\b{re.escape(alias)}\b", q): return alias
    for pattern in _LOCATION_PATTERNS:
        m = pattern.search(query)
        if m:
            loc = m.group(m.lastindex).strip().lower()
            if len(loc) > 2 and loc not in {"the", "my", "our", "this", "that"}:
                return loc
    return None


# ═══════════════════════════════════════════════════════════════════════════
# AFFIRMATIVE → TOPIC RESOLUTION MAP
# ═══════════════════════════════════════════════════════════════════════════

# Maps (assistant_offer, current_topic) → response function
_AFFIRM_MAP = {
    # Student
    ("documents", "visa"):              _visa_documents,
    ("documents", "consulate"):         _visa_documents,
    ("documents", "residence_permit"):  _ikamet_documents,
    ("documents", "university_reg"):    _uni_documents,
    ("documents", "health_insurance"):  _insurance_info,
    ("cost", "visa"):                   _visa_cost,
    ("cost", "consulate"):              _visa_cost,
    ("timeline", "visa"):               _visa_timeline,
    ("timeline", "consulate"):          _visa_timeline,
    ("insurance", "health_insurance"):  _insurance_info,
    ("insurance", "residence_permit"):  _insurance_info,
    ("equivalency", "university_reg"):  _equivalency_info,
    ("equivalency", "equivalency"):     _equivalency_info,
    ("dormitory", "dormitory"):         _dorm_info,
    ("registration", "university_reg"): _uni_documents,
    # Permit
    ("documents", "business_permit"):   _permit_documents,
    ("documents", "tax_registration"):  _tax_info,
    ("documents", "nace_code"):         _nace_info,
    ("cost", "business_permit"):        _permit_cost,
    ("timeline", "business_permit"):    _permit_timeline,
    ("business_type", "business_permit"): _nace_info,
    ("district", "business_permit"):    _permit_cost,
    # Lawyer
    ("documents", "company_formation"): _company_formation_docs,
    ("documents", "contract_review"):   _contract_review_docs,
    ("documents", "real_estate"):       _real_estate_docs,
    ("cost", "company_formation"):      _company_formation_cost,
    ("timeline", "company_formation"):  _company_formation_timeline,
    ("contract", "contract_review"):    _contract_review_docs,
    ("company", "company_formation"):   _company_formation_docs,
    ("steps", "company_formation"):     _company_formation_timeline,
    ("steps", "business_permit"):       _permit_timeline,
}


# ═══════════════════════════════════════════════════════════════════════════
# MAIN RESOLVER
# ═══════════════════════════════════════════════════════════════════════════

def resolve_followup(
    query: str,
    state: ConversationState,
    assistant_type: str = "student",
    language: str = "en",
    history_text: str = ""
) -> Optional[str]:
    """
    Try to answer a follow-up question locally using conversation state.
    """
    q_lower = query.lower().strip().rstrip("?!.")

    # ------------------------------------------------------------------
    # 1. AFFIRMATIVE RESOLUTION
    # ------------------------------------------------------------------
    if q_lower in _AFFIRMATIVES:
        offer = state.last_assistant_offer
        topic = state.current_topic
        print(f"[ContextEngine] Affirmative '{q_lower}' — offer={offer}, topic={topic}")

        # Try exact match from affirmation map
        key = (offer, topic)
        if key in _AFFIRM_MAP:
            fn = _AFFIRM_MAP[key]
            return fn(language)

        # Fallback: if we know what was offered, serve documents for current topic
        if offer == "documents":
            if assistant_type == "student":  return _visa_documents(language)
            if assistant_type == "permit":   return _permit_documents(language, state.business_type or "Business")
            if assistant_type == "lawyer":   return _company_formation_docs(language)
        if offer == "cost":
            if assistant_type == "student":  return _visa_cost(language)
            if assistant_type == "permit":   return _permit_cost(language)
            if assistant_type == "lawyer":   return _company_formation_cost(language)
        if offer == "timeline":
            if assistant_type == "student":  return _visa_timeline(language)
            if assistant_type == "permit":   return _permit_timeline(language)
            if assistant_type == "lawyer":   return _company_formation_timeline(language)
        if offer == "consulate" and state.city:
            info = _CONSULATE_INFO.get(state.city)
            if info: return _format_consulate(state.city, info, language)

        # Last resort for affirmatives: if we have a topic, give default info
        if topic and offer:
            # Check if there's a generic fallback
            for potential_offer in ["documents", "cost", "steps"]:
                fallback_key = (potential_offer, topic)
                if offer == potential_offer and fallback_key in _AFFIRM_MAP:
                    return _AFFIRM_MAP[fallback_key](language)

    # ------------------------------------------------------------------
    # 2. CONSULATE RESOLUTION (any agent)
    # ------------------------------------------------------------------
    if state.current_topic in ("visa", "consulate") or state.last_assistant_topic in ("visa", "consulate"):
        location = _extract_location(query) or state.city
        if location:
            normalized = None
            loc_lower = location.lower()
            for alias, canonical in _CITY_ALIASES.items():
                if alias in loc_lower or loc_lower in alias:
                    normalized = canonical
                    break
            if not normalized:
                for alias, canonical in _COUNTRY_ALIASES.items():
                    if alias in loc_lower or loc_lower in alias:
                        for ca, cc in _CITY_ALIASES.items():
                            if canonical.lower() in cc.lower():
                                normalized = cc; break
                        if not normalized: normalized = canonical
                        break
            if normalized and normalized in _CONSULATE_INFO:
                return _format_consulate(normalized, _CONSULATE_INFO[normalized], language)
            elif normalized:
                return _r(
                    f"📍 For **{normalized}**, book your visa appointment at **[vize.mfa.gov.tr](https://vize.mfa.gov.tr)** 🌐\n\nWhat nationality is your passport? 📄",
                    f"📍 **{normalized}** için resmi randevu sistemi: **vize.mfa.gov.tr** 🌐\n\nHangi ülke pasaportunla başvuruyorsun?", language)

    # ------------------------------------------------------------------
    # 3. KEYWORD-TRIGGERED RESOLUTION (all agents)
    # ------------------------------------------------------------------
    topic = state.current_topic

    # Documents
    if any(w in q_lower for w in ["document", "need", "bring", "required", "papers", "what do i need"]):
        if topic in ("visa", "consulate"):        return _visa_documents(language)
        if topic == "residence_permit":            return _ikamet_documents(language)
        if topic == "university_reg":              return _uni_documents(language)
        if topic == "business_permit":             return _permit_documents(language, state.business_type or "Business")
        if topic == "company_formation":           return _company_formation_docs(language)
        if topic == "contract_review":             return _contract_review_docs(language)
        if topic == "real_estate":                 return _real_estate_docs(language)
        if topic == "tax_registration":            return _tax_info(language)

    # Cost
    if any(w in q_lower for w in ["how much", "cost", "fee", "price", "pay"]):
        if topic in ("visa", "consulate"):         return _visa_cost(language)
        if topic == "business_permit":             return _permit_cost(language)
        if topic == "company_formation":           return _company_formation_cost(language)

    # Timeline
    if any(w in q_lower for w in ["how long", "when", "days", "duration"]):
        if topic in ("visa", "consulate"):         return _visa_timeline(language)
        if topic == "business_permit":             return _permit_timeline(language)
        if topic == "company_formation":           return _company_formation_timeline(language)

    # Domain-specific keywords
    if any(w in q_lower for w in ["nace", "activity code", "faaliyet"]):    return _nace_info(language)
    if any(w in q_lower for w in ["tax", "vergi", "tax office"]):           return _tax_info(language)
    if any(w in q_lower for w in ["insurance", "sigorta", "sgk"]):          return _insurance_info(language)
    if any(w in q_lower for w in ["dorm", "yurt", "housing", "accommodation"]): return _dorm_info(language)
    if any(w in q_lower for w in ["equivalency", "denklik", "apostille"]):  return _equivalency_info(language)
    if any(w in q_lower for w in ["criminal", "arrest", "police", "drugs"]): return _criminal_info(language)
    if any(w in q_lower for w in ["debt", "icra", "haciz", "unpaid"]):       return _debt_info(language)
    if any(w in q_lower for w in ["fired", "dismissed", "severance", "termination"]): return _employment_law_info(language)

    return None


# ═══════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════

def handle_with_context(
    query: str,
    history_text: str,
    assistant_type: str = "student",
    language: str = "en"
) -> Optional[str]:
    """Main entry point. Parses history, attempts local resolution."""
    state = parse_context(history_text)
    answer = resolve_followup(query, state, assistant_type, language, history_text=history_text)
    if answer:
        return answer
    return None


def get_augmented_query(query: str, history_text: str) -> str:
    """Returns the query augmented with context keywords."""
    state = parse_context(history_text)
    q = query.strip()
    if len(q.split()) >= 10:
        return q
    prefixes = []
    if state.current_topic:
        prefixes.append(state.current_topic.replace("_", " "))
    if state.sub_topic:
        prefixes.append(state.sub_topic)
    return f"{' '.join(prefixes)} {q}" if prefixes else q
