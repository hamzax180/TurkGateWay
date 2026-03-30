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
    # Generic social intents
    "greeting": [
        r"\b(hi|hey|hello|good morning|good afternoon|good evening|howdy|sup|yo)\b"
    ],
    "smalltalk": [
        r"\b(how are you|how do you do|hows it going|what's up|whats up|how are things|hows life)\b"
    ],
    "identity": [
        r"\b(who are you|what are you|what is this|what do you do|your name|tell me about yourself|introduce yourself)\b"
    ],
    "capabilities": [
        r"\b(what can you do|how can you help|what do you offer|what are your features|help me)\b"
    ],
    "farewell": [
        r"\b(bye|goodbye|see you|later|take care|cya|farewell)\b"
    ],
    "thanks": [
        r"\b(thank(s| you)|thx|cheers|much appreciated|appreciate it)\b"
    ],

    # Billing intents
    "billing.price": [
        r"\b(price|pricing|cost|how much|fee|fees|plan|plans|subscription cost|what does it cost)\b"
    ],
    "billing.refund": [
        r"\b(refund|money back|charge|overcharged|cancel and get|reimburs)\b"
    ],
    "billing.invoice": [
        r"\b(invoice|receipt|billing statement|bill|payment proof)\b"
    ],
    "billing.subscription": [
        r"\b(subscription|cancel|upgrade|downgrade|renew|auto.?renew)\b"
    ],

    # Support intents
    "support.error": [
        r"\b(error|exception|crashed|crash|500|404|bug|issue|not load|won.t load|can.t load)\b"
    ],
    "support.not_working": [
        r"\b(not working|doesn.t work|broken|stopped working|won.t work|failing|fail|can.t access)\b"
    ],
    "support.slow": [
        r"\b(slow|lag|laggy|loading forever|taking too long|unresponsive|hangs)\b"
    ],

    # --- Permit Agent intents ---
    "permit.how_to_start": [
        r"\b(how (do i|to) (start|open|begin|register|set up)|starting a business|open a business|open my business)\b",
        r"\b(i want to (open|start|register|set up)|what business (do i|you) want|obtain a business permit|i want to obtain)\b",
        r"\b(what business|which business|type of business|hangi i[şs]|ne i[şs])\b",
        r"^(what permit do you want\??)$",
        r"^(what business (you|do you) want to open\??)$",
    ],
    "permit.documents": [
        r"\b(what documents|required docs|document(s)? needed|paperwork|what do i need to bring|belge|what do i need)\b",
        r"\b(documents (do i|needed|required)|need (for|to open)|checklist|what to bring|required (docs|papers))\b",
        r"^(what documents do i need\??)$",
    ],
    "permit.cost": [
        r"\b(how much|cost|price|fee(s)?|payment|expensive|affordable|budget|maliy(et)?|ne kadar|kaç (lira|tl|para))\b",
        r"\b(does it cost|permit cost|permit fee|registration (fee|cost)|total cost)\b",
        r"^(how much does it cost\??)$",
    ],
    "permit.location": [
        r"\b(where (is|are)|location|district|belediye|which (district|area|municipality)|located in|where do i go|nerede|hangi ilçe)\b",
        r"\b(besiktas|kadikoy|sisli|uskudar|fatih|beyoglu|bakirkoy|zeytinburnu|sariyer|beyo[gğ]lu|be[sş]ikta[sş])\b",
        r"^(where is your business located\??)$",
    ],
    "permit.how_it_works": [
        r"\b(how does it work|how (does|do) (the )?(process|system|permit|it)|explain|overview|what is|tell me about)\b",
        r"\b(how it works|what happens|what (is|are) the|process overview|general (info|guide|overview))\b",
        r"^(how does it work\??)$",
    ],
    "permit.restaurant": [
        r"\b(restaurant|restoran|lokanta|dinner|dining|food permit)\b"
    ],
    "permit.cafe": [
        r"\b(cafe|cafeteria|kafe|coffee shop|tea house|pastry shop)\b"
    ],
    "permit.clothing": [
        r"\b(clothing|clothes|apparel|boutique|garment|shoe|giyim)\b"
    ],
    "permit.retail": [
        r"\b(retail|shop|store|market|grocery|bakkal|supermarket|ma[ğg]aza|d[üu]kkan)\b"
    ],
    "permit.office": [
        r"\b(office|consulting|agency|sanal ofis|ofis|b[üu]ro|headquarters)\b"
    ],
    "permit.barber": [
        r"\b(barber|hair salon|beauty|kuaf[öo]r|berber|g[üu]zellik|spa)\b"
    ],
    "permit.gym": [
        r"\b(gym|fitness|crossfit|spor|sports center)\b"
    ],
    "permit.pharmacy": [
        r"\b(pharmacy|eczane|chemist|drug store|medicine shop)\b"
    ],
    "permit.bakery": [
        r"\b(bakery|f[ıi]r[ıi]n|bread|pastanesi)\b"
    ],
    "permit.timeline": [
        r"\b(how long|timeline|time frame|when will|how many days|duration|takes (how|long)|ne kadar s[üu]r)\b",
        r"\bHow long does it take\b",
        r"^(how long does it take\??)$",
    ],
    "permit.alcohol": [
        r"\b(alcohol|tapdk|liquor|wine|beer|bar|spirits|drinks? permit)\b"
    ],
    "permit.music": [
        r"\b(music|live music|band|entertainment permit|canl[iı] m[uü]zik)\b"
    ],
    "permit.steps": [
        r"\b(steps|process|procedure|what are the steps|guide me|walk me through|14 steps|know the steps|i want to know)\b"
    ],
    "permit.nace": [
        r"\b(nace|nace code|business code|sector code|activity code|faaliyet kodu)\b"
    ],
    "permit.tax_id": [
        r"\b(tax id|vergi (numarası|no)|tax number|tax registration|tax office|vergi dairesi)\b"
    ],

    # --- Student Agent intents ---
    "student.renew_id": [
        r"\b(renew (my )?(student )?(id|kimlik|card)|kimlik renew|id renewal|expired (kimlik|id|card)|replace (my )?(student )?(id|card))\b"
    ],
    "student.kimlik_lost": [
        r"\b(lost (my )?(kimlik|student id|id card)|stolen (kimlik|card)|missing (kimlik|id))\b"
    ],
    "student.register_uni": [
        r"\b(how (to|do i) (register|enroll|apply)|university (registration|enrollment|enrolment)|enroll (at|in)|register (at|for) (a |my )?university|yoks[i\u0131]s)\b"
    ],
    "student.top_universities": [
        r"\b(top (10|ten|universities)|best university|best universities|which university|university (list|ranking)|ranked universities)\b"
    ],
    "student.health_insurance": [
        r"\b(health insurance|sgk|sa\u011fl[i\u0131]k sigorta|student insurance|medical coverage|insurance (for student|plan))\b"
    ],
    "student.documents": [
        r"\b(student documents|what documents for (university|uni|registration|enrollment)|required for (university|enrollment))\b"
    ],
    "student.residence_permit": [
        r"\b(student (residence|ikamet)|ikamet (permit|izni)|residence permit (for student)|g[o\xf6]\xc3\xa7 idaresi)\b"
    ],
    "student.transport_card": [
        r"\b(istanbulkart|transport card|student card|bus card|travel card|metro card|m\u00fczekart|discount card)\b"
    ],
    "student.dormitory": [
        r"\b(dormitory|dorm|yurt|kyk|housing|accommodation|where to stay|student housing)\b"
    ],
    "student.equivalency": [
        r"\b(equivalency|denklik|diploma recognition|high school equivalency|y\u00f6k denklik)\b"
    ],
    "student.scholarships": [
        r"\b(scholarship|scholarships|burs|turkiye burslari|ytb|financial aid|tuition funding)\b"
    ],
    "student.work_rules": [
        r"\b(can i work|work permit for student|student jobs|part time|part-time|working while studying|legal to work)\b"
    ],

    # --- Lawyer Agent intents ---
    "lawyer.company_formation": [
        r"\b(form (a |my )?company|start (a |my )?company|register (a |my )?(company|business|llc|ltd)|mersis|limited \u015eirket|anonim \u015eirket|incorporate|company formation)\b"
    ],
    "lawyer.contract_review": [
        r"\b(review (my )?contract|check (my )?contract|contract (clause|terms|dispute|issue)|nda|non.disclosure|service agreement|lease agreement)\b"
    ],
    "lawyer.employment_law": [
        r"\b(fired|dismissed|termination|severance|notice period|k[i\u0131]dem tazminat[i\u0131]|labour law|labor law|employment (law|issue|rights)|unfair dismissal|job (rights|dispute))\b"
    ],
    "lawyer.residence_permit": [
        r"\b(work permit|work visa|ikamet (ba\u015fvuru|application)|residence permit|stay in turkey legally|legal to work)\b"
    ],
    "lawyer.dispute": [
        r"\b(dispute|lawsuit|sue|court|legal action|arabuluculuk|mediation|arbitration|claim against|ihtarname)\b",
        r"\b(i have|i got|i need help with) (a |an |my )?(case|problem|issue|situation)\b",
        r"\b(my rights|what are my rights|know my rights)\b"
    ],
    "lawyer.real_estate": [
        r"\b(buy|sell|rent|purchase|lease) (a |my )?(house|property|apartment|flat|commercial|real estate|tapu)\b",
        r"\b(evict|eviction|rental increase|kiracı|ev sahibi|kira|tenant|landlord)\b"
    ],
    "lawyer.criminal": [
        r"\b(police|arrest|arrested|criminal|charge|jail|prison|detained|prosecutor|savcı|karakol|suç)\b"
    ],
    "lawyer.criminal_drugs": [
        r"\b(drug|drugs|narcotic|narcotics|weed|cocaine|hashish|trafficking|possession|uyuşturucu|madde|esrar|caught with)\b"
    ],
    "lawyer.criminal_theft": [
        r"\b(theft|steal|stole|robbery|fraud|scam|dolandır|hırsız|embezzlement)\b"
    ],
    "lawyer.criminal_violence": [
        r"\b(assault|fight|attacked|violence|hit me|injured|yaralama|darp|kavga|meşru müdafaa)\b"
    ],
    "lawyer.debt": [
        r"\b(debt|unpaid|invoice|money owed|icra|haciz|collection|bank account frozen|alacak)\b"
    ],
    "lawyer.general_legal": [
        r"\b(legal (question|advice|help|guidance|issue|problem|situation|case)|turkish law|lawyer|attorney|need a lawyer|legal matter)\b",
        r"\b(i need|i want|looking for) (a |an )?(lawyer|legal|attorney|advice|help)\b",
        r"\b(can you help|help me|i have a question|legal question)\b"
    ],
    "lawyer.legal_timelines": [
        r"\b(how long (does|will)|timeline|time frame|how many (days|weeks)|duration|processing time|when will i).{0,40}(permit|company|contract|court|case|dispute|visa|ikamet|formation)\b",
        r"\b(company formation|contract review|work permit|residence permit|court case).{0,30}(take|long|weeks|days|months)\b"
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

    # Walk the intent map in priority order: active assistant domains first!
    # Penalize billing/support if it hijacks domain keywords.
    sorted_intents = sorted(
        INTENT_MAP.items(),
        key=lambda item: 0 if item[0].startswith(f"{assistant_type}.") else 1
    )
    
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

    return None, None, 0.0
