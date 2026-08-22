'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, User, Mic, Plus, ChevronDown, Building2, FileText, Search, Clock, HelpCircle, Scale, Menu, GraduationCap, Cpu, X, Volume2, VolumeX, ArrowRight, ArrowUp, AudioLines, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import VisaIntakeCard, { type VisaIntakeState } from '../components/VisaIntakeCard';
import DocumentChecklistCard, { type ChecklistSeed } from '../components/DocumentChecklistCard';
import { DEFAULT_AGENT, isAgentDisabled, resolveAgent } from '@/lib/agents-config';

import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import LoadingScreen from '../components/LoadingScreen';
import OnboardingWizard from '../components/OnboardingWizard';
import { RealtimeCall } from '@/lib/realtime-voice';
import { Dictation, LEVEL_BARS } from '@/lib/voice-dictation';

/**
 * Accent colours for the call orb, one row per agent.
 *
 * The same three-way ternary used to be restated in the gradient, the lit glow
 * and the resting glow — three places to edit for one colour, and the fallback
 * silently differed between them.
 */
/**
 * Service ids the voice call speaks in, mapped to the chip ids the UI has
 * always used. The call's vocabulary matches the document checklists exactly
 * (ikamet_new vs ikamet_renewal are genuinely different lists), while the chip
 * only needs to say "Residence Permit" for both.
 */
const SERVICE_TO_CHIP: Record<string, string> = {
  university_registration: 'university',
  student_visa: 'visa',
  ikamet_new: 'ikamet',
  ikamet_renewal: 'ikamet',
  health_insurance: 'insurance',
};

const AGENT_ACCENT: Record<string, { gradient: string; glow: string }> = {
  student: { gradient: 'linear-gradient(160deg, #a7f3d0 0%, #34d399 40%, #059669 100%)', glow: '52,211,153' },
  lawyer:  { gradient: 'linear-gradient(160deg, #fef3c7 0%, #fcd34d 40%, #d97706 100%)', glow: '252,211,77' },
  permit:  { gradient: 'linear-gradient(160deg, #e0f2fe 0%, #7dd3fc 40%, #3b82f6 100%)', glow: '125,211,252' },
};

type Role = 'assistant' | 'user';
interface Msg {
  id: number;
  role: Role;
  content: string;
  /** A generated document (filled application form PDF) delivered by the agent. */
  attachment?: { id: number; filename: string } | null;
  /**
   * Said out loud on a voice call. These are kept in memory for the duration of
   * the call — the model needs them as context and the call UI shows them — but
   * they are never rendered into the thread and never written to chat_messages.
   * On hang-up they are collected into a transcript and dropped.
   */
  voice?: boolean;
  /** A filed voice call. Set on the single line a finished call leaves behind. */
  transcript?: { id: number } | null;
}

/**
 * A roadmap costs one service credit, so the server refuses to build one until
 * the user has explicitly agreed to spend it. It says so in two places: as an
 * HTTP 402 before the stream begins (chip flow), or as a mid-stream frame when
 * the model reached for the roadmap tool on its own.
 */
export interface PendingConfirm {
  service: string;
  location: string;
  creditsAvailable: number;
  nextExpiry: string | null;
  requiresAuth: boolean;
}

// ── /agent/query server-sent event reader ────────────────────────────────────
// Frames: meta { source, token_balance, session_title } · delta { t }
//         dashboard { state } · confirm_required { ...PendingConfirm }
//         visa_intake { collected, missing, documentAttached, status }
//         done {} · error { detail }
// Returns the fully accumulated reply text once the stream closes.
interface AgentStreamHandlers {
  onMeta?: (meta: { source?: string; token_balance?: number | null; session_title?: string | null }) => void;
  onDelta?: (chunk: string) => void;
  onDashboard?: (state: Record<string, unknown>) => void;
  onConfirmRequired?: (pending: PendingConfirm) => void;
  onVisaIntake?: (state: VisaIntakeState) => void;
  onDocumentChecklist?: (seed: ChecklistSeed) => void;
  onAttachment?: (attachment: { filename: string; documentId: number }) => void;
  onError?: (detail: string) => void;
}

async function readAgentStream(res: Response, handlers: AgentStreamHandlers): Promise<string> {
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let payload: any;
      try { payload = JSON.parse(data); } catch { continue; }

      if (event === 'meta') handlers.onMeta?.(payload);
      else if (event === 'delta') { full += payload.t ?? ''; handlers.onDelta?.(payload.t ?? ''); }
      else if (event === 'dashboard') handlers.onDashboard?.(payload.state);
      else if (event === 'confirm_required') handlers.onConfirmRequired?.(payload);
      else if (event === 'visa_intake') handlers.onVisaIntake?.(payload);
      else if (event === 'document_checklist') handlers.onDocumentChecklist?.(payload);
      else if (event === 'attachment') handlers.onAttachment?.(payload);
      else if (event === 'error') handlers.onError?.(payload.detail ?? 'Unknown error');
    }
  }

  return full;
}


/**
 * Upload limits. These mirror ALLOWED_MIME_TYPES / MAX_DOCUMENT_BYTES in
 * src/lib/application-documents.ts, which is what actually enforces them —
 * the client checks first only so the user gets told immediately rather than
 * after uploading a large file.
 */
const ACCEPTED_UPLOAD_TYPES = 'application/pdf,image/jpeg,image/png';
const MAX_UPLOAD_MB = 5;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// ── Voice-call opening line, spoken immediately when a call starts. Short and
//    conversational per the same voice-style rules the server uses (see
//    VOICE_STYLE in src/lib/prompts.ts) — this one just never touches the model.
/**
 * The opening line of a call.
 *
 * Keyed by language only. It used to be keyed by agent as well and would
 * announce which department had picked up — but the call now covers four
 * services and its whole job is finding out which one the caller wants, so
 * asserting one up front is exactly the wrong opening.
 */
const VOICE_GREETINGS: Record<string, string> = {
  en: "Hi, TurkGateway here. Are you calling about university, a visa, ikamet, or insurance?",
  tr: "Merhaba, TurkGateway. Üniversite, vize, ikamet mi, yoksa sigorta için mi arıyorsunuz?",
  ar: "أهلاً، معك TurkGateway. اتصالك بخصوص الجامعة، التأشيرة، الإقامة، أم التأمين؟",
  tk: "Salam, TurkGateway. Uniwersitet, wiza, ýaşaýyş rugsady ýa-da ätiýaçlandyryş barada jaň edýärsiňizmi?",
};

// ── Services that support New vs Renewal/Start flow ──
const RENEWAL_SERVICES = [
  // Student
  'ID / İkamet', 'Student Visa', 'Denklik (Equivalency)',
  'University Registration', 'Dormitory & Housing', 'IstanbulKart',
  // Permit
  'Cafe & Restaurant', 'Retail Shop', 'Office & Tech', 'Pharmacy', 'Clinic', 'Residence Permit',
  // Lawyer
  'Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law',
];

// ── Dynamic responses based on New vs Renewal selection ──
const SERVICE_FLOW_RESPONSES: Record<string, { ask: string }> = {
  // ── STUDENT ──────────────────────────────────────────────────
  'ID / İkamet': {
    ask: '🪪 **ID / İkamet (Residence Permit)**\n\nGreat choice! To give you the exact steps and documents, I need to know:\n\n**Is this a New application or a Renewal?**'
  },
  'Student Visa': {
    ask: '✈️ **Student Visa**\n\nI can guide you through the full process! First, I need to know:\n\n**Is this a New visa application or a Renewal/Extension?**'
  },
  'Denklik (Equivalency)': {
    ask: '📜 **Denklik (Diploma Equivalency)**\n\nTo give you the right guidance, I need to know:\n\n**Is this a New Denklik application or are you following up on a previous one?**'
  },
  'University Registration': {
    ask: '🏛️ **University Registration**\n\nAre you registering at a university for the **first time** in Turkey, or handling a **re-registration / transfer**?'
  },
  'Dormitory & Housing': {
    ask: '🛏️ **Dormitory & Housing**\n\nAre you looking for housing for the **first time**, or renewing/changing your current arrangement?'
  },
  'IstanbulKart': {
    ask: '🚌 **IstanbulKart (Student Transport Card)**\n\nDo you need to **get a new** student IstanbulKart, or **renew/reload** an existing one?'
  },

  // ── PERMIT (Business) ──────────────────────────────────────────
  'Cafe & Restaurant': {
    ask: '☕ **Cafe & Restaurant**\n\nAre you opening a **new** cafe or restaurant, or making changes to an **existing** one?'
  },
  'Retail Shop': {
    ask: '🛍️ **Retail Shop**\n\nAre you opening a **new** retail store, or renewing licenses for an **existing** one?'
  },
  'Office & Tech': {
    ask: '💻 **Office & Tech Business**\n\nAre you setting up a **new** office or tech company, or updating an **existing** setup?'
  },
  'Pharmacy': {
    ask: '🏥 **Pharmacy**\n\nAre you opening a **new** pharmacy, or renewing licenses for an **existing** one?'
  },
  'Clinic': {
    ask: '🩺 **Medical Clinic**\n\nAre you opening a **new** private clinic, or renewing licenses for an **existing** one?'
  },
  'Residence Permit': {
    ask: '🏠 **Residence Permit (İkamet)**\n\nIs this for a **new** residence permit application, or renewing an **existing** one?'
  },

  // ── LAWYER (Legal) ──────────────────────────────────────────────
  'Company Formation': {
    ask: '🏗️ **Company Formation**\n\nAre you forming a **brand new** company, or restructuring an **existing** entity?'
  },
  'Contract Review': {
    ask: '📑 **Contract Review**\n\nAre you reviewing a **new** contract, or revisiting/amending an **existing** agreement?'
  },
  'Employment Law': {
    ask: '🤝 **Employment Law**\n\nAre you **hiring new** employees and need employment contracts, or resolving **ongoing** employment issues?'
  },
  'Legal Disputes': {
    ask: '⚖️ **Legal Disputes**\n\nAre you **initiating** a new legal case, or managing an **ongoing** dispute?'
  },
  'Residency & Visas': {
    ask: '🏠 **Residency & Visas (Legal Advice)**\n\nAre you navigating a **new** residency/visa matter, or handling an **ongoing** issue such as appeal or extension?'
  },
  'Real Estate Law': {
    ask: '🏢 **Real Estate Law**\n\nAre you handling a **new** property transaction, or resolving an **ongoing** real estate legal matter?'
  },
};

// ── Dynamic follow-up chips per service (shown after "New Application" is chosen) ──
const SERVICE_AREA_CHIPS: Record<string, { question: string; emoji: string; chips: string[] }> = {
  // Student — location-based (ikamet needs local migration office)
  'ID / İkamet': {
    question: 'Which district is your residence/address in Istanbul? This determines your Migration Office (Göç İdaresi).',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Student Visa': {
    question: 'Which country are you applying from? This determines the Turkish consulate you will visit.',
    emoji: '🌍',
    chips: ['USA', 'UK', 'Germany', 'Russia', 'China', 'Egypt', 'Pakistan', 'Morocco', 'Jordan', 'Saudi Arabia'],
  },
  'Denklik (Equivalency)': {
    question: 'Which country did you graduate from? This helps determine the apostille and translation requirements.',
    emoji: '🎓',
    chips: ['Syria', 'Iraq', 'Egypt', 'Russia', 'Ukraine', 'Pakistan', 'Jordan', 'Germany', 'USA', 'UK'],
  },
  'University Registration': {
    question: 'Which university are you enrolling in?',
    emoji: '🏛️',
    chips: ['Istanbul University', 'Istanbul Technical University', 'Boğaziçi University', 'Marmara University', 'Yıldız Technical University', 'Bahçeşehir University'],
  },
  'Dormitory & Housing': {
    question: 'Which district or area are you looking for accommodation in?',
    emoji: '🏠',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Üsküdar', 'Beyoğlu', 'Eyüpsultan', 'Bakırköy', 'Şişli'],
  },
  'IstanbulKart': {
    question: 'Which area is your university located in? This helps find the nearest IstanbulKart center.',
    emoji: '🚌',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Eyüpsultan', 'Üsküdar', 'Şişli', 'Beyoğlu', 'Bakırköy'],
  },
  // Business / Permit — always needs district
  'Cafe & Restaurant': {
    question: 'Which district in Istanbul will your cafe or restaurant be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Retail Shop': {
    question: 'Which district in Istanbul will your retail shop be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Office & Tech': {
    question: 'Which district in Istanbul will your office be located in?',
    emoji: '🏙️',
    chips: ['Beşiktaş', 'Şişli', 'Levent', 'Maslak', 'Kadıköy', 'Ataşehir', 'Beyoğlu', 'Sarıyer'],
  },
  'Pharmacy': {
    question: 'Which district in Istanbul will your pharmacy be located in?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  'Clinic': {
    question: 'Which district in Istanbul will your clinic be located in?',
    emoji: '🏙️',
    chips: ['Beşiktaş', 'Şişli', 'Kadıköy', 'Üsküdar', 'Fatih', 'Bakırköy', 'Beyoğlu', 'Ataşehir'],
  },
  'Residence Permit': {
    question: 'Which district in Istanbul is your residence address?',
    emoji: '🏙️',
    chips: ['Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu', 'Üsküdar', 'Bakırköy'],
  },
  // Lawyer — context varies
  'Company Formation': {
    question: 'Which district will your company be registered in, or is this an online/remote registration?',
    emoji: '🏢',
    chips: ['Beşiktaş', 'Şişli', 'Kadıköy', 'Fatih', 'Levent / Maslak', 'Ataşehir', 'Online / Remote', 'Not sure yet'],
  },
  'Contract Review': {
    question: 'What type of contract do you need reviewed?',
    emoji: '📑',
    chips: ['Employment Contract', 'Rental Agreement', 'Business Partnership', 'Service Agreement', 'Sales Contract', 'Franchise Agreement', 'NDA / Confidentiality', 'Other'],
  },
  'Employment Law': {
    question: 'What is the employment situation you need help with?',
    emoji: '🤝',
    chips: ['Hiring a new employee', 'Employee termination', 'Salary dispute', 'Work permit for foreigner', 'SGK registration issue', 'Workplace discrimination', 'Contract renewal', 'Other'],
  },
  'Legal Disputes': {
    question: 'What type of legal dispute are you dealing with?',
    emoji: '⚖️',
    chips: ['Business / Commercial', 'Real estate / Property', 'Labor / Employment', 'Contract breach', 'Debt collection', 'Consumer rights', 'Family law', 'Criminal matter'],
  },
  'Residency & Visas': {
    question: 'What type of residency or visa matter do you need legal help with?',
    emoji: '🏠',
    chips: ['Work permit (Çalışma İzni)', 'Long-term residence', 'Citizenship by investment', 'Visa appeal / denial', 'Tourist to resident', 'Family reunion visa', 'Business visa', 'Other'],
  },
  'Real Estate Law': {
    question: 'What type of real estate matter do you need legal help with?',
    emoji: '🏡',
    chips: ['Buying property', 'Selling property', 'Rental dispute', 'Title deed issue', 'Construction dispute', 'Foreign buyer rules', 'Land registry', 'Other'],
  },
};

// Default fallback chips (Istanbul districts) for any unmapped service
const DEFAULT_AREA_CHIPS = [
  'Fatih', 'Kadıköy', 'Beşiktaş', 'Esenyurt', 'Şişli', 'Beyoğlu'
];

// ── Dynamic button labels for New vs second option, per service ──
const SERVICE_BUTTON_LABELS: Record<string, { primary: string; secondary: string }> = {
  // Student
  'ID / İkamet':              { primary: '🆕 New Application',      secondary: '🔄 Renewal' },
  'Student Visa':             { primary: '🆕 New Visa',             secondary: '✏️ Extension / Renewal' },
  'Denklik (Equivalency)':    { primary: '🆕 New Application',      secondary: '🔍 Follow-up / Correction' },
  'University Registration':  { primary: '🆕 First-time Registration', secondary: '🔄 Transfer / Re-registration' },
  'Dormitory & Housing':      { primary: '🆕 Find New Housing',      secondary: '🔄 Renew / Change' },
  'IstanbulKart':             { primary: '🆕 Get New Card',          secondary: '🔄 Renew / Reload' },
  // Business / Permit
  'Cafe & Restaurant':        { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Retail Shop':              { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Office & Tech':            { primary: '🆕 Set Up New',           secondary: '🔄 Annual Compliance' },
  'Pharmacy':                 { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Clinic':                   { primary: '🆕 Open New',             secondary: '🔄 Renew Licenses' },
  'Residence Permit':         { primary: '🆕 New Application',      secondary: '🔄 Renewal' },
  // Lawyer
  'Company Formation':        { primary: '🆕 Form New Company',     secondary: '🔄 Restructure / Compliance' },
  'Contract Review':          { primary: '🆕 Review New Contract',  secondary: '✏️ Amend Existing' },
  'Employment Law':           { primary: '🆕 Hire / New Contract',  secondary: '⚠️ Existing Issue' },
  'Legal Disputes':           { primary: '🆕 File New Case',        secondary: '⏳ Ongoing Case / Appeal' },
  'Residency & Visas':        { primary: '🆕 New Matter',           secondary: '🔄 Appeal / Extension' },
  'Real Estate Law':          { primary: '🆕 New Transaction',      secondary: '⚠️ Ongoing Matter' },
};
const DEFAULT_BUTTON_LABELS = { primary: '🆕 New Application', secondary: '🔄 Renewal' };

// ── Localized "ask" questions for the New / Renewal prompt (student services first) ──
const SERVICE_ASK_AR: Record<string, string> = {
  'ID / İkamet':             '🪪 **الإقامة (İkamet)**\n\nلأعطيك الخطوات والمستندات الصحيحة، أحتاج أن أعرف:\n\n**هل هذا طلب إقامة جديد أم تجديد؟**',
  'Student Visa':            '✈️ **تأشيرة الطالب**\n\nيمكنني إرشادك خلال العملية الكاملة! أولاً:\n\n**هل هذا طلب تأشيرة جديدة أم تمديد/تجديد؟**',
  'Denklik (Equivalency)':   '📜 **الدنكليك (معادلة الشهادة)**\n\nلأعطيك التوجيه الصحيح، أحتاج أن أعرف:\n\n**هل هذا طلب دنكليك جديد أم تتابع طلباً سابقاً؟**',
  'University Registration':  '🏛️ **التسجيل الجامعي**\n\nهل تسجل في جامعة تركية **للمرة الأولى**، أم تعيد التسجيل أو تنتقل من جامعة أخرى؟',
  'Dormitory & Housing':      '🛏️ **السكن والمبيت**\n\nهل تبحث عن سكن **للمرة الأولى**، أم تجدد/تغير ترتيبك الحالي؟',
  'IstanbulKart':             '🚌 **إسطنبول كارت (بطاقة المواصلات الطلابية)**\n\nهل تريد **الحصول على بطاقة جديدة**، أم **تجديد/إعادة شحن** بطاقة موجودة؟',
  'Cafe & Restaurant':        '☕ **مقهى ومطعم**\n\nهل تفتح مقهى أو مطعماً **جديداً**، أم تجدد تراخيص **موجودة**؟',
  'Retail Shop':              '🛍️ **محل تجاري**\n\nهل تفتح محلاً **جديداً**، أم تجدد تراخيص محل **موجود**؟',
  'Office & Tech':            '💻 **مكتب وتقنية**\n\nهل تؤسس شركة أو مكتباً **جديداً**، أم تحدث إعداداً **موجوداً**؟',
  'Residence Permit':         '🏠 **تصريح الإقامة**\n\nهل هذا طلب إقامة **جديد**، أم تجديد لإقامة **موجودة**؟',
  'Company Formation':        '🏗️ **تأسيس الشركة**\n\nهل تؤسس شركة **جديدة**، أم تعيد هيكلة كيان **موجود**؟',
  'Contract Review':          '📑 **مراجعة العقد**\n\nهل تراجع عقداً **جديداً**، أم تعدل اتفاقية **موجودة**؟',
  'Legal Disputes':           '⚖️ **النزاعات القانونية**\n\nهل **تبدأ** قضية جديدة، أم تدير نزاعاً **جارياً**؟',
};

const SERVICE_ASK_TR: Record<string, string> = {
  'ID / İkamet':             '🪪 **İkamet (Oturma İzni)**\n\nSize doğru adımları ve belgeleri verebilmem için:\n\n**Bu yeni bir başvuru mu yoksa yenileme mi?**',
  'Student Visa':            '✈️ **Öğrenci Vizesi**\n\nSüreç boyunca size rehberlik edebilirim! Önce:\n\n**Bu yeni bir vize başvurusu mu yoksa uzatma/yenileme mi?**',
  'Denklik (Equivalency)':   '📜 **Denklik (Diploma Denkliği)**\n\nDoğru rehberlik yapabilmem için:\n\n**Bu yeni bir Denklik başvurusu mu yoksa önceki bir başvuruyu mu takip ediyorsunuz?**',
  'University Registration':  '🏛️ **Üniversite Kaydı**\n\nTürkiye\'de bir üniversiteye **ilk kez mi** kayıt yaptırıyorsunuz, yoksa yeniden kayıt veya transfer mi?',
  'Dormitory & Housing':      '🛏️ **Yurt ve Konut**\n\n**İlk kez mi** konut arıyorsunuz yoksa mevcut durumunuzu mu yeniliyorsunuz?',
  'IstanbulKart':             '🚌 **İstanbulKart (Öğrenci Ulaşım Kartı)**\n\n**Yeni bir öğrenci İstanbulKart** almak mı istiyorsunuz yoksa mevcut kartı mı yenilemek/doldurmak?',
};

const SERVICE_BUTTON_LABELS_AR: Record<string, { primary: string; secondary: string }> = {
  'ID / İkamet':             { primary: '🆕 طلب جديد',              secondary: '🔄 تجديد' },
  'Student Visa':            { primary: '🆕 تأشيرة جديدة',          secondary: '✏️ تمديد / تجديد' },
  'Denklik (Equivalency)':   { primary: '🆕 طلب جديد',              secondary: '🔍 متابعة / تصحيح' },
  'University Registration':  { primary: '🆕 تسجيل لأول مرة',       secondary: '🔄 نقل / إعادة تسجيل' },
  'Dormitory & Housing':      { primary: '🆕 ابحث عن سكن جديد',     secondary: '🔄 تجديد / تغيير' },
  'IstanbulKart':             { primary: '🆕 احصل على بطاقة جديدة', secondary: '🔄 تجديد / إعادة شحن' },
  'Cafe & Restaurant':        { primary: '🆕 فتح جديد',             secondary: '🔄 تجديد التراخيص' },
  'Retail Shop':              { primary: '🆕 فتح جديد',             secondary: '🔄 تجديد التراخيص' },
  'Residence Permit':         { primary: '🆕 طلب جديد',             secondary: '🔄 تجديد' },
  'Company Formation':        { primary: '🆕 تأسيس شركة جديدة',     secondary: '🔄 إعادة هيكلة' },
  'Legal Disputes':           { primary: '🆕 رفع قضية جديدة',       secondary: '⏳ قضية جارية / استئناف' },
};

const SERVICE_BUTTON_LABELS_TR: Record<string, { primary: string; secondary: string }> = {
  'ID / İkamet':             { primary: '🆕 Yeni Başvuru',          secondary: '🔄 Yenileme' },
  'Student Visa':            { primary: '🆕 Yeni Vize',             secondary: '✏️ Uzatma / Yenileme' },
  'Denklik (Equivalency)':   { primary: '🆕 Yeni Başvuru',          secondary: '🔍 Takip / Düzeltme' },
  'University Registration':  { primary: '🆕 İlk Kayıt',            secondary: '🔄 Nakil / Yeniden Kayıt' },
  'Dormitory & Housing':      { primary: '🆕 Yeni Konut Bul',       secondary: '🔄 Yenile / Değiştir' },
  'IstanbulKart':             { primary: '🆕 Yeni Kart Al',         secondary: '🔄 Yenile / Doldur' },
};

const SERVICE_ASK_TK: Record<string, string> = {
  'ID / İkamet':              '🪪 **ID / İkamet (Ýaşaýyş rugsatnamasy)**\n\nGowy saýlaw! Size takyk ädimleri we resminamalary bermek üçin bilmeli:\n\n**Bu Täze arza mы ýa-da Täzeleme mi?**',
  'Student Visa':             '✈️ **Talyp Wizasy**\n\nSizi doly prosesden geçirip bilerin! Ilki bilmeli:\n\n**Bu Täze wiza arzasy mы ýa-da Uzaltma/Täzeleme mi?**',
  'Denklik (Equivalency)':    '📜 **Denklik (Diplom Deňleşdirme)**\n\nSize dogry maslahat bermek üçin bilmeli:\n\n**Bu Täze Denklik arzasy mы ýa-da öňki arzaňyzy yzarlaýarsyňyzmy?**',
  'University Registration':  '🏛️ **Uniwersitet Bellige Alşy**\n\nTürkiýede uniwersitete **ilkinji gezek** bellige durýarsyňyzmy, ýa-da **täzeden bellige alyş/geçiş** edýärsiňizmi?',
  'Dormitory & Housing':      '🛏️ **Ýatakhana we Ýaşaýyş jaý**\n\n**Ilkinji gezek** ýaşaýyş jaý gözleýärsiňizmi, ýa-da häzirki ýagdaýyňyzy täzeleýärsiňizmi/üýtgedýärsiňizmi?',
  'IstanbulKart':             '🚌 **IstanbulKart (Talyp Transport Kartasy)**\n\n**Täze** talyp IstanbulKart almak isleýärsiňizmi, ýa-da barlyny **täzelemek/doldurmak** isleýärsiňizmi?',
  'Cafe & Restaurant':        '☕ **Kafe we Restoran**\n\n**Täze** kafe ýa-da restoran açýarsyňyzmy, ýa-da **bar** birine üýtgeşme girizýärsiňizmi?',
  'Retail Shop':              '🛍️ **Bölek satuw dükany**\n\n**Täze** dükan açýarsyňyzmy, ýa-da **bar** dükanyň rugsatnamalaryny täzeleýärsiňizmi?',
  'Office & Tech':            '💻 **Ofis we Tehnologiýa**\n\n**Täze** ofis ýa-da tehnologiýa kompaniýasy gurýarsyňyzmy, ýa-da **bar** gurluşy täzeleýärsiňizmi?',
  'Pharmacy':                 '🏥 **Dermanhana**\n\n**Täze** dermanhana açýarsyňyzmy, ýa-da **bar** biriniň rugsatnamalaryny täzeleýärsiňizmi?',
  'Clinic':                   '🩺 **Lukmançylyk Klinikasy**\n\n**Täze** hususy klinika açýarsyňyzmy, ýa-da **bar** biriniň rugsatnamalaryny täzeleýärsiňizmi?',
  'Residence Permit':         '🏠 **Ýaşaýyş Rugsatnamasy (İkamet)**\n\nBu **täze** ýaşaýyş rugsatnamasy arzasymy, ýa-da **bar** birini täzelemekmi?',
  'Company Formation':        '🏗️ **Kompaniýa Döretmek**\n\n**Düýbünden täze** kompaniýa döredýärsiňizmi, ýa-da **bar** edarany täzeden gurýarsyňyzmy?',
  'Contract Review':          '📑 **Şertnama Barlagy**\n\n**Täze** şertnamany barlaýarsyňyzmy, ýa-da **bar** ylalaşygy täzeden gözden geçirýärsiňizmi/üýtgedýärsiňizmi?',
  'Employment Law':           '🤝 **Zähmet Hukugy**\n\n**Täze işgär işe alýarsyňyzmy** we zähmet şertnamasy gerekmi, ýa-da **dowam edýän** zähmet meselesini çözýärsiňizmi?',
  'Legal Disputes':           '⚖️ **Hukuk Jedeller**\n\n**Täze** hukuk işini başladýarsyňyzmy, ýa-da **dowam edýän** jedeli dolandyrýarsyňyzmy?',
  'Residency & Visas':        '🏠 **Ýaşaýyş we Wizalar (Hukuk Maslahaty)**\n\n**Täze** ýaşaýyş/wiza meselesini çözýärsiňizmi, ýa-da **dowam edýän** mesele (şikaýat ýa-da uzaltma ýaly) bilen meşgullanýarsyňyzmy?',
  'Real Estate Law':          '🏢 **Gozgalmaýan Emläk Hukugy**\n\n**Täze** emläk amalyny geçirýärsiňizmi, ýa-da **dowam edýän** gozgalmaýan emläk hukuk meselesini çözýärsiňizmi?',
};

const SERVICE_BUTTON_LABELS_TK: Record<string, { primary: string; secondary: string }> = {
  'ID / İkamet':              { primary: '🆕 Täze Arza',            secondary: '🔄 Täzeleme' },
  'Student Visa':             { primary: '🆕 Täze Wiza',            secondary: '✏️ Uzaltma / Täzeleme' },
  'Denklik (Equivalency)':    { primary: '🆕 Täze Arza',            secondary: '🔍 Yzarlama / Düzediş' },
  'University Registration':  { primary: '🆕 Ilkinji Bellige Alyş', secondary: '🔄 Geçiş / Täzeden Bellige Alyş' },
  'Dormitory & Housing':      { primary: '🆕 Täze Ýaşaýyş Jaý Tap', secondary: '🔄 Täzele / Üýtget' },
  'IstanbulKart':             { primary: '🆕 Täze Karta Al',        secondary: '🔄 Täzele / Doldur' },
  'Cafe & Restaurant':        { primary: '🆕 Täze Aç',              secondary: '🔄 Rugsatnamalary Täzele' },
  'Retail Shop':              { primary: '🆕 Täze Aç',              secondary: '🔄 Rugsatnamalary Täzele' },
  'Office & Tech':            { primary: '🆕 Täze Gur',             secondary: '🔄 Ýyllyk Laýyklyk' },
  'Pharmacy':                 { primary: '🆕 Täze Aç',              secondary: '🔄 Rugsatnamalary Täzele' },
  'Clinic':                   { primary: '🆕 Täze Aç',              secondary: '🔄 Rugsatnamalary Täzele' },
  'Residence Permit':         { primary: '🆕 Täze Arza',            secondary: '🔄 Täzeleme' },
  'Company Formation':        { primary: '🆕 Täze Kompaniýa Gur',   secondary: '🔄 Täzeden Gur / Laýyklyk' },
  'Contract Review':          { primary: '🆕 Täze Şertnamany Barla', secondary: '✏️ Barlary Üýtget' },
  'Employment Law':           { primary: '🆕 Işe Al / Täze Şertnama', secondary: '⚠️ Bar Mesele' },
  'Legal Disputes':           { primary: '🆕 Täze Iş Aç',           secondary: '⏳ Dowam edýän Iş / Şikaýat' },
  'Residency & Visas':        { primary: '🆕 Täze Mesele',          secondary: '🔄 Şikaýat / Uzaltma' },
  'Real Estate Law':          { primary: '🆕 Täze Amal',            secondary: '⚠️ Dowam edýän Mesele' },
};

function getLocalizedAsk(service: string, lang: string): string {
  if (lang === 'ar') return SERVICE_ASK_AR[service] ?? SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
  if (lang === 'tr') return SERVICE_ASK_TR[service] ?? SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
  if (lang === 'tk') return SERVICE_ASK_TK[service] ?? SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
  return SERVICE_FLOW_RESPONSES[service]?.ask ?? '';
}

function getLocalizedBtnLabels(service: string, lang: string) {
  if (lang === 'ar') return SERVICE_BUTTON_LABELS_AR[service] ?? SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
  if (lang === 'tr') return SERVICE_BUTTON_LABELS_TR[service] ?? SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
  if (lang === 'tk') return SERVICE_BUTTON_LABELS_TK[service] ?? SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
  return SERVICE_BUTTON_LABELS[service] ?? DEFAULT_BUTTON_LABELS;
}


// Maps English service chip labels → i18n translation keys (for LanguageContext)
const CHIP_I18N_KEY: Record<string, string> = {
  'Cafe & Restaurant':       'chip_cafe_restaurant',
  'Retail Shop':             'chip_retail_shop',
  'Office & Tech':           'chip_office_tech',
  'Pharmacy':                'chip_pharmacy',
  'Clinic':                  'chip_clinic',
  'Residence Permit':        'chip_residence_permit',
  'University Registration': 'chip_uni_reg',
  'ID / İkamet':             'chip_ikamet',
  'Denklik (Equivalency)':   'chip_denklik',
  'Dormitory & Housing':     'chip_dormitory',
  'Student Visa':            'chip_student_visa',
  'IstanbulKart':            'chip_istanbul_kart',
  'Company Formation':       'chip_company_formation',
  'Contract Review':         'chip_contract_review',
  'Employment Law':          'chip_employment_law',
  'Legal Disputes':          'chip_legal_disputes',
  'Residency & Visas':       'chip_residency_visas',
  'Real Estate Law':         'chip_real_estate',
  'Criminal Defense':        'chip_criminal_defense',
};

// ── Service options per agent — the only suggestions we show. Picking one starts
//    its flow (New/Renewal → district → Dashboard), the fast path to a roadmap. ──
type ServiceOption = { emoji: string; label: string };
const SERVICE_OPTIONS: Record<'permit' | 'student' | 'lawyer', ServiceOption[]> = {
  permit: [
    { emoji: '☕', label: 'Cafe & Restaurant' },
    { emoji: '🛍️', label: 'Retail Shop' },
    { emoji: '💻', label: 'Office & Tech' },
    { emoji: '🏥', label: 'Pharmacy' },
    { emoji: '🩺', label: 'Clinic' },
    { emoji: '🏠', label: 'Residence Permit' },
  ],
  student: [
    { emoji: '🏛️', label: 'University Registration' },
    { emoji: '🪪', label: 'ID / İkamet' },
    { emoji: '📜', label: 'Denklik (Equivalency)' },
    { emoji: '🛏️', label: 'Dormitory & Housing' },
    { emoji: '✈️', label: 'Student Visa' },
    { emoji: '🚌', label: 'IstanbulKart' },
  ],
  lawyer: [
    { emoji: '🏗️', label: 'Company Formation' },
    { emoji: '📑', label: 'Contract Review' },
    { emoji: '🤝', label: 'Employment Law' },
    { emoji: '⚖️', label: 'Legal Disputes' },
    { emoji: '🏠', label: 'Residency & Visas' },
    { emoji: '🏢', label: 'Real Estate Law' },
  ],
};

// Suggestions are intentionally limited to SERVICE_OPTIONS above — picking a
// service starts its flow and drives the client straight to the roadmap. We no
// longer surface tangential follow-up questions (cost/alcohol/etc.) mid-chat.

export default function ChatPage() {
  const router = useRouter();
  const { t, isRTL, language, translateHistory } = useLanguage();
  const { token, isAuthenticated, user, setTokenBalance, lastTokenReset, setIsLoginModalOpen } = useAuth();

  const getRefreshTimeLabel = () => {
    if (quotaRefreshTime) return quotaRefreshTime;
    if (!lastTokenReset) return '12 hours';
    const resetDate = new Date(lastTokenReset);
    resetDate.setHours(resetDate.getHours() + 12);
    return resetDate.toLocaleString(language === 'ar' ? 'ar-SA' : language === 'tr' ? 'tr-TR' : language === 'tk' ? 'tk-TM' : 'en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });
  };
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** In-flight lazy session creation, so two quick sends share one row. */
  const sessionCreationRef = useRef<Promise<string | null> | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const [quotaRefreshTime, setQuotaRefreshTime] = useState('');
  const [assistantType, setAssistantType] = useState<'permit' | 'student' | 'lawyer'>(DEFAULT_AGENT);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showGuestLimitModal, setShowGuestLimitModal] = useState(false);
  const [guestMsgCount, setGuestMsgCount] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Show the walkthrough until the visitor asks us to stop. The flag was
  // already being written on dismiss; nothing ever read it, so the modal came
  // back on every single visit.
  useEffect(() => {
    if (localStorage.getItem('turkgateway_onboarding_done') !== 'true') {
      setShowOnboarding(true);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const QUICK_Q = [
    t('chat_q1'),
    t('chat_q2'),
    t('chat_q3'),
    t('chat_q4'),
  ];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  /**
   * Live mirror of msgs. hangUpCall runs from timers (the auto-hangup after a
   * closing line, the 3s teardown) that captured an older render, so reading
   * the state variable there would file a transcript missing its last turns.
   */
  const msgsRef = useRef<Msg[]>([]);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Set when the server asks the user to approve spending a service credit. */
  const [pendingConfirm, setPendingConfirm] = useState<(PendingConfirm & { query: string }) | null>(null);
  /**
   * Visa intake progress. Only the latest snapshot is kept — the state is
   * cumulative, so older cards would just be stale copies of the same thing.
   * `visaIntakeMsgId` anchors it below the reply that produced it.
   */
  const [visaIntake, setVisaIntake] = useState<VisaIntakeState | null>(null);
  const [visaIntakeMsgId, setVisaIntakeMsgId] = useState<number | null>(null);
  /**
   * The document checklist the agent listed, anchored to the reply that
   * produced it. Kept per message rather than as one global card so a
   * conversation covering two services shows both lists in place.
   */
  const [checklists, setChecklists] = useState<Record<number, ChecklistSeed>>({});

  /**
   * Check the file before it is ever attached, so someone who picks a 40 MB
   * scan finds out immediately instead of after a slow upload. The server
   * enforces the same limits independently — this is for the person, not for
   * security.
   */
  const pickFile = (picked: File) => {
    if (picked.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `${picked.name} is ${(picked.size / (1024 * 1024)).toFixed(1)} MB. The limit is ${MAX_UPLOAD_MB} MB — please upload a smaller scan.`,
      );
      return;
    }
    if (!ACCEPTED_UPLOAD_TYPES.split(',').includes(picked.type)) {
      setUploadError(`${picked.name} isn't a PDF, JPG, or PNG.`);
      return;
    }
    setUploadError(null);
    setFile(picked);
  };

  const [busy, setBusy] = useState(false);

  // True once the reply is visibly arriving. The placeholder assistant message
  // is pushed with empty content before the first token, so without this the
  // "thinking" indicator and an empty bubble render at the same time — and
  // then the indicator stays pinned under a bubble that is already answering.
  const lastMsg = msgs[msgs.length - 1];
  const replyStarted = lastMsg?.role === 'assistant' && !!lastMsg.content;
  const [visibleChars, setVisibleChars] = useState<Record<number, number>>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  /** Live mirror of isSpeaking for the mic callbacks — see markSpeaking(). */
  const isSpeakingRef = useRef(false);
  /** Set speaking state and its live mirror together. */
  const markSpeaking = (value: boolean) => {
    isSpeakingRef.current = value;
    setIsSpeaking(value);
  };

  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  /** True while the server is being asked whether a call may start. */
  const [voiceGateChecking, setVoiceGateChecking] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  /** Same count as callDuration, readable from timers that captured an old render. */
  const callSecondsRef = useRef(0);
  /** The live Realtime session, when the call is running on that path. */
  const realtimeCallRef = useRef<RealtimeCall | null>(null);
  /**
   * Turns spoken on a Realtime call. They never pass through send(), so they
   * are collected here for the transcript instead of being read off msgs.
   */
  const realtimeTurnsRef = useRef<{ role: Role; content: string }[]>([]);
  /** Agent speech arrives as deltas; accumulated here until the turn is done. */
  const agentSpeechRef = useRef('');
  /**
   * How loud the agent's voice is right now, 0..1.
   *
   * Drives the orb so it breathes with the actual speech. The previous orb
   * pulsed on a fixed timer, which kept pulsing through pauses and stayed flat
   * through emphasis — convincing for two seconds, then obviously decoration.
   */
  const [voiceLevel, setVoiceLevel] = useState(0);
  /**
   * What the caller has settled on so far, shown on the call screen.
   *
   * A phone call keeps no record of itself while it is happening — somebody
   * says "Bahcesehir, computer engineering" and then spends the rest of the
   * call wondering whether it was heard right. This is that read-back, without
   * spending a turn of conversation on it.
   */
  const [voiceChoices, setVoiceChoices] = useState<{ university?: string; major?: string; service?: string }>({});
  /** What the call decided, captured from end_call and filed on hang-up. */
  const callOutcomeRef = useRef<{ service: string | null; detail: string | null }>({ service: null, detail: null });

  // ── Dictation: the composer's microphone, distinct from the phone call ────
  const dictationRef = useRef<Dictation | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [dictationLevels, setDictationLevels] = useState<number[]>(() => new Array(LEVEL_BARS).fill(0));
  /**
   * Why the call could not start, shown on the call screen.
   *
   * A voice call that fails has no way of telling anyone: there is no voice to
   * say it with. Without this the caller sees "Connecting…", then the line
   * drops, and the only explanation is a console warning nobody reads. An
   * expired API key looked identical to a broken feature.
   */
  const [voiceError, setVoiceError] = useState<string | null>(null);

  /**
   * Leaving the page mid-call must release the microphone. Closing the peer
   * connection alone leaves the track live and the browser's recording dot on,
   * so RealtimeCall.hangUp stops the tracks explicitly — this just makes sure
   * it is called when React tears the component down.
   */
  useEffect(() => () => {
    realtimeCallRef.current?.hangUp();
    realtimeCallRef.current = null;
  }, []);
  /**
   * Guards against filing the same call twice. hangUpCall has more than one
   * caller — the button, the [CALL_COMPLETE] handler, and its 45s backstop —
   * and two of them landing in the same tick would both still see the spoken
   * turns in msgsRef, producing two transcript rows and two thread lines.
   */
  const transcriptFiledRef = useRef(false);
  const [detectedService, setDetectedService] = useState<string | null>(null);
  const [callEnded, setCallEnded] = useState(false);
  const [switchingAgent, setSwitchingAgent] = useState(false);
  const [pendingServiceChoice, setPendingServiceChoice] = useState<string | null>(null);
  const [awaitingAreaService, setAwaitingAreaService] = useState<string | null>(null);
  const [fetchingRoadmap, setFetchingRoadmap] = useState(false);
  /**
   * Suggested mode is gone, so the text input is the only way in and this
   * starts — and stays — true. Nothing sets it false any more; it remains
   * state purely so the few branches still reading it keep compiling, rather
   * than forcing a large refactor of the input area in the same change.
   */
  const [showTextInput, setShowTextInput] = useState(true);
  const [dashboardCountdown, setDashboardCountdown] = useState<number | null>(null);
  const [redirectingToDashboard, setRedirectingToDashboard] = useState(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hasDashboard, setHasDashboard] = useState(false);
  const [newChatCountdown, setNewChatCountdown] = useState<number | null>(null);
  const newChatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callTimerRef = useRef<any>(null);
  const voiceLoopRef = useRef(false);
  const msgIdRef = useRef(1);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  /** The neural clip currently playing, so it can be cut off mid-sentence. */
  const neuralAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Bumped on every new utterance so a superseded run stops speaking. */
  const speakRunIdRef = useRef(0);
  const typewriterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [fullCleanText, setFullCleanText] = useState('');
  const [spokenWordIndex, setSpokenWordIndex] = useState(-1);

  // Load sessions on mount or when auth changes
  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      // Check for forced type from dashboard/sidebar
      // A stored type can point at an agent that has since been disabled, so it
      // is coerced back to an enabled one before it reaches the UI.
      const forcedType = localStorage.getItem('permitops_assistant_type');
      if (forcedType) {
        setAssistantType(resolveAgent(forcedType));
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/sessions`);
          if (res?.ok) {
            const data = await res.json();
            if (!mounted) return;
            setAllSessions(data);

            // Read what Dashboard requested (if any)
            const forcedSessionId = localStorage.getItem('permitops_ask_step_session');
            if (forcedSessionId) {
              localStorage.removeItem('permitops_ask_step_session');
              const fSession = data.find((s: any) => s.id === forcedSessionId);
              setSessionId(forcedSessionId);
              setSessionTitle(fSession ? (fSession.title || '') : '');
              if (fSession && fSession.assistant_type) {
                setAssistantType(resolveAgent(fSession.assistant_type));
              }
              return;
            }

            // Normal load: check if there's a stored active session
            const activeSessionId = localStorage.getItem('permitops_active_session_id');
            const activeSession = data.find((s: any) => s.id === activeSessionId);

            if (activeSession) {
              setSessionId(activeSession.id);
              setSessionTitle(activeSession.title || '');
              // Only override assistant type if no forced type exists
              if (!forcedType && activeSession.assistant_type) {
                setAssistantType(resolveAgent(activeSession.assistant_type));
              }
            } else if (!activeSessionId && forcedType) {
              // Redirected from dashboard with a SPECIFIC agent but NO session.
              // Start blank; the row is created on the first message.
              setSessionId(null);
              setSessionTitle('');
            } else if (data.length > 0) {
              setSessionId(data[0].id);
              setSessionTitle(data[0].title || '');
              if (!forcedType && data[0].assistant_type) setAssistantType(resolveAgent(data[0].assistant_type));
            } else {
              // Brand-new account with nothing to resume. Opening the page is
              // not a conversation, so no row is written yet.
              setSessionId(null);
              setSessionTitle('');
            }
          }
        } catch (e) {
          console.error("Failed to fetch sessions", e);
        }
      } else {
        // Ephemeral GUEST session — unique per visit but not saved in DB
        const existingGuestId = localStorage.getItem('permitops_active_session_id');
        if (existingGuestId && existingGuestId.length > 20) {
          setSessionId(existingGuestId);
        } else {
          const newId = `guest-${Math.random().toString(36).substring(2, 15)}`;
          setSessionId(newId);
          localStorage.setItem('permitops_active_session_id', newId);
        }
      }
    };
    initSession();

    // Load guest message count
    if (!isAuthenticated) {
      const count = parseInt(localStorage.getItem('guest_msg_count_v3') || '0');
      setGuestMsgCount(count);
    }

    return () => { mounted = false; };
  }, [token, isAuthenticated]);

  // Load messages from backend when sessionId changes
  useEffect(() => {
    const loadHistory = async () => {
      const startTime = Date.now();
      if (!sessionId) {
        // Small delay for smooth transition
        await new Promise(r => setTimeout(r, 500));
        setIsLoaded(true);
        return;
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/history/${sessionId}`);
          if (res?.ok) {
            const data = await res.json();
            setMsgs((data as any[]).map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              attachment: m.attachment_id
                ? { id: m.attachment_id, filename: m.attachment_filename ?? 'document.pdf' }
                : null,
              transcript: m.transcript_id ? { id: m.transcript_id } : null,
            })));
            if (data.length > 0) {
              msgIdRef.current = Math.max(...data.map((m: any) => m.id)) + 1;
              // Detect if this session already produced a dashboard so we show the
              // "Start new chat" button instead of service chips on reload.
              const alreadyHasDashboard = data.some((m: any) =>
                m.role === 'assistant' &&
                typeof m.content === 'string' &&
                (m.content.includes('roadmap is being prepared on the Dashboard') ||
                 m.content.includes('Opening your Dashboard') ||
                 m.content.includes('roadmap in') ||
                 m.content.includes('⬇️ Opening your Dashboard'))
              );
              if (alreadyHasDashboard) setHasDashboard(true);
              else setHasDashboard(false);
            } else {
              msgIdRef.current = 1;
              setHasDashboard(false);
            }

            // Rebuild any upload checklists this conversation started. Without
            // this the card only ever existed for the life of the stream that
            // created it, so reopening a chat showed the document list with no
            // way to upload and no sign of what had already been sent.
            try {
              const svcRes = await apiFetch(
                `/api/applications/session?session_id=${encodeURIComponent(sessionId)}&lang=${language}`,
              );
              if (svcRes?.ok) {
                const { services } = await svcRes.json();
                if (Array.isArray(services) && services.length && data.length) {
                  // Anchor to the last assistant message, which is where the
                  // conversation left off.
                  const lastAssistant = [...data].reverse().find((m: any) => m.role === 'assistant');
                  if (lastAssistant) {
                    setChecklists(
                      Object.fromEntries(services.map((svc: ChecklistSeed) => [lastAssistant.id, svc])),
                    );
                  }
                }
              }
            } catch {
              // The transcript still renders; only the card is missing.
            }
          }
        } catch (e) {
          console.error("Failed to fetch history from backend", e);
        }
      } else if (sessionId === "default-session") {
        const saved = localStorage.getItem('permitops_chat_history');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
              setMsgs(parsed);
              msgIdRef.current = Math.max(...parsed.map((m: Msg) => m.id)) + 1;
            }
          } catch (e) {
            console.error("Failed to parse local chat history", e);
          }
        }
      }

      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      setIsLoaded(true);
    };
    loadHistory();
  }, [sessionId, token, isAuthenticated]);

  useEffect(() => {
    if (isLoaded && !isAuthenticated && sessionId === "default-session") {
      localStorage.setItem('permitops_chat_history', JSON.stringify(msgs));
    }
    if (sessionId) {
      localStorage.setItem('permitops_active_session_id', sessionId);
      // Use a specific key so Dashboard only updates when a session is set
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }
  }, [msgs, isLoaded, isAuthenticated, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy, visibleChars]);

  // Auto-send a question if navigated from "Ask AI about this step"
  useEffect(() => {
    // No sessionId requirement: send() creates the row itself now, and a chat
    // arriving from "Ask AI about this step" often has none yet.
    if (!isLoaded) return;
    const pending = localStorage.getItem('permitops_ask_step');
    if (!pending) return;
    localStorage.removeItem('permitops_ask_step');
    // Small delay so the page settles first
    const timer = setTimeout(() => send(pending, false, true), 600);
    return () => clearTimeout(timer);
  }, [sessionId, isLoaded]);

  /**
   * Returns the session id to send with, creating the row the first time it is
   * actually needed. Returns null if creation failed, so the caller can stop
   * rather than post a message that cannot be stored.
   *
   * The row used to be created up front — on page load and again on every agent
   * switch — which meant simply opening the chat inserted a chat_sessions row
   * that usually never received a message. 36% of all rows were empty that way,
   * and the admin session counter climbed for visitors who never typed
   * anything. Nothing is written now until there is a message to write.
   */
  const ensureSession = async (): Promise<string | null> => {
    if (sessionId) return sessionId;

    if (!(isAuthenticated && token)) {
      const guestId = `guest-${Math.random().toString(36).substring(2, 15)}`;
      setSessionId(guestId);
      localStorage.setItem('permitops_active_session_id', guestId);
      return guestId;
    }

    // Two sends fired back to back must not create two rows.
    if (sessionCreationRef.current) return sessionCreationRef.current;

    const creation = (async (): Promise<string | null> => {
      try {
        const res = await apiFetch(`/chat/sessions?assistant_type=${assistantType}`, { method: 'POST' });
        if (!res?.ok) return null;
        const data = await res.json();
        setAllSessions(prev => [data, ...prev]);
        setSessionId(data.id);
        localStorage.setItem('permitops_active_session_id', data.id);
        return data.id as string;
      } catch (e) {
        console.error('Failed to create new session', e);
        return null;
      } finally {
        sessionCreationRef.current = null;
      }
    })();

    sessionCreationRef.current = creation;
    return creation;
  };

  const handleNewChat = async () => {
    if (isAuthenticated && token) {
      // No row yet — ensureSession() creates it when the first message is sent.
      setSessionId(null);
    } else {
      // Ephemeral GUEST reset
      const newGuestId = `guest-${Math.random().toString(36).substring(2, 15)}`;
      setSessionId(newGuestId);
      localStorage.setItem('permitops_active_session_id', newGuestId);
      clearChat();
    }
    setHasDashboard(false);
    setMsgs([]);
    setSessionTitle('');
  };

  // 3-second countdown then auto-open a new chat of the same agent type
  const triggerNewChatCountdown = () => {
    if (newChatTimerRef.current) return;
    setNewChatCountdown(3);
    newChatTimerRef.current = setInterval(() => {
      setNewChatCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(newChatTimerRef.current!);
          newChatTimerRef.current = null;
          setNewChatCountdown(null);
          handleNewChat();
          return null;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * Route a credit prompt to the right place.
   *
   * "You have no credits" is information, not a decision — a modal that asks
   * nothing but still has to be dismissed is friction, and this one floated a
   * hardcoded white card over a dark transcript. It reads as a normal reply
   * instead. A prompt that genuinely asks something ("use 1 credit?") still
   * gets the dialog, because that one wants an answer.
   */
  const presentCreditPrompt = (pending: PendingConfirm, query: string) => {
    const hasCredits = (pending.creditsAvailable ?? 0) > 0;
    if (hasCredits || pending.requiresAuth) {
      setPendingConfirm({ ...pending, query });
      return;
    }
    const id = msgIdRef.current++;
    setVisibleChars(prev => ({ ...prev, [id]: Number.MAX_SAFE_INTEGER }));
    setMsgs(p => [...p, { id, role: 'assistant', content: t('chat_no_credits_msg') }]);
  };

  const switchAssistant = (newType: 'permit' | 'student' | 'lawyer') => {
    if (newType === assistantType || isAgentDisabled(newType)) return;

    setSwitchingAgent(true);
    setAssistantType(newType);
    setIsDropdownOpen(false);

    // Give the premium loading screen a moment to shine
    setTimeout(() => {
      // Resume logic: find the most recent session belonging to the requested type
      const recentSession = allSessions.find(s => (s.assistant_type || 'permit') === newType);
      if (recentSession) {
        setSessionId(recentSession.id);
        setSessionTitle(recentSession.title || '');
      } else {
        // No chat with this agent yet. Switching tabs is not a conversation —
        // the row waits until something is actually sent.
        setSessionId(null);
        setSessionTitle('');
        setMsgs([]);
        setHasDashboard(false);
      }

      // Keep loading for at least 1.5s for the wow factor
      setTimeout(() => setSwitchingAgent(false), 1500);
    }, 100);
  };

  // --- Voice Chat Logic ---
  /**
   * Start or end the call.
   *
   * A call needs a purchased credit to open, but never spends one. The call is
   * how somebody tells us what they need; charging for that would be charging
   * before we have done anything. The credit is spent later, when the service
   * they asked for actually starts. The server decides — asking it rather than
   * reading a cached balance means the answer cannot drift from the truth, and
   * the endpoint it asks has no code path that consumes anything.
   */
  /**
   * Start dictating into the message box.
   *
   * Not gated on a service credit the way a call is: this is one upload with
   * no session and no per-minute billing, and putting the microphone behind a
   * paywall would make it dead for most of the people who would use it.
   */
  const startDictation = async () => {
    if (isDictating || busy) return;
    try {
      const d = await Dictation.start({
        onLevels: setDictationLevels,
        onError: (detail) => console.warn('[dictation]', detail),
      });
      dictationRef.current = d;
      setIsDictating(true);
      setShowTextInput(true);   // the words need somewhere visible to land
    } catch {
      // Almost always a refused microphone. Said plainly rather than silently.
      setVoiceError('Microphone access is needed to dictate. Allow it in your browser and try again.');
    }
  };

  const cancelDictation = () => {
    dictationRef.current?.cancel();
    dictationRef.current = null;
    setIsDictating(false);
    setDictationLevels(new Array(LEVEL_BARS).fill(0));
  };

  /**
   * Stop recording and put the words in the box.
   *
   * `andSend` is the up-arrow: transcribe and send in one gesture. Everything
   * else lands as editable text first, which is the whole reason this is not
   * the browser's live recogniser — a misheard word should be fixable, not
   * already sent.
   */
  const finishDictation = async (andSend: boolean) => {
    const d = dictationRef.current;
    if (!d) return;
    dictationRef.current = null;
    setIsDictating(false);
    setDictationLevels(new Array(LEVEL_BARS).fill(0));

    const clip = await d.stop();
    if (!clip) return;   // too short to be anything but a mis-tap

    setIsTranscribing(true);
    try {
      const form = new FormData();
      form.append('audio', clip.blob, 'dictation.webm');
      form.append('language', language);
      const res = await apiFetch('/api/voice/transcribe', { method: 'POST', body: form });
      const text = res?.ok ? String((await res.json())?.text ?? '').trim() : '';

      if (!text) {
        setVoiceError(res?.ok ? null : 'Could not transcribe that. Please try again.');
        return;
      }

      // Appended, not replaced — dictating after typing should extend the
      // message rather than throw away what is already there.
      const merged = input.trim() ? `${input.trim()} ${text}` : text;
      if (andSend) {
        void send(merged);
        setInput('');
      } else {
        setInput(merged);
        inputRef.current?.focus();
      }
    } catch {
      setVoiceError('Could not transcribe that. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

  /** Leaving the page mid-recording must release the microphone. */
  useEffect(() => () => { dictationRef.current?.cancel(); dictationRef.current = null; }, []);

  const toggleVoice = async () => {
    if (isListening || isVoiceMode) {
      hangUpCall();
      return;
    }

    setVoiceGateChecking(true);
    let gate: { allowed?: boolean; reason?: string; credits?: number } | null = null;
    try {
      const res = await apiFetch('/api/voice/eligibility');
      if (res?.ok) gate = await res.json();
    } catch {
      // Treated as not allowed below — better than opening a call we cannot back.
    }
    setVoiceGateChecking(false);

    if (!gate?.allowed) {
      // Said in the chat rather than an alert, so it sits with the rest of the
      // conversation and the pricing link is one tap away.
      const id = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [id]: Number.MAX_SAFE_INTEGER }));
      setMsgs(p => [...p, {
        id,
        role: 'assistant',
        content: gate?.reason === 'sign_in_required'
          ? t('voice_sign_in')
          : t('voice_needs_credit'),
      }]);
      return;
    }

    startCall();
  };

  /**
   * Which voice engine a call runs on.
   *
   * 'realtime' is a single WebRTC session — the model hears the caller directly
   * and answers as they finish, and can be interrupted. 'classic' is the older
   * recognise → Qwen → text-to-speech chain, kept because Realtime cannot be
   * exercised without a live OpenAI key and a rollback should not need a code
   * change. Set NEXT_PUBLIC_VOICE_REALTIME=false to go back.
   */
  const useRealtimeVoice = process.env.NEXT_PUBLIC_VOICE_REALTIME !== 'false';

  /** Shared reset for either engine. */
  const beginCallUi = () => {
    setIsVoiceMode(true);
    setCallEnded(false);
    setCallDuration(0);
    callSecondsRef.current = 0;
    transcriptFiledRef.current = false;
    realtimeTurnsRef.current = [];
    agentSpeechRef.current = '';
    callOutcomeRef.current = { service: null, detail: null };
    setVoiceChoices({});
    setVoiceLevel(0);
    setVoiceError(null);
    setDetectedService(null); // nothing assumed — the chip appears once a service is heard
    setVoiceTranscript('');
    setFullCleanText('');
    setSpokenWordIndex(-1);
    callTimerRef.current = setInterval(() => {
      callSecondsRef.current += 1;
      setCallDuration(callSecondsRef.current);
    }, 1000);
  };

  const startCall = () => {
    beginCallUi();
    if (useRealtimeVoice) { void startRealtimeCall(); return; }

    // ── classic path ──
    voiceLoopRef.current = true;

    // Initial Greeting — short, punchy, human. Spoken aloud, so it must match
    // the call's language: a Turkmen call opening in English reads as broken.
    const greeting = VOICE_GREETINGS[language] ?? VOICE_GREETINGS.en;

    // Small delay for UI transition, then greet immediately
    setTimeout(() => { speak(greeting); }, 400);
  };

  /**
   * Open a Realtime call.
   *
   * There is no greeting to play here: the model opens the conversation itself
   * from its instructions, which is why the first thing the caller hears
   * arrives in well under a second instead of after a round trip.
   */
  const startRealtimeCall = async () => {
    try {
      const res = await apiFetch('/api/voice/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, assistant_type: assistantType }),
      });

      if (!res?.ok) {
        const detail = (await res?.json().catch(() => null))?.detail ?? 'voice unavailable';
        console.warn('[voice] realtime session refused:', detail);
        // 402 is the one the caller can act on themselves; everything else is
        // ours to fix, so it is reported as such rather than blamed on them.
        setVoiceError(
          res?.status === 402
            ? detail
            : 'Voice is unavailable right now. Please try again shortly.',
        );
        hangUpCall();
        return;
      }

      const { client_secret, model } = await res.json();

      const call = await RealtimeCall.open({ client_secret, model }, {
        onUserTranscript: (text, final) => {
          setVoiceTranscript(text);
          if (final && text.trim()) {
            realtimeTurnsRef.current.push({ role: 'user', content: text.trim() });
            setVoiceTranscript('');
          }
        },
        onAgentTranscript: (text, final) => {
          // Deltas arrive as increments; the done event carries the whole turn.
          agentSpeechRef.current = final ? text : agentSpeechRef.current + text;
          setFullCleanText(agentSpeechRef.current);
          if (final && text.trim()) {
            realtimeTurnsRef.current.push({ role: 'assistant', content: text.trim() });
            agentSpeechRef.current = '';
          }
        },
        onSpeakingChange: markSpeaking,
        onListeningChange: setIsListening,
        onAudioLevel: setVoiceLevel,
        onToolCall: async (name, args) => {
          // Realtime tools run in the browser, so this is the bridge to the
          // server half. Only the lookups that make sense out loud are wired
          // up — a roadmap or a document checklist read aloud is exactly what
          // VOICE_STYLE exists to prevent.
          if (name === 'record_choice') {
            // Merged, not replaced: the university and the subject usually
            // arrive in separate calls, and the second must not blank the first.
            setVoiceChoices((prev) => ({
              ...prev,
              ...(args.university ? { university: String(args.university) } : {}),
              ...(args.major ? { major: String(args.major) } : {}),
              ...(args.service ? { service: String(args.service) } : {}),
            }));
            if (args.service) {
              const chosen = String(args.service);
              // Remembered now, not at the close: a caller who hangs up on
              // their own never reaches end_call, and the requirements are the
              // one thing they came for.
              callOutcomeRef.current = { ...callOutcomeRef.current, service: chosen };
              const chipId = SERVICE_TO_CHIP[chosen];
              if (chipId) setDetectedService(chipId);
            }
            return { ok: true };
          }

          if (name === 'suggest_universities') {
            const r = await apiFetch('/api/voice/universities', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(args),
            });
            if (!r?.ok) throw new Error('university lookup failed');
            return r.json();
          }
          return {
            error: 'unknown_tool',
            message: 'That is not something you can do on a call. Say so briefly and carry on.',
          };
        },
        onEndCall: (args) => {
          // Same job the [CALL_COMPLETE] token did on the classic path: the
          // model has what it needs, so the line drops. RealtimeCall waits for
          // the closing sentence to finish playing before tearing down.
          //
          // The tool's enum is spelled for the model's benefit — 'residence_permit'
          // is unambiguous to it — while the UI has always keyed its chips on
          // shorter ids. Without this map the chip silently never appeared.
          const chosen = args.service ?? null;
          callOutcomeRef.current = { service: chosen, detail: args.detail ?? null };
          const chipId = chosen ? (SERVICE_TO_CHIP[chosen] ?? null) : null;
          if (chipId) setDetectedService(chipId);
        },
        onClosed: () => { hangUpCall(); },
        onError: (detail) => console.warn('[voice] realtime:', detail),
      });

      realtimeCallRef.current = call;
    } catch (e) {
      // Mic refused, SDP rejected, network gone — all end the call rather than
      // leaving the caller on a screen that looks connected.
      console.warn('[voice] could not start realtime call', e);
      const denied = e instanceof DOMException &&
        (e.name === 'NotAllowedError' || e.name === 'NotFoundError');
      setVoiceError(
        denied
          ? 'Microphone access is needed for a voice call. Allow it in your browser and try again.'
          : 'Voice is unavailable right now. Please try again shortly.',
      );
      hangUpCall();
    }
  };

  /**
   * File the call that just ended, then replace its turns in the thread with
   * the single line the server wrote.
   *
   * The turns exist only in `msgs` at this point — /agent/query was told not to
   * persist them — so this is the one chance to keep them. If it fails the
   * transcript is lost, which is why a failure still clears the turns rather
   * than leaving a half-call in the thread: a thread that silently gains forty
   * rows of speech noise is worse than a call with no record.
   */
  const fileTranscript = async () => {
    if (transcriptFiledRef.current) return;
    transcriptFiledRef.current = true;

    // Two engines, two places the turns come from. Realtime speech never
    // passes through send(), so it is collected as it is transcribed; classic
    // turns are the voice-flagged messages. Only one list is ever non-empty.
    const turns = realtimeTurnsRef.current.length
      ? realtimeTurnsRef.current.filter((t) => t.content.trim())
      : msgsRef.current
          .filter((m) => m.voice && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content.trim() }));

    // Always drop the spoken turns, whatever happens to the upload below.
    const clearVoiceTurns = (extra?: Msg) => {
      setMsgs((prev) => {
        const kept = prev.filter((m) => !m.voice);
        return extra ? [...kept, extra] : kept;
      });
    };

    if (!turns.length) { clearVoiceTurns(); return; }

    try {
      const res = await apiFetch('/api/voice/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          turns,
          duration_seconds: callSecondsRef.current,
          language,
          assistant_type: assistantType,
          // What the call was for. Null when they hung up before deciding,
          // which the server stores as-is rather than guessing.
          service: callOutcomeRef.current.service,
          detail: callOutcomeRef.current.detail,
        }),
      });

      const data = res?.ok ? await res.json().catch(() => null) : null;
      if (data?.saved && data.transcript_id) {
        // A call started from an empty chat creates its own thread server-side.
        // Adopting the id here is what moves the caller into it — without this
        // the transcript and the document list exist in a session the UI is
        // not looking at, which reads exactly like nothing was saved.
        if (data.session_id && data.session_id !== sessionId) {
          setSessionId(data.session_id);
          setSidebarRefresh((n) => n + 1);
        }
        const summaryId = msgIdRef.current++;
        clearVoiceTurns({
          id: summaryId,
          role: 'assistant',
          content: String(data.label ?? 'Voice call'),
          transcript: { id: data.transcript_id },
        });
        // The documents they now need, hung off the call's own entry. This is
        // the point of the call: they said what they wanted out loud, and the
        // upload list is waiting for them when they hang up.
        if (data.checklist) {
          setChecklists((prev) => ({ ...prev, [summaryId]: data.checklist }));
        }
        return;
      }
      // Guest or unsaved session: nothing to link, so the call simply leaves
      // no trace rather than dumping its turns into an unsaved thread.
      clearVoiceTurns();
    } catch {
      console.warn('[voice] could not file transcript');
      clearVoiceTurns();
    }
  };

  const hangUpCall = () => {
    // RealtimeCall reports its own closure, and that report calls back in here.
    // Detaching the reference before hanging up is what stops the two bouncing
    // off each other.
    const live = realtimeCallRef.current;
    realtimeCallRef.current = null;

    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    stopNeuralAudio();
    live?.hangUp();
    clearInterval(callTimerRef.current);
    setIsListening(false);
    markSpeaking(false);
    setCallEnded(true);
    void fileTranscript();
    // Push to dashboard after 2s then close
    setTimeout(() => {
      setIsVoiceMode(false);
      setCallEnded(false);
      // Trigger dashboard refresh
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }, 3000);
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Speech recognition not supported in this browser.'); return; }

    // The old setup queued a silent utterance here to wake the speech engine.
    // The neural path plays through an <audio> element instead, and a queued
    // utterance only competes with it, so nothing is primed any more.

    const rec = new SpeechRecognition();
    // Browsers' Web Speech API has no Turkmen recognition locale — fall back to English rather
    // than passing an unsupported tag that would silently break recognition.
    rec.lang = language === 'tr' ? 'tr-TR' : language === 'ar' ? 'ar-SA' : 'en-US';
    rec.continuous = true;       // phone-call style — keep listening
    rec.interimResults = true;   // show live transcript
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
      setIsListening(false);
      // Auto-restart quickly if still in call and AI isn't speaking
      if (voiceLoopRef.current && !isSpeakingRef.current) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeakingRef.current) startListening(); }, 150);
      }
    };

    rec.onerror = (e: any) => {
      if ((e.error === 'no-speech' || e.error === 'aborted') && voiceLoopRef.current) {
        setTimeout(() => { if (voiceLoopRef.current && !isSpeakingRef.current) startListening(); }, 200);
      } else if (e.error !== 'not-allowed') {
        setIsListening(false);
      }
    };

    let lastFinalTranscript = '';

    rec.onresult = (event: any) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t;
        else interimTranscript += t;
      }

      const liveText = (finalTranscript || interimTranscript).trim();
      if (liveText) setVoiceTranscript(liveText);

      // Live service detection
      // The call covers exactly four services, so detection covers exactly
      // four. Business and legal used to be matched here and are no longer
      // offered — leaving them in would light up a chip for something the
      // agent has just been told it cannot do.
      const lower = liveText.toLowerCase();
      if (/insurance|sigorta|sağlık sigorta|saglik sigorta|تأمين|ätiýaçlandyryş/.test(lower)) {
        setDetectedService('insurance');
      } else if (/ikamet|residence permit|residency|kimlik|oturma izni|uzatma|إقامة|ýaşaýyş/.test(lower)) {
        setDetectedService('ikamet');
      } else if (/visa|vize|consulate|تأشيرة|wiza/.test(lower)) {
        setDetectedService('visa');
      } else if (/university|universite|üniversite|student|study|register|denklik|jamiat|جامعة|طالب|uniwersitet/.test(lower)) {
        setDetectedService('university');
      }

      if (finalTranscript && finalTranscript !== lastFinalTranscript && finalTranscript.length > 2) {
        // Browser confirmed final — send immediately, no silence wait
        lastFinalTranscript = finalTranscript;
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        handleUserFinished(finalTranscript);
        return;
      }

      // Interim: start/reset silence timer — 500ms feels like natural call pacing
      if (interimTranscript.length > 2) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (interimTranscript.trim().length > 2) handleUserFinished(interimTranscript.trim());
        }, 500);
      }
    };

    const handleUserFinished = (transcript: string) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setVoiceTranscript('');
      try { rec.stop(); } catch (e) { }
      send(transcript, true);
    };

    recognitionRef.current = rec;
    try { rec.start(); } catch { }
  };

  const stopListening = () => {
    voiceLoopRef.current = false;
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  // ── Pre-process text for natural, fast TTS ───────────────────────────────────
  const cleanForSpeech = (raw: string): string => raw
    .replace(/\[CALL_COMPLETE\]/gi, '')            // control token, never spoken
    .replace(/\[CTA: .+? \| .+?\]/g, '')           // remove CTA blocks
    .replace(/```[\s\S]*?```/g, '')                  // remove code blocks
    .replace(/`[^`]+`/g, '')                         // remove inline code
    .replace(/#+\s*/g, '')                            // remove markdown headings
    .replace(/[*_~>|]/g, '')                          // remove markdown symbols
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')              // links → label only
    .replace(/!\[.*?\]\(.*?\)/g, '')                 // remove images
    .replace(/\n{2,}/g, '. ')                         // double newline → pause
    .replace(/\n/g, ' ')                              // single newline → space
    .replace(/\s{2,}/g, ' ')                          // collapse whitespace
    .replace(/([.!?])([A-Z])/g, '$1 $2')             // ensure space after sentence
    .trim();

  /** Settles the clip currently playing, if any. Installed by playNeural. */
  const neuralFinishRef = useRef<((ok: boolean) => void) | null>(null);

  /** Silence the neural voice immediately, mid-sentence if need be. */
  const stopNeuralAudio = () => {
    speakRunIdRef.current++;
    const audio = neuralAudioRef.current;
    const finish = neuralFinishRef.current;

    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch { /* already torn down */ }
    }

    // Pausing fires neither `ended` nor `error`, so the promise awaiting this
    // clip would never settle — speakAll would sit on that await forever,
    // holding the clip and its blob URL, once per interruption. Settle it here.
    if (finish) finish(false);
  };

  /**
   * Fetch one sentence as audio. NEVER rejects: it resolves to a blob URL, or
   * null when the neural voice is unavailable — no key, no quota on the OpenAI
   * account, language not enabled, upstream down.
   *
   * Fetching is deliberately a separate step from playing. They used to be one
   * function, and the "prefetch the next sentence" call therefore started
   * playing it the moment its download finished — on top of the sentence still
   * being spoken. That is what two voices talking over each other was.
   */
  const fetchNeural = async (sentence: string): Promise<string | null> => {
    try {
      const res = await apiFetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence, lang: language }),
      });
      if (!res?.ok) return null;

      const blob = await res.blob();
      if (!blob.size) return null;
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  };

  /**
   * Play one already-fetched clip through to the end.
   *
   * Resolves true when it finished and false when it could not play at all
   * (autoplay blocked, decode failure). Never rejects.
   */
  const playNeural = (url: string, wordOffset: number, wordCount: number): Promise<boolean> =>
    new Promise((resolve) => {
      const audio = new Audio(url);
      neuralAudioRef.current = audio;

      // An <audio> element has no word-boundary event, so the caption
      // highlight is interpolated from playback position instead. A blob's
      // duration reads Infinity until metadata lands, hence the speaking-rate
      // estimate rather than dividing by it unchecked.
      const WORDS_PER_SECOND = 2.8;
      audio.ontimeupdate = () => {
        const total = audio.duration;
        const spoken = Number.isFinite(total) && total > 0
          ? (audio.currentTime / total) * wordCount
          : audio.currentTime * WORDS_PER_SECOND;
        setSpokenWordIndex(wordOffset + Math.min(Math.floor(spoken), wordCount));
      };

      const finish = (ok: boolean) => {
        audio.ontimeupdate = null;
        audio.onended = null;
        audio.onerror = null;
        if (neuralAudioRef.current === audio) neuralAudioRef.current = null;
        if (neuralFinishRef.current === finish) neuralFinishRef.current = null;
        URL.revokeObjectURL(url);
        resolve(ok);   // resolving twice is a no-op, so races here are harmless
      };
      neuralFinishRef.current = finish;

      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });

  /**
   * Group sentences into the chunks that actually get sent for synthesis.
   *
   * One request per sentence sounds slow for a reason that is not the voice:
   * a request takes roughly 1.2-1.5s to come back, so any clip shorter than
   * that leaves dead air after it while the next one downloads. "Sure." is
   * half a second of audio and a second of silence.
   *
   * The first chunk is left as a single sentence, because time-to-first-sound
   * is what makes the call feel answered and a short line synthesises fastest.
   * Everything after it is packed up to CHUNK_CHARS, which is comfortably more
   * audio than one request takes to fetch, so the pipeline stays ahead.
   */
  const chunkForSpeech = (sentences: string[]): string[] => {
    const CHUNK_CHARS = 220;          // well under the route's 800-char limit
    if (sentences.length <= 1) return sentences;

    const chunks = [sentences[0]];
    for (const sentence of sentences.slice(1)) {
      const last = chunks[chunks.length - 1];
      // Never merge into the opening line — that would undo the fast start.
      if (chunks.length > 1 && last.length + 1 + sentence.length <= CHUNK_CHARS) {
        chunks[chunks.length - 1] = last + ' ' + sentence;
      } else {
        chunks.push(sentence);
      }
    }
    return chunks;
  };

  /**
   * Say a whole reply, one chunk at a time.
   *
   * This also owns the call's turn-taking, which the browser utterance handlers
   * used to own: the mic is closed for as long as the agent is talking and
   * reopened once at the end, so the caller is never transcribed saying what
   * the agent just said.
   *
   * Each chunk is downloaded while the previous one plays, which is what keeps
   * the gap between them short enough to sound like one person talking.
   */
  const speakAll = async (sentences: string[], onDone?: () => void) => {
    const runId = ++speakRunIdRef.current;
    const superseded = () => runId !== speakRunIdRef.current;

    // Word offsets for the caption, so sentence 3 highlights from where
    // sentence 2 stopped rather than restarting at zero.
    const counts = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
    const offsets: number[] = [];
    counts.reduce((acc, n) => { offsets.push(acc); return acc + n; }, 0);

    // Take the turn straight away so the mic cannot reopen underneath us, but
    // leave the visible "speaking" state alone: the first clip is still ~1.3s
    // from arriving, and lighting up the speaking UI over silence is what made
    // the start of a reply look hung.
    isSpeakingRef.current = true;
    if (recognitionRef.current) try { recognitionRef.current.stop(); } catch { }

    let announced = false;
    const announceSpeaking = () => {
      if (announced) return;
      announced = true;
      setIsSpeaking(true);
    };

    let pending = fetchNeural(sentences[0]);
    try {
      for (let i = 0; i < sentences.length; i++) {
        const url = await pending;
        if (superseded()) return;

        // Start the next download before playing this clip, not after.
        pending = i + 1 < sentences.length
          ? fetchNeural(sentences[i + 1])
          : Promise.resolve(null);

        if (!url) {
          // There is no second voice to fall back to any more, so this is
          // silence rather than a worse-sounding reply. Worth a line in the
          // console: the usual cause is an OpenAI account with no quota, and
          // /api/voice/tts logs the upstream error server-side.
          console.warn('[voice] no neural audio for chunk', i, '— check /api/voice/tts');
          break;
        }

        announceSpeaking();
        const played = await playNeural(url, offsets[i], counts[i]);
        if (superseded()) return;
        if (!played) break;
      }
    } finally {
      // A clip may already have downloaded for a sentence never reached.
      void pending.then((u) => { if (u) URL.revokeObjectURL(u); }).catch(() => { });
    }

    if (superseded()) return;
    markSpeaking(false);
    setSpokenWordIndex(-1);
    // Hand the turn back to the caller.
    if (voiceLoopRef.current) {
      setTimeout(() => { if (voiceLoopRef.current) startListening(); }, 120);
    }
    // Reached only when this reply finished (or gave up) and nothing replaced
    // it — never when superseded, since then another reply owns the call.
    onDone?.();
  };

  const speak = (text: string, onDone?: () => void) => {
    stopNeuralAudio();

    const cleanText = cleanForSpeech(text);
    setFullCleanText(cleanText);
    setSpokenWordIndex(0);

    // Split into sentences — keeps punctuation, handles ellipsis & abbreviations
    const sentences = cleanText
      .match(/[^.!?\n]+(?:[.!?]+['"]?|$)/g)
      ?.map(s => s.trim())
      .filter(s => s.length > 1) ?? [cleanText];

    if (!sentences.length) { onDone?.(); return; }
    void speakAll(chunkForSpeech(sentences), onDone);
  };

  const handleDeleteSession = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/history/${id}`, { method: 'DELETE' });
      if (res?.ok) {
        setAllSessions(prev => prev.filter((s: any) => s.id !== id));
        if (sessionId === id) setSessionId(null);
        else setSessionId(prev => prev);
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const handleToggleFavorite = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/sessions/${id}/favorite`, { method: 'POST' });
      if (res?.ok) {
        setSidebarRefresh(prev => prev + 1);
      }
    } catch (e) {
      console.error("Failed to toggle favorite", e);
    }
  };

  const saveMessagesToHistory = async (
    messages: { role: 'user' | 'assistant'; content: string }[],
    service?: string,
    flowType?: 'new' | 'renewal'
  ) => {
    if (!sessionId) return;
    try {
      const res = await apiFetch(`/chat/history/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, service, flow_type: flowType }),
      });
      if (res?.ok) {
        const data = await res.json();
        if (data.session_title && data.session_title !== sessionTitle) {
          setSessionTitle(data.session_title);
        }
        setSidebarRefresh(prev => prev + 1);
        
        // Trigger dashboard refresh
        localStorage.setItem('permitops_workflow_update', Date.now().toString());
        window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
      }
    } catch (e) {
      console.error("Failed to save messages to history", e);
    }
  };

  const handleAreaSubmit = async (areaName: string) => {
    if (!awaitingAreaService || busy) return;
    const service = awaitingAreaService;
    setAwaitingAreaService(null);

    // Add user message to UI
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: areaName };
    setMsgs(p => [...p, userMsg]);
    setBusy(true);

    const activeSessionId = await ensureSession();
    if (!activeSessionId) {
      setBusy(false);
      return;
    }

    try {
      const serviceAssistantType =
        ['ID / İkamet', 'Student Visa', 'Denklik (Equivalency)', 'University Registration', 'Dormitory & Housing', 'IstanbulKart'].includes(service) ? 'student' :
        ['Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law'].includes(service) ? 'lawyer' : 'permit';

      const stepsMsgId = msgIdRef.current++;
      setMsgs(p => [...p, { id: stepsMsgId, role: 'assistant', content: '' }]);

      const body = JSON.stringify({
        query: `${service} - New Application in ${areaName}`,
        language: language,
        context: { session_id: activeSessionId },
        assistant_type: serviceAssistantType,
        save_history: false
      });

      localStorage.setItem('permitops_active_session_id', activeSessionId);
      localStorage.setItem('permitops_assistant_type', serviceAssistantType);

      // Start the query in the background immediately
      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!res || !res.ok) throw new Error("Failed to generate workflow steps");

      // The roadmap arrives as a `dashboard` frame — keep it as-is rather than
      // reconstructing steps by parsing the summary markdown.
      let roadmap: Record<string, unknown> | null = null;
      const stepsText = await readAgentStream(res, {
        onDelta: chunk => {
          setMsgs(p => p.map(m => (m.id === stepsMsgId ? { ...m, content: m.content + chunk } : m)));
          setVisibleChars(prev => ({ ...prev, [stepsMsgId]: Number.MAX_SAFE_INTEGER }));
        },
        onDashboard: state => { roadmap = state; },
      });

      if (!roadmap) throw new Error("No roadmap returned");

      // Save messages to history
      await saveMessagesToHistory([
        { role: 'user', content: areaName },
        { role: 'assistant', content: stepsText }
      ], service, 'new');

      // Save workflow locally so guests can see steps on the dashboard
      localStorage.setItem('permitops_guest_workflow', JSON.stringify(roadmap));

      // Trigger dashboard reload event
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));

      // Show loading screen immediately, navigate to dashboard after 2s
      setFetchingRoadmap(true);
      setTimeout(() => {
        setFetchingRoadmap(false);
        setBusy(false);
        router.push('/applications');
      }, 2000);

    } catch (err) {
      console.error(err);
      setFetchingRoadmap(false);
      setBusy(false);
      setMsgs(p => [...p, {
        id: msgIdRef.current++,
        role: 'assistant',
        content: language === 'tr'
          ? "⚠️ Yol haritası oluşturulurken bir hata oluştu. Lütfen tekrar deneyin."
          : language === 'ar'
          ? "⚠️ حدث خطأ أثناء إنشاء خارطة الطريق. يرجى المحاولة مرة أخرى."
          : language === 'tk'
          ? "⚠️ Ýol kartasyny döretmekde ýalňyşlyk ýüze çykdy. Gaýtadan synanyşyň."
          : "⚠️ Error occurred while generating the roadmap. Please try again."
      }]);
    }
  };

  const handleRenewalSubmit = async (service: string) => {
    if (busy) return;
    setBusy(true);

    const activeSessionId = await ensureSession();
    if (!activeSessionId) {
      setBusy(false);
      return;
    }

    try {
      const serviceAssistantType =
        ['ID / İkamet', 'Student Visa', 'Denklik (Equivalency)', 'University Registration', 'Dormitory & Housing', 'IstanbulKart'].includes(service) ? 'student' :
        ['Company Formation', 'Contract Review', 'Employment Law', 'Legal Disputes', 'Residency & Visas', 'Real Estate Law'].includes(service) ? 'lawyer' : 'permit';

      const loadingMsgId = msgIdRef.current++;
      setMsgs(p => [...p, { id: loadingMsgId, role: 'assistant', content: '' }]);

      // Enable the fullscreen loading page overlay for fetching transition
      setFetchingRoadmap(true);

      const body = JSON.stringify({
        query: `${service} - Renewal`,
        language: language,
        context: { session_id: activeSessionId },
        assistant_type: serviceAssistantType,
        save_history: false
      });

      localStorage.setItem('permitops_active_session_id', activeSessionId);
      localStorage.setItem('permitops_assistant_type', serviceAssistantType);

      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });

      if (!res || !res.ok) throw new Error("Failed to generate workflow steps");

      let roadmap: Record<string, unknown> | null = null;
      const summary = await readAgentStream(res, {
        onDelta: chunk => {
          setMsgs(p => p.map(m => (m.id === loadingMsgId ? { ...m, content: m.content + chunk } : m)));
          setVisibleChars(prev => ({ ...prev, [loadingMsgId]: Number.MAX_SAFE_INTEGER }));
        },
        onDashboard: state => { roadmap = state; },
      });

      if (!roadmap) throw new Error("No roadmap returned");

      // Save messages to history
      await saveMessagesToHistory([
        { role: 'assistant', content: summary }
      ], service, 'renewal');

      // Save workflow locally so guests can see steps on the dashboard
      localStorage.setItem('permitops_guest_workflow', JSON.stringify(roadmap));

      // Trigger dashboard reload event
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));

      // Wait a moment for UX smoothness and animation
      setTimeout(() => {
        setFetchingRoadmap(false);
        setBusy(false);
        router.push('/applications');
      }, 1500);

    } catch (err) {
      console.error(err);
      setFetchingRoadmap(false);
      setBusy(false);
      setMsgs(p => [...p, {
        id: msgIdRef.current++,
        role: 'assistant',
        content: language === 'tr'
          ? "⚠️ Yol haritası oluşturulurken bir hata oluştu. Lütfen tekrar deneyin."
          : language === 'ar'
          ? "⚠️ حدث خطأ أثناء إنشاء خارطة الطريق. يرجى المحاولة مرة أخرى."
          : language === 'tk'
          ? "⚠️ Ýol kartasyny döretmekde ýalňyşlyk ýüze çykdy. Gaýtadan synanyşyň."
          : "⚠️ Error occurred while generating the roadmap. Please try again."
      }]);
    }
  };

  // Start a service: if it has a New/Renewal flow, show that question in chat;
  // otherwise send it as a query. Shared by the empty-state cards and the
  // Suggested-mode service strip — the single entry point into a service flow.
  const startService = (label: string) => {
    if (RENEWAL_SERVICES.includes(label) && SERVICE_FLOW_RESPONSES[label]) {
      const askText = getLocalizedAsk(label, language);
      const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: label };
      const askId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [askId]: 0 }));
      setMsgs(p => [...p, userMsg, { id: askId, role: 'assistant', content: askText }]);
      setAwaitingAreaService(null);
      setPendingServiceChoice(label);
      let chars = 0;
      const interval = setInterval(() => {
        chars += 15;
        setVisibleChars(prev => ({ ...prev, [askId]: chars }));
        if (chars >= askText.length) clearInterval(interval);
      }, 30);
      setSessionTitle(label);
      saveMessagesToHistory([
        { role: 'user', content: label },
        { role: 'assistant', content: askText },
      ], label);
    } else {
      send(label);
    }
  };

  /**
   * Download a filed voice call as a .txt (GET /api/voice/transcript/[id]).
   * The server renders the file; this only names it from the header it sends.
   */
  const downloadTranscript = async (transcriptId: number) => {
    try {
      const res = await apiFetch(`/api/voice/transcript/${transcriptId}`, { method: 'GET' });
      if (!res?.ok) throw new Error('download failed');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `voice-call-${transcriptId}.txt`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      console.warn('[chat] transcript download failed');
    }
  };

  /**
   * Download a document the agent generated (GET /api/documents/[id]).
   * Uses apiFetch so the Authorization header rides along — the route serves
   * the file only to the application's owner.
   */
  const downloadAttachment = async (docId: number) => {
    try {
      const res = await apiFetch(`/api/documents/${docId}`, { method: 'GET' });
      if (!res?.ok) throw new Error('download failed');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const nameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = nameMatch?.[1] ?? 'document.pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      console.warn('[chat] attachment download failed');
    }
  };

  const send = async (text?: string, isFromVoice: boolean = false, isStepQuery: boolean = false, confirmCredit: boolean = false) => {
    const q = (text ?? input).trim();
    if ((!q && !file) || busy) return;    if (awaitingAreaService) {
      setInput('');
      handleAreaSubmit(q);
      return;
    }

    const wasListening = isListening; // Capture state before potential reset
    setInput('');
    stopNeuralAudio();
    markSpeaking(false);

    const displayQ = file ? `📎 [Attached: ${file.name}]\n${q}` : q;
    // Whether this turn belongs to a call rather than to the thread. Computed
    // once here and reused for the reply, so a call that ends mid-exchange
    // cannot leave the question filed as voice and the answer filed as chat.
    const spokenTurn = isVoiceMode || isFromVoice || wasListening;
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: displayQ, voice: spokenTurn };
    setMsgs(p => [...p, userMsg]);

    // ── Dashboard session lock — only step queries are allowed ──────────────
    if (hasDashboard && !isStepQuery) {
      const blockMsg = language === 'tr'
        ? '📊 Bu sohbette yalnızca dashboard adımları hakkında soru sorabilirsiniz. Yeni bir hizmet için lütfen yeni bir sohbet başlatın 👇'
        : language === 'ar'
        ? '📊 في هذه المحادثة، يمكنك فقط طرح أسئلة حول خطوات لوحة التحكم. لبدء خدمة جديدة، يرجى إنشاء محادثة جديدة 👇'
        : language === 'tk'
        ? '📊 Bu söhbetdeşlikde diňe dolandyryş paneli ädimleri barada sorag berip bilersiňiz. Täze hyzmat üçin täze söhbetdeşlik başlaň 👇'
        : '📊 You can only ask about the steps in this chat. To start a new service, please **create a new chat** 👇';
      const blockId = msgIdRef.current++;
      setVisibleChars(prev => ({ ...prev, [blockId]: 0 }));
      setMsgs(p => [...p, { id: blockId, role: 'assistant', content: blockMsg }]);
      let chars = 0;
      const iv = setInterval(() => {
        chars += 20;
        setVisibleChars(prev => ({ ...prev, [blockId]: chars }));
        if (chars >= blockMsg.length) clearInterval(iv);
      }, 30);
      return;
    }

    // Guest message limit logic
    if (!isAuthenticated) {
      const newCount = guestMsgCount + 1;
      setGuestMsgCount(newCount);
      localStorage.setItem('guest_msg_count_v3', newCount.toString());

      if (newCount > 10) {
        setIsLoginModalOpen(true);
        setInput(q); // Restore input so they don't lose it
        setBusy(false);
        return;
      }
    }
    if (user?.subscriptionStatus === 'free' && (user.tokenBalance ?? 0) <= 0) {
      setShowQuotaWarning(true);
      // We don't have the refresh time locally here easily without a previous 403, 
      // but we can just show the generic message.
      return;
    }

    setBusy(true);
    if (!sessionTitle && msgs.length === 0) {
      setSessionTitle(q.length > 35 ? q.slice(0, 32) + '...' : q || "Document Analysis");
    }

    // The row is created here, on the first real message, not at page load.
    // setSessionId is async, so the returned id — not the state — is what the
    // request must carry.
    const activeSessionId = await ensureSession();
    if (!activeSessionId) {
      setBusy(false);
      setMsgs(p => [...p, {
        id: msgIdRef.current++,
        role: 'assistant',
        content: '⚠️ Could not start the conversation. Please check your connection and try again.',
      }]);
      return;
    }

    const currentFile = file;
    setFile(null);

    try {
      let body;
      let headers: HeadersInit = {};

      if (currentFile) {
        const formData = new FormData();
        formData.append('query', q);
        formData.append('language', language);
        formData.append('session_id', activeSessionId);
        if (token) formData.append('token', token);
        formData.append('file', currentFile);
        formData.append('assistant_type', assistantType);
        // Attaching a file used to silently strip all of these, so uploading
        // dropped the conversation history and re-asked an already-confirmed
        // credit prompt. Multipart values are strings, hence the String().
        formData.append('is_step_query', String(isStepQuery));
        formData.append('is_voice', String(spokenTurn));
        // Spoken turns are filed as a transcript when the call ends, not as
        // thread messages. /agent/query already honours this flag.
        formData.append('save_history', String(!spokenTurn));
        formData.append('confirm_credit', String(confirmCredit));
        formData.append('history', JSON.stringify(msgs.map(m => ({ role: m.role, content: m.content }))));
        body = formData;
        // Browser sets Content-Type multipart/form-data boundary automatically
      } else {
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          query: q,
          language,
          context: { session_id: activeSessionId },
          assistant_type: assistantType,
          is_step_query: isStepQuery,
          // Spoken replies must be plain text and much shorter — the server
          // swaps in a voice-specific style when this is set.
          is_voice: spokenTurn,
          // Spoken turns are filed as a transcript when the call ends, not as
          // thread messages. /agent/query already honours this flag.
          save_history: !spokenTurn,
          confirm_credit: confirmCredit,
          history: msgs.map(m => ({ role: m.role, content: m.content }))
        });
      }

      // Create abort controller for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const res = await apiFetch(`/agent/query`, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (res?.status === 403) {
        const errorData = await res.json();
        const detail = errorData.detail || "";
        const [title, refreshTime] = detail.includes('|') ? detail.split('|') : ["Model quota reached", "shortly"];

        setQuotaRefreshTime(refreshTime);
        setShowQuotaWarning(true);
        setBusy(false);
        return;
      }

      if (res?.status === 429) {
        setMsgs(p => [...p, {
          id: msgIdRef.current++,
          role: 'assistant',
          content: "⚠️ **Too many requests.**\n\nYou're sending messages too fast. Please wait a moment before trying again."
        }]);
        setBusy(false);
        return;
      }

      if (res?.status === 503) {
        const errorData = await res.json().catch(() => ({}));
        setMsgs(p => [...p, {
          id: msgIdRef.current++,
          role: 'assistant',
          content: `⚠️ ${errorData.detail || 'The assistant is not available right now.'}`
        }]);
        setBusy(false);
        return;
      }

      // A roadmap costs one service credit. The server built nothing and
      // charged nothing — it is asking first. Show the prompt and stop here;
      // confirming re-sends the same message with confirm_credit set.
      if (res?.status === 402) {
        const data = await res.json().catch(() => ({}));
        if (data?.confirm_required) {
          presentCreditPrompt(data.confirm_required, q);
          setBusy(false);
          return;
        }
      }

      if (!res || !res.ok) throw new Error();

      // ── Stream the reply in as it is generated ──────────────────────────────
      const assistantMsgId = msgIdRef.current++;
      setMsgs(p => [...p, { id: assistantMsgId, role: 'assistant', content: '', voice: spokenTurn }]);
      // Streamed text is revealed as it arrives, so the reveal counter is maxed
      // out rather than animated by a timer.
      setVisibleChars(prev => ({ ...prev, [assistantMsgId]: Number.MAX_SAFE_INTEGER }));

      let roadmap: Record<string, unknown> | null = null;
      let streamError: string | null = null;

      const rawContent = await readAgentStream(res, {
        onConfirmRequired: pending => {
          presentCreditPrompt(pending, q);
        },
        onDocumentChecklist: seed => {
          setChecklists(prev => ({ ...prev, [assistantMsgId]: seed }));
        },
        onVisaIntake: state => {
          setVisaIntake(state);
          setVisaIntakeMsgId(assistantMsgId);
        },
        onAttachment: attachment => {
          setMsgs(p => p.map(m => (
            m.id === assistantMsgId
              ? { ...m, attachment: { id: attachment.documentId, filename: attachment.filename } }
              : m
          )));
        },
        onMeta: meta => {
          console.log(`%c[Data Message Source] %c${meta.source ?? 'Unknown'}`, "color: #3b82f6; font-weight: bold", "color: inherit", { assistant: assistantType, session: sessionId });
          if (meta.token_balance !== undefined && meta.token_balance !== null) {
            setTokenBalance(meta.token_balance);
          }
          if (meta.session_title && meta.session_title !== sessionTitle) {
            setSessionTitle(meta.session_title);
            setSidebarRefresh(prev => prev + 1);
          }
        },
        onDelta: chunk => {
          setMsgs(p => p.map(m => (m.id === assistantMsgId ? { ...m, content: m.content + chunk } : m)));
        },
        onDashboard: state => { roadmap = state; },
        onError: detail => { streamError = detail; },
      });

      if (streamError && !rawContent.trim()) {
        setMsgs(p => p.map(m => (m.id === assistantMsgId ? { ...m, content: `⚠️ ${streamError}` } : m)));
        setBusy(false);
        return;
      }

      // Auto-speak if it was a voice query or we are in call mode
      if (isVoiceMode || isFromVoice || wasListening) {
        // The agent ends the call itself once it knows which service the
        // caller needs — that is the whole job of the call. The token is
        // stripped before speaking, so the caller hears the closing line and
        // not the marker, then the line drops on its own. A call that will not
        // hang up is the thing people dislike most about phone support.
        const done = /\[CALL_COMPLETE\]/i.test(rawContent);

        // Hang up when the closing line has actually finished, not on a timer.
        // It used to drop 3.2s after the reply arrived, which was fine when a
        // sentence was spoken locally and instant; now the line is fetched and
        // a goodbye of any length runs well past 3.2s, so the caller heard
        // their own call cut off mid-word. A backstop still guarantees the
        // line drops even if playback stalls — a call that will not hang up is
        // worse than one that hangs up early.
        let dropped = false;
        const dropLine = () => {
          if (dropped) return;
          dropped = true;
          hangUpCall();
        };

        speak(
          rawContent.replace(/\[CALL_COMPLETE\]/gi, '').trim(),
          done && isVoiceMode ? dropLine : undefined,
        );
        if (done && isVoiceMode) setTimeout(dropLine, 45000);
        setVoiceTranscript("");
        if (done && isVoiceMode) {
          voiceLoopRef.current = false;           // stop re-opening the mic
          try { recognitionRef.current?.stop(); } catch { }
          setIsListening(false);
        }
      }

      // Roadmap ready — show the summary, then open the Dashboard after 3 seconds.
      if (roadmap) {
        setHasDashboard(true);
        try {
          localStorage.setItem('permitops_active_session_id', activeSessionId);
          localStorage.setItem('permitops_assistant_type', assistantType);
          // Guests/offline read the workflow from localStorage on the dashboard.
          localStorage.setItem('permitops_guest_workflow', JSON.stringify(roadmap));
          localStorage.setItem('permitops_workflow_update', Date.now().toString());
          window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
        } catch { /* ignore storage errors */ }
        setTimeout(() => {
          setFetchingRoadmap(true);
          router.push('/applications');
        }, 3000);
      }
    } catch {
      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: "⚠️ Backend is currently offline. Please make sure the server is running." }]);
    } finally {
      setBusy(false);
    }
  };

  const cancelResponse = () => {
    // Abort in-flight fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Stop typewriter
    if (typewriterIntervalRef.current) {
      clearInterval(typewriterIntervalRef.current);
      typewriterIntervalRef.current = null;
    }
    // Append cancelled notice to last assistant message (or add new one)
    setMsgs(prev => {
      const lastAssistant = [...prev].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        return prev.map(m =>
          m.id === lastAssistant.id
            ? { ...m, content: m.content.trim() + '\n\n*Response cancelled.*' }
            : m
        );
      }
      return [...prev, { id: msgIdRef.current++, role: 'assistant', content: '*Response cancelled.*' }];
    });
    // Show full content of last message (stop typewriter clipping)
    setVisibleChars(prev => {
      const updated = { ...prev };
      Object.keys(updated).forEach(k => { updated[Number(k)] = 999999; });
      return updated;
    });
    setBusy(false);
  };

  const clearChat = async () => {
    if (isAuthenticated && token && sessionId) {
      try {
        await apiFetch(`/chat/history/${sessionId}`, { method: 'DELETE' });
        setSessionId(null);
      } catch (e) {
        console.error("Failed to clear history on backend", e);
      }
    } else {
      localStorage.removeItem('permitops_chat_history');
      setMsgs([]);
      msgIdRef.current = 1;
    }
  };

  const isEmpty = msgs.length === 0;

  if (!isLoaded || switchingAgent || fetchingRoadmap) return <LoadingScreen agentType={assistantType} branded={false} />;

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)] transition-colors duration-500">
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingWizard
            onDismiss={(remember) => {
              if (remember) localStorage.setItem('turkgateway_onboarding_done', 'true');
              setShowOnboarding(false);
            }}
          />
        )}
      </AnimatePresence>


      {/* Dynamic Background — uses CSS vars so it auto-adapts to dark mode */}
      <div className="absolute inset-0 bg-[var(--bg)] pointer-events-none transition-colors duration-500" />
      <Sidebar
        currentSessionId={sessionId}
        assistantType={assistantType}
        onSessionSelect={(id, title) => { setSessionId(id); setSessionTitle(title); setHasDashboard(false); setMsgs([]); }}
        onNewChat={() => handleNewChat()}
        onDeleteSession={handleDeleteSession}
        onToggleFavorite={handleToggleFavorite}
        token={token}
        onSwitchAssistant={switchAssistant}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        refreshTrigger={sidebarRefresh}
      />

      <main className={`flex-1 flex flex-col min-w-0 transition-colors duration-300 relative border-[var(--border)] ${isRTL ? 'border-r' : 'border-l'}`}>
        {/* Desktop Navbar with Agent Selector */}
        <div className="hidden md:block">
          <Navbar
            isAppPage
            extraContent={
              <div className="relative" ref={dropdownRef}>
                <div
                  className={`flex items-center gap-1.5 cursor-pointer px-3 py-1.5 rounded-full transition-all border glass-mesh shadow-lg group hover:scale-[1.02] active:scale-95 ${assistantType === 'student' ? 'border-emerald-500/20 mesh-green shadow-emerald-500/10' :
                    assistantType === 'lawyer' ? 'border-amber-500/20 mesh-amber shadow-amber-500/10' :
                      'border-blue-500/20 mesh-blue shadow-blue-500/10'
                    }`}
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <div className="relative flex items-center justify-center">
                    <Cpu size={12} className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      }`} />
                    <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${assistantType === 'student' ? 'bg-emerald-500/30' :
                      assistantType === 'lawyer' ? 'bg-amber-500/30' :
                        'bg-blue-500/30'
                      }`} />
                  </div>
                  <span className={`font-black uppercase tracking-[0.1em] ${assistantType === 'student' ? 'text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-500' :
                      'text-blue-500'
                    }`} style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>
                    {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
                  </span>
                  <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''} ${assistantType === 'student' ? 'text-emerald-400 group-hover:text-emerald-500' :
                    assistantType === 'lawyer' ? 'text-amber-400 group-hover:text-amber-500' :
                      'text-blue-400 group-hover:text-blue-500'
                    }`} />
                </div>

                <AnimatePresence mode="wait">
                  {isDropdownOpen && (
                    <motion.div
                      key="desktop-dropdown"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 bg-[var(--surface)]/90 border border-white/10 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.3)] z-[100] overflow-hidden backdrop-blur-2xl"
                    >
                      <div className="p-2 space-y-1">
                        <div className="px-3 py-1.5 mb-2 text-[10px] font-bold text-[var(--muted)] opacity-50 uppercase tracking-widest border-b border-white/5">
                          Switch Assistant
                        </div>
                        <button
                          onClick={() => switchAssistant('permit')}
                          disabled={isAgentDisabled('permit')}
                          title={isAgentDisabled('permit') ? t('agent_disabled_note') : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${isAgentDisabled('permit') ? 'opacity-40 cursor-not-allowed text-[var(--muted)] border border-transparent' : assistantType === 'permit' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'permit' && !isAgentDisabled('permit') ? 'bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'permit' && !isAgentDisabled('permit') ? 'text-white' : 'text-blue-500'}`} />
                            {assistantType === 'permit' && !isAgentDisabled('permit') && <div className="absolute inset-0 bg-blue-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_permit')}</span>
                          {isAgentDisabled('permit') && (
                            <span className="ml-auto text-[9px] font-black uppercase tracking-widest opacity-70">{t('services_status_disabled')}</span>
                          )}
                        </button>
                        <button
                          onClick={() => switchAssistant('student')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500'}`} />
                            {assistantType === 'student' && <div className="absolute inset-0 bg-emerald-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_student')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('lawyer')}
                          disabled={isAgentDisabled('lawyer')}
                          title={isAgentDisabled('lawyer') ? t('agent_disabled_note') : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${isAgentDisabled('lawyer') ? 'opacity-40 cursor-not-allowed text-[var(--muted)] border border-transparent' : assistantType === 'lawyer' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${assistantType === 'lawyer' && !isAgentDisabled('lawyer') ? 'bg-amber-500 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20'
                            }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'lawyer' && !isAgentDisabled('lawyer') ? 'text-white' : 'text-amber-500'}`} />
                            {assistantType === 'lawyer' && !isAgentDisabled('lawyer') && <div className="absolute inset-0 bg-amber-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_lawyer')}</span>
                          {isAgentDisabled('lawyer') && (
                            <span className="ml-auto text-[9px] font-black uppercase tracking-widest opacity-70">{t('services_status_disabled')}</span>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </div>

        {/* Mobile Top Bar — Ultra-clean agent selection overlay */}
        <div className="flex md:hidden items-center justify-between px-5 h-16 shrink-0 bg-[var(--bg)]/80 backdrop-blur-xl border-b border-white/5 z-[60]">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[var(--text)] active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>

          <div
            className="flex flex-col items-center justify-center cursor-pointer group"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border active:scale-95 transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
              assistantType === 'lawyer' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' :
                'bg-blue-500/10 border-blue-500/20 text-blue-500'
              }`}>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
              </span>
              <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {isAuthenticated && user?.subscriptionStatus !== 'free' && (
              <span className="text-[10px] font-black text-emerald-500 mt-0.5 tracking-widest uppercase">
                PREMIUM
              </span>
            )}

          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[13px] font-bold shadow-lg shadow-indigo-500/20">
                {(user.fullName || user.email || 'U')[0].toUpperCase()}
              </div>
            ) : (
              <Link href="/login" className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                <User size={16} className="text-[var(--text)]" />
              </Link>
            )}
          </div>
        </div>

        <div className="hidden md:block h-0 shrink-0" />

        {/* Conversation title — sits directly under the agent badge.
            It used to carry up to 64px of top padding (pt-8 md:pt-12 xl:pt-16),
            which pushed the transcript down far enough that replies were cut
            off after a couple of messages. The title is one line; it does not
            need a band of its own. */}
        <div className="flex flex-col items-center justify-center pt-2 pb-2 md:pt-3 md:pb-2.5 shrink-0 z-30 relative px-4 text-center">
          <span className="font-bold text-[var(--text)] opacity-95 tracking-tight leading-tight" style={{ fontSize: 'clamp(15px, 1.3vw, 19px)' }}>
            {(() => {
              if (!sessionTitle || msgs.length === 0 || sessionTitle === t('chat_new')) return t('chat_new');
              const match = sessionTitle.toLowerCase().match(/^(.+?)\s+in\s+(.+)$/);
              if (match) {
                const bizKey = `biz_${match[1].trim()}`;
                const distKey = `dist_${match[2].trim().replace(/\s/g, '').toLowerCase()}`;
                const lb = t(bizKey), ld = t(distKey);
                if (lb !== bizKey && ld !== distKey) return `${lb} ${t('connect_in')} ${ld}`;
              }
              return sessionTitle;
            })()}
          </span>
        </div>

        {/* Agent Selection Dropdown — renders on both mobile & desktop */}
        <AnimatePresence mode="wait">
          {isDropdownOpen && (
            <motion.div key="mobile-dropdown-wrapper">
              {/* Backdrop Blur */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-md z-[90]"
                onClick={() => setIsDropdownOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: 20 }}
                className="fixed top-24 md:top-28 left-1/2 -translate-x-1/2 bg-[var(--surface-1)]/98 border border-white/10 rounded-[32px] shadow-[0_40px_100px_rgba(0,0,0,0.7)] p-4 w-[90vw] max-w-[360px] z-[100] flex flex-col gap-3 overflow-hidden backdrop-blur-3xl"
              >
                <div className="px-5 py-2.5 border-b border-white/5 mb-2 text-center font-black uppercase tracking-[0.2em] text-[12px] text-[var(--text)] opacity-40">
                  {t('chat_switch_assistant')}
                </div>

                <div className="flex flex-col gap-2.5 md:gap-3 px-2">
                  <button
                    onClick={() => switchAssistant('permit')}
                    disabled={isAgentDisabled('permit')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${isAgentDisabled('permit') ? 'bg-[var(--surface-2)] border border-[var(--border)] opacity-40 cursor-not-allowed' : assistantType === 'permit' ? 'bg-blue-500/10 border border-blue-500/30 shadow-[0_8px_30px_rgba(59,130,246,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-blue-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'permit' && !isAgentDisabled('permit') ? 'bg-blue-500 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'permit' && !isAgentDisabled('permit') ? 'text-white' : 'text-blue-500'}`} />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_permit')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">
                        {isAgentDisabled('permit') ? t('agent_disabled_note') : t('chat_permit_desc')}
                      </span>
                    </div>
                    {isAgentDisabled('permit')
                      ? <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-[var(--muted)]">{t('services_status_disabled')}</span>
                      : assistantType === 'permit' && <div className="ml-auto w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'student' ? 'bg-emerald-500/10 border border-emerald-500/30 shadow-[0_8px_30px_rgba(16,185,129,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-emerald-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:border-emerald-400'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500 group-hover:text-white'}`} />
                      {(assistantType === 'student' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'student' ? 'bg-emerald-400' : 'bg-emerald-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_student')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    disabled={isAgentDisabled('lawyer')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${isAgentDisabled('lawyer') ? 'bg-[var(--surface-2)] border border-[var(--border)] opacity-40 cursor-not-allowed' : assistantType === 'lawyer' ? 'bg-amber-500/10 border border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-amber-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${assistantType === 'lawyer' && !isAgentDisabled('lawyer') ? 'bg-amber-500 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20'
                      }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'lawyer' && !isAgentDisabled('lawyer') ? 'text-white' : 'text-amber-500'}`} />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_lawyer')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">
                        {isAgentDisabled('lawyer') ? t('agent_disabled_note') : t('chat_lawyer_desc')}
                      </span>
                    </div>
                    {isAgentDisabled('lawyer')
                      ? <span className="ml-auto text-[9px] font-black uppercase tracking-widest text-[var(--muted)]">{t('services_status_disabled')}</span>
                      : assistantType === 'lawyer' && <div className="ml-auto w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_#f59e0b]" />}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">

          {isEmpty ? (
            <div className="flex-1 flex flex-col max-w-4xl xl:max-w-5xl mx-auto w-full px-5 md:px-6 xl:px-10 overflow-y-auto no-scrollbar">
              <div className="my-auto flex flex-col w-full shrink-0 pt-2 pb-8">
              {/* Welcome Message — Cinematic AI Entrance */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="flex flex-col items-center justify-center text-center px-4 pt-0 md:pt-2 mb-2 md:mb-4 xl:mb-10"
              >
                <div className="relative mb-4 md:mb-4">
                  {/* Holographic scanning grid area */}
                  <div className="absolute inset-[-60px] rounded-full overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute inset-0" style={{
                      backgroundImage: `radial-gradient(circle, ${assistantType === 'student' ? 'rgba(16,185,129,0.4)' :
                        assistantType === 'lawyer' ? 'rgba(245,158,11,0.4)' :
                          'rgba(59,130,246,0.4)'
                        } 1px, transparent 1px)`,
                      backgroundSize: '16px 16px'
                    }} />
                  </div>

                  {/* Primary holographic ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      rotate: { duration: 12, repeat: Infinity, ease: "linear" },
                      scale: { duration: 4, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-15px] md:inset-[-25px] rounded-[35%] border-[1.5px] border-dashed border-red-500/40 blur-[1px]"
                  />

                  {/* Counter-rotating technical ring */}
                  <motion.div
                    animate={{
                      rotate: -360,
                      scale: [1.1, 1, 1.1],
                    }}
                    transition={{
                      rotate: { duration: 18, repeat: Infinity, ease: "linear" },
                      scale: { duration: 5, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-25px] md:inset-[-40px] rounded-full border-t border-b border-red-500/20"
                  />

                  {/* Floating technical particles (Orbital Swarm) */}
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        x: [
                          Math.cos(i * 30) * 50,
                          Math.cos(i * 30 + 120) * 70,
                          Math.cos(i * 30 + 240) * 50,
                          Math.cos(i * 30) * 50
                        ],
                        y: [
                          Math.sin(i * 30) * 50,
                          Math.sin(i * 30 + 120) * 70,
                          Math.sin(i * 30 + 240) * 50,
                          Math.sin(i * 30) * 50
                        ],
                        opacity: [0, 0.7, 0.3, 0.7, 0],
                        scale: [0, 1.2, 0.8, 1.2, 0]
                      }}
                      transition={{
                        duration: 5 + (i * 0.7),
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className={`absolute rounded-full blur-[0.4px] pointer-events-none ${i % 4 === 0 ? 'bg-white w-0.5 h-0.5' :
                        assistantType === 'student' ? 'bg-emerald-400/60 w-1 h-1 shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                          assistantType === 'lawyer' ? 'bg-amber-400/60 w-1 h-1 shadow-[0_0_5px_rgba(245,158,11,0.5)]' :
                            'bg-blue-400/60 w-1 h-1 shadow-[0_0_5px_rgba(59,130,246,0.5)]'
                        }`}
                    />
                  ))}

                  {/* Outer breathing aura */}
                  <motion.div
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 0.6, 0.3]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    className={`absolute inset-[-60px] rounded-full blur-[80px] ${assistantType === 'student' ? 'bg-emerald-600/10' :
                      assistantType === 'lawyer' ? 'bg-amber-600/10' :
                        'bg-blue-600/10'
                      }`}
                  />



                  {/* The Chip Unit */}
                  <motion.div
                    whileHover={{
                      scale: 1.05,
                      rotateY: 10,
                      rotateX: -10,
                      boxShadow: assistantType === 'student' ? '0 0 70px rgba(16,185,129,0.7)' :
                        assistantType === 'lawyer' ? '0 0 70px rgba(245,158,11,0.7)' :
                          '0 0 70px rgba(59,130,246,0.7)'
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className={`relative h-14 w-14 md:h-16 md:w-16 xl:h-24 xl:w-24 rounded-xl md:rounded-2xl xl:rounded-3xl flex items-center justify-center overflow-hidden border ${assistantType === 'student' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-[0_0_50px_rgba(16,185,129,0.5)] border-emerald-400/40' :
                      assistantType === 'lawyer' ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_0_50px_rgba(245,158,11,0.5)] border-amber-400/40' :
                        'bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_0_50px_rgba(59,130,246,0.5)] border-blue-400/40'
                      }`}
                    style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
                  >
                    {/* Active Interior Scanning Bar */}
                    <motion.div
                      animate={{ y: ['-140%', '140%'] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-[3px] bg-white/30 blur-[1px] shadow-[0_0_15px_white] z-20"
                    />

                    <motion.div
                      animate={{
                        filter: ['drop-shadow(0 0 8px rgba(255,255,255,0.4))', 'drop-shadow(0 0 20px rgba(255,255,255,0.9))', 'drop-shadow(0 0 8px rgba(255,255,255,0.4))']
                      }}
                      style={{ transform: 'translateZ(20px)' }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Cpu size={isMobile ? 24 : 32} className="text-white xl:!w-12 xl:!h-12" />
                    </motion.div>

                    {/* Scanning light streak */}
                    <motion.div
                      animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-24"
                    />
                  </motion.div>
                </div>

                <div className="flex flex-col items-center gap-1 mb-2">

                  {isAuthenticated && user?.subscriptionStatus === 'free' && (
                    <motion.div
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.3, duration: 0.5 }}
                      onClick={() => router.push('/pricing')}
                      className="cursor-pointer mb-2 md:mb-2 inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-blue-500/5 border border-blue-500/20 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all shadow-sm group"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-blue-400/90 tracking-wide uppercase">
                          {(user.tokenBalance ?? 0) === 0 ? 'ZERO' : (user.tokenBalance ?? 0)} {t('tokens_unit') || 'Tokens'}
                        </span>
                        <span className="opacity-30 text-white text-[10px]">|</span>
                        <span className="text-[13px] font-medium text-[var(--muted)] group-hover:text-blue-400 transition-colors">
                          {(user.tokenBalance ?? 0) <= 0 ? `${t('quota_refresh_msg')} ${getRefreshTimeLabel()}` : (t('sidebar_upgrade') || 'Upgrade')}
                        </span>
                      </div>
                      <ArrowRight size={14} className="text-blue-500 group-hover:translate-x-1 transition-transform" />
                    </motion.div>
                  )}

                  <div className="flex flex-col items-center text-center">
                    <motion.span
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      transition={{ delay: 0.4, duration: 0.5 }}
                      className="text-2xl md:text-3xl xl:text-5xl font-bold tracking-tighter text-[var(--text)] mb-1"
                    >
                      {t('chat_greeting').replace('{name}', user?.fullName || (user?.email ? user.email.split('@')[0] : 'there'))}
                    </motion.span>
                    <motion.h1
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5, duration: 0.5 }}
                      className="text-lg md:text-xl xl:text-2xl xl:mt-1 font-medium tracking-tight text-[var(--muted)]"
                    >
                      {t('chat_begin') || "How can I help you today?"}
                    </motion.h1>
                  </div>
                </div>

                {/* Suggestion Chips — Premium Grid */}
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                  className="grid grid-cols-2 lg:grid lg:grid-cols-3 xl:grid-cols-3 gap-2 md:gap-2 xl:gap-5 mt-4 md:mt-0 md:mb-2 xl:mt-8"
                >
                  {(assistantType === 'student' ? [
                    { emoji: "🏛️", label: "University Registration", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🪪", label: "ID / İkamet", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "📜", label: "Denklik (Equivalency)", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🛏️", label: "Dormitory & Housing", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "✈️", label: "Student Visa", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' },
                    { emoji: "🚌", label: "IstanbulKart", mesh: 'mesh-green', color: 'text-emerald-500', border: 'hover:border-emerald-400 hover:shadow-emerald-500/20 hover:bg-emerald-500/5' }
                  ] : assistantType === 'lawyer' ? [
                    { emoji: "🏗️", label: "Company Formation", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "📑", label: "Contract Review", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🤝", label: "Employment Law", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "⚖️", label: "Legal Disputes", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🏠", label: "Residency & Visas", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🏢", label: "Real Estate Law", mesh: 'mesh-amber', color: 'text-amber-500', border: 'hover:border-amber-400 hover:shadow-amber-500/20 hover:bg-amber-500/5' },
                    { emoji: "🚨", label: "Criminal Defense", mesh: 'mesh-red', color: 'text-red-500', border: 'hover:border-red-400 hover:shadow-red-500/20 hover:bg-red-500/5' }
                  ] : [
                    { emoji: "☕", label: "Cafe & Restaurant", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🛍️", label: "Retail Shop", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "💻", label: "Office & Tech", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🏥", label: "Pharmacy", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🩺", label: "Clinic", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' },
                    { emoji: "🏠", label: "Residence Permit", mesh: 'mesh-blue', color: 'text-blue-500', border: 'hover:border-blue-400 hover:shadow-blue-500/20 hover:bg-blue-500/5' }
                  ]).map((chip, i) => (
                    <div
                      key={i}
                      onClick={() => startService(chip.label)}
                      className={`lg:glass-mesh lg:${chip.mesh} text-[var(--text)] text-[11px] md:text-[13px] xl:text-[15px] py-1.5 md:py-2 xl:py-4 px-2.5 md:px-3 xl:px-5 rounded-[16px] md:rounded-[16px] xl:rounded-[20px] flex items-center gap-2 md:gap-2 xl:gap-3 font-bold select-none md:backdrop-blur-xl transition-all hover:scale-[1.02] md:hover:scale-105 active:scale-95 cursor-pointer border border-[var(--border)] bg-[var(--surface-2)] lg:bg-[var(--surface)] lg:opacity-95 lg:shadow-[0_8px_30px_rgba(0,0,0,0.12)] group w-full h-[48px] md:h-[48px] xl:h-[72px] ${chip.border}`}
                    >
                      <div className={`w-7 h-7 md:w-8 md:h-8 xl:w-11 xl:h-11 rounded-[10px] xl:rounded-[14px] bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center shrink-0 group-hover:bg-[var(--surface)] transition-colors ${chip.color.replace('text', 'bg')}/10`}>
                        <span className="text-sm md:text-base xl:text-xl filter drop-shadow-sm">{chip.emoji}</span>
                      </div>
                      <span className="flex-1 min-w-0 leading-tight text-left line-clamp-2">{t(CHIP_I18N_KEY[chip.label] ?? chip.label) || chip.label}</span>
                    </div>
                  ))}
                </motion.div>

                {/* Spacer to absorb vertical height and avoid mt-auto scroll bugs */}
                <div className="flex-1 min-h-[16px]" />

                {/* Chat Input Pill (empty state) */}
                <div className="w-full max-w-3xl xl:max-w-4xl mx-auto mb-2 md:mb-4 xl:mb-8 px-4 shrink-0">
                  <AnimatePresence>
                    {showTextInput && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
                        animate={{ opacity: 1, y: 0, scaleY: 1 }}
                        exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
                        transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{ originY: 'bottom' }}
                      >
                  <div className="relative flex items-center gap-1 rounded-[28px] py-1 pl-2 pr-1.5 border border-[var(--border)]/70 bg-[var(--surface-1)] shadow-[0_2px_10px_rgba(0,0,0,0.06)] focus-within:shadow-[0_4px_18px_rgba(0,0,0,0.10)] transition-shadow">
                    {/* Dictation bar. Sits over the composer rather than replacing its
                        children, so the text already typed is untouched underneath and
                        comes back exactly as it was if the recording is cancelled. */}
                    {(isDictating || isTranscribing) && (
                      <div className="absolute inset-0 z-10 flex items-center gap-2 rounded-[28px] bg-[var(--surface-1)] pl-2 pr-1.5">
                        {isTranscribing ? (
                          <div className="flex flex-1 items-center gap-2 px-2 text-[13px] text-[var(--muted)]">
                            <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--muted)]/30 border-t-[var(--muted)] animate-spin" />
                            <span>{t('chat_transcribing') || 'Transcribing…'}</span>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={cancelDictation}
                              aria-label={t('chat_dictation_cancel') || 'Cancel dictation'}
                              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors active:scale-95"
                            >
                              <X size={16} />
                            </button>
                        
                            {/* Live level meter. Newest sample on the right, so it reads as
                                moving forward the way every recorder people know does. */}
                            <div className="flex h-9 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden>
                              {dictationLevels.map((lvl, i) => (
                                <span
                                  key={i}
                                  className="w-[3px] shrink-0 rounded-full bg-[var(--muted)]/70"
                                  style={{ height: `${Math.max(3, Math.round(lvl * 26))}px` }}
                                />
                              ))}
                            </div>
                        
                            {/* Stop: the words land in the box to be read before sending. */}
                            <button
                              onClick={() => finishDictation(false)}
                              aria-label={t('chat_dictation_stop') || 'Stop and insert text'}
                              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors active:scale-95"
                            >
                              <span className="block h-[13px] w-[13px] rounded-[3px] bg-current" />
                            </button>
                        
                            {/* Stop and send, for when they already know what they said. */}
                            <button
                              onClick={() => finishDictation(true)}
                              aria-label={t('chat_dictation_send') || 'Stop and send'}
                              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-[#2f7bf6] text-white hover:bg-[#2569db] transition-colors active:scale-95"
                            >
                              <ArrowUp size={19} />
                            </button>
                          </>
                        )}
                      </div>
                    )}

                    <input
                      type="file"
                      ref={fileInputRef}
                      accept={ACCEPTED_UPLOAD_TYPES}
                      onChange={(e) => {
                        const picked = e.target.files?.[0];
                        e.target.value = '';
                        if (picked) pickFile(picked);
                      }}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="hidden sm:flex p-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0"
                    >
                      <Plus size={22} />
                    </button>

                    {showTextInput ? (
                      <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => {
                          setInput(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                        }}
                        placeholder={t(`chat_placeholder_${assistantType}`) || "Message TurkGateWay..."}
                        className="flex-1 bg-transparent py-3 px-3 text-[16px] text-[var(--text)] focus:outline-none resize-none overflow-y-auto min-h-[44px] max-h-[120px] slim-scroll placeholder:text-gray-400"
                        rows={1}
                        autoFocus
                      />
                    ) : (
                      <button
                        onClick={() => setShowTextInput(true)}
                        className="flex-1 flex items-center gap-2.5 py-3 px-3 text-[14px] text-[var(--muted)]/40 hover:text-[var(--muted)]/80 transition-colors group"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                        <span>{t(`chat_placeholder_${assistantType}`) || "Or type your message..."}</span>
                      </button>
                    )}

                    {/* Right cluster: a plain mic, then one round action button.
                        The action button is the only control that changes meaning —
                        an arrow to send when there is text, a waveform to start voice
                        when there is not — so there is never a question about which
                        button does what. */}
                    <div className="flex items-center gap-1 pr-1 shrink-0">
                      {!busy && (
                        <button
                          onClick={startDictation}
                          aria-label={isDictating ? (t('chat_dictation_stop') || 'Recording') : (t('chat_dictate') || 'Dictate a message')}
                          className={`h-9 w-9 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                            isDictating
                              ? 'text-red-500'
                              : 'text-[var(--muted)] hover:text-[var(--text)]'
                          }`}
                        >
                          <Mic size={19} className={isDictating ? 'animate-pulse' : ''} />
                        </button>
                      )}
                    
                      {busy ? (
                        <button
                          onClick={cancelResponse}
                          aria-label="Cancel"
                          className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-red-500 hover:text-white transition-all shrink-0 active:scale-95"
                        >
                          <X size={17} />
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (input.trim()) {
                              send();
                              if (inputRef.current) inputRef.current.style.height = 'auto';
                            } else {
                              toggleVoice();
                            }
                          }}
                          aria-label={input.trim() ? 'Send' : (t('chat_voice') || 'Voice')}
                          className={`h-9 w-9 flex items-center justify-center rounded-full text-white shadow-sm transition-all shrink-0 active:scale-95 ${
                            isListening ? 'bg-red-500' : 'bg-[#2f7bf6] hover:bg-[#2569db]'
                          }`}
                        >
                          {input.trim() ? <ArrowUp size={19} /> : <AudioLines size={19} />}
                        </button>
                      )}
                    </div>

                    {file && (
                      <div className="absolute -top-12 left-4">
                        <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                          <FileText size={12} className="text-indigo-400" />
                          <span className="truncate max-w-[120px]">{file.name}</span>
                          <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                            <Plus size={12} className="rotate-45" />
                          </button>
                        </div>
                      </div>
                    )}

                    {uploadError && (
                      <div className="absolute -top-12 left-4">
                        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/40 rounded-full px-3 py-1.5 text-[12px] text-red-400 shadow-sm">
                          <span className="truncate max-w-[280px]">{uploadError}</span>
                          <button onClick={() => setUploadError(null)} className="ml-1 hover:text-red-300 transition-colors">
                            <Plus size={12} className="rotate-45" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
              </div> {/* Close my-auto wrapper */}
            </div>
          ) : (
            <div className={`flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 pt-3 pb-40 space-y-8 slim-scroll bg-[var(--bg)]/40 rounded-t-[40px]`} dir={isRTL ? 'rtl' : 'ltr'}>
              <AnimatePresence initial={false}>
                {/* Spoken turns stay out of the thread: they live in msgs only
                    for the model's context and the call overlay, and are traded
                    for a single transcript line when the call ends. */}
                {msgs.filter(m => !m.voice).filter(m => m.role !== 'assistant' || m.content).map(m => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 16, filter: 'blur(8px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
                    className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className={`group relative h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 mt-1 shadow-md border ${assistantType === 'student' ? 'from-emerald-500 to-emerald-600 shadow-emerald-500/30 border-emerald-400/30' :
                        assistantType === 'lawyer' ? 'from-amber-500 to-amber-600 shadow-amber-500/30 border-amber-400/30' :
                          'from-blue-500 to-blue-600 shadow-blue-500/30 border-blue-400/30'
                        } ${isRTL ? 'ml-4' : 'mr-4'} transition-all cursor-pointer`}
                        onClick={() => speak(translateHistory(m.content))}
                      >
                        <Cpu size={18} className="group-hover:opacity-0 transition-opacity" />
                        <Volume2 size={16} className="absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}

                    <div className={`flex flex-col max-w-[92%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[17px] leading-[1.75] whitespace-pre-wrap ${m.role === 'user'
                        ? 'px-5 py-3 rounded-2xl border border-[var(--border)] text-[var(--text)] bg-[var(--surface-1)] shadow-sm'
                        : `text-[var(--text)] px-6 py-4 rounded-3xl bg-[var(--surface-2)]/30 border border-[var(--border)] w-full font-normal`
                        }`}
                      >
                        {(() => {
                          const contentToRender = translateHistory(m.content);

                          if (m.role === 'assistant') {
                            // Support for custom [CTA: Label | URL] buttons
                            const parts = contentToRender.split(/(\[CTA: .+? \| .+?\])/g);

                            return (
                              <div className={`prose dark:prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
                                {parts.map((part, idx) => {
                                  const ctaMatch = part.match(/\[CTA: (.+?) \| (.+?)\]/);
                                  if (ctaMatch) {
                                    const [, label, url] = ctaMatch;
                                    return (
                                      <motion.div
                                        key={idx}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="my-6"
                                      >
                                        <Link
                                          href={url}
                                          target="_blank"
                                          className="inline-flex items-center gap-2 bg-[var(--surface-2)] hover:bg-[#3c4043] text-[var(--text)] px-8 py-3 rounded-full font-bold transition-all shadow-lg active:scale-95 border border-[var(--border)] group no-underline"
                                        >
                                          <span>{label}</span>
                                          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                        </Link>
                                      </motion.div>
                                    );
                                  }

                                  const isLastAssistantMsg = m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant';
                                  // Default to full length for historical messages (anything not in current typing state)
                                  const charsToShow = visibleChars[m.id] ?? (m.role === 'assistant' ? part.length : part.length);
                                  const textToDisplay = part.slice(0, charsToShow);

                                  return (
                                    <div key={idx} className="relative inline-block w-full">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                          p: ({ node, ...props }) => <p className="mb-4 last:mb-0" {...props} />,
                                          ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-4 space-y-1.5 marker:text-[var(--accent)]" {...props} />,
                                          ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-[var(--accent)]" {...props} />,
                                          strong: ({ node, ...props }) => <strong className="font-bold text-[var(--text)]" {...props} />,
                                          a: ({ node, ...props }) => <a className="text-[var(--accent)] hover:underline transition-colors font-medium" {...props} />,
                                          code: ({ node, className, children, ...props }) => {
                                            const match = /language-(\w+)/.exec(className || '');
                                            const isInline = !match && !className?.includes('language-');
                                            return isInline
                                              ? <code className="bg-[var(--surface-2)] text-[var(--accent)] px-1.5 py-0.5 rounded text-[14px] font-mono font-medium" {...props}>{children}</code>
                                              : <div className="bg-[#0e0e0e] rounded-xl border border-white/10 overflow-hidden my-6"><div className="px-4 py-2 bg-white/5 text-[11px] text-white/40 font-mono uppercase tracking-widest border-b border-white/10">{match?.[1] || 'code'}</div><pre className="p-4 overflow-x-auto text-[14px] text-gray-300 font-mono leading-relaxed"><code {...props}>{children}</code></pre></div>
                                          }
                                        }}
                                      >
                                        {textToDisplay}
                                      </ReactMarkdown>

                                      {/* ChatGPT Typing Cursor */}
                                      {isLastAssistantMsg && charsToShow < part.length && (
                                        <motion.span
                                          animate={{ opacity: [1, 0, 1] }}
                                          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
                                          className="inline-block w-2.5 h-5 ml-1 bg-[var(--text)] align-middle shadow-[0_0_8px_var(--text)] opacity-80"
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          }
                          return contentToRender;
                        })()}
                      </div>

                      {/* New / Renewal choice buttons — show after the bot asks */}
                      {pendingServiceChoice && SERVICE_FLOW_RESPONSES[pendingServiceChoice] && m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant' && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.4, duration: 0.4 }}
                          className="flex flex-wrap justify-center gap-2 mt-4 w-full"
                        >
                          {(() => {
                            const btnLabels = getLocalizedBtnLabels(pendingServiceChoice!, language);
                            return [
                              { label: btnLabels.primary, type: 'new' as const },
                              { label: btnLabels.secondary, type: 'renewal' as const },
                            ].map((option) => (
                            <button
                              key={option.type}
                              onClick={() => {
                                const service = pendingServiceChoice!;
                                const flow = SERVICE_FLOW_RESPONSES[service];
                                if (!flow) return;
                                const choiceLabel = option.label.replace(/^[^\w]*/, '').trim();
                                const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: choiceLabel };
                                
                                if (option.type === 'new') {
                                  const serviceChips = SERVICE_AREA_CHIPS[service];
                                  const askAreaText = language === 'tr'
                                    ? (serviceChips?.question
                                        ? `📍 ${serviceChips.question} Lütfen aşağıdan birini seçin veya yazın.`
                                        : "İstanbul'da hangi bölgede veya ilçede başvuruyorsunuz? Lütfen aşağıdan birini seçin veya yazın.")
                                    : language === 'ar'
                                    ? (serviceChips?.question
                                        ? `📍 ${serviceChips.question} يرجى الاختيار أدناه أو الكتابة.`
                                        : "في أي منطقة أو بلدية في إسطنبول تقوم بالتقديم؟ يرجى اختيار إحدى المناطق أدناه أو كتابة المنطقة.")
                                    : language === 'tk'
                                    ? (serviceChips?.question
                                        ? `📍 ${serviceChips.question} Aşakdan birini saýlaň ýa-da ýazyň.`
                                        : "Stambulda haýsy etrapda ýa-da bölgede arza berýärsiňiz? Aşakdan birini saýlaň ýa-da etrabyňyzy ýazyň.")
                                    : (serviceChips?.question
                                        ? `📍 ${serviceChips.question}\n\nSelect one below or type your answer:`
                                        : "Which area or district in Istanbul are you applying in? Please select one below or type your district.");

                                  const responseId = msgIdRef.current++;
                                  setVisibleChars(prev => ({ ...prev, [responseId]: 0 }));
                                  setMsgs(p => [...p, userMsg, { id: responseId, role: 'assistant', content: askAreaText }]);
                                  setPendingServiceChoice(null);
                                  setAwaitingAreaService(service);

                                  // Animate typewriter
                                  let chars = 0;
                                  const interval = setInterval(() => {
                                    chars += 15;
                                    setVisibleChars(prev => ({ ...prev, [responseId]: chars }));
                                    if (chars >= askAreaText.length) clearInterval(interval);
                                  }, 30);

                                  saveMessagesToHistory([
                                    { role: 'user', content: choiceLabel },
                                    { role: 'assistant', content: askAreaText }
                                  ], service, option.type);
                                } else {
                                  // The renewal roadmap is built server-side —
                                  // handleRenewalSubmit streams it in.
                                  setMsgs(p => [...p, userMsg]);
                                  setPendingServiceChoice(null);
                                  handleRenewalSubmit(service);
                                }

                                // Update session title to reflect choice
                                const newTitle = `${service} — ${choiceLabel}`;
                                setSessionTitle(newTitle);
                              }}
                              className={`flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-[13px] border transition-all active:scale-95 hover:scale-[1.03] cursor-pointer ${
                                option.type === 'new'
                                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-400'
                                  : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-400'
                              }`}
                            >
                              {option.label}
                            </button>
                            ));
                          })()}
                        </motion.div>
                      )}

                      {/* Everything this service needs, listed once and kept
                          up to date: each row turns green as its document
                          arrives, and the last one readies the application. */}
                      {checklists[m.id] && m.role === 'assistant' && (
                        <DocumentChecklistCard
                          seed={checklists[m.id]}
                          sessionId={sessionId}
                          token={token}
                          language={language}
                          onSignIn={() => setIsLoginModalOpen(true)}
                        />
                      )}

                      {/* Visa application progress — anchored to the reply that
                          produced it, so it reads as part of the conversation
                          rather than a floating panel. */}
                      {visaIntake && visaIntakeMsgId === m.id && m.role === 'assistant' && (
                        <VisaIntakeCard
                          state={visaIntake}
                          language={language}
                          onAttach={() => fileInputRef.current?.click()}
                        />
                      )}

                      {/* Generated document delivered by the agent — a filled
                          application form the user can download. */}
                      {m.attachment && m.role === 'assistant' && (
                        <motion.button
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                          onClick={() => downloadAttachment(m.attachment!.id)}
                          className="mt-2 flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 shadow-sm transition-all hover:border-indigo-500/50 hover:shadow-md active:scale-[0.98] cursor-pointer"
                        >
                          <span className="h-9 w-9 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center shrink-0">
                            <FileText size={16} className="text-indigo-400" />
                          </span>
                          <span className="flex-1 min-w-0 text-left">
                            <span className="block text-[13px] font-bold text-[var(--text)] truncate">
                              {m.attachment.filename}
                            </span>
                            <span className="block text-[11px] text-[var(--muted)]">
                              {language === 'tr'
                                ? 'Doldurulmuş başvuru belgeniz — indirmek için tıklayın'
                                : language === 'ar'
                                  ? 'نموذج طلبك المعبأ — انقر للتنزيل'
                                  : language === 'tk'
                                    ? 'Doldurylan arza resminamaňyz — ýükläp almak üçin basyň'
                                    : 'Your filled application document — click to download'}
                            </span>
                          </span>
                          <Download size={18} className="text-[var(--muted)] shrink-0" />
                        </motion.button>
                      )}

                      {/* All a finished voice call leaves in the thread. The turns
                          themselves live in voice_call_transcripts. */}
                      {m.transcript && m.role === 'assistant' && (
                        <motion.button
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
                          onClick={() => downloadTranscript(m.transcript!.id)}
                          className="mt-2 flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 shadow-sm transition-all hover:border-emerald-500/50 hover:shadow-md active:scale-[0.98] cursor-pointer"
                        >
                          <span className="h-9 w-9 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center shrink-0">
                            <AudioLines size={16} className="text-emerald-400" />
                          </span>
                          <span className="flex-1 min-w-0 text-left">
                            <span className="block text-[13px] font-bold text-[var(--text)] truncate">
                              {m.content}
                            </span>
                            <span className="block text-[11px] text-[var(--muted)]">
                              {language === 'tr'
                                ? 'Görüşme dökümü — indirmek için tıklayın'
                                : language === 'ar'
                                  ? 'نص المكالمة — انقر للتنزيل'
                                  : language === 'tk'
                                    ? 'Jaňyň ýazgysy — ýükläp almak üçin basyň'
                                    : 'Call transcript — click to download'}
                            </span>
                          </span>
                          <Download size={18} className="text-[var(--muted)] shrink-0" />
                        </motion.button>
                      )}

                      {/* Area selection chips — show when awaitingAreaService is active */}
                      {awaitingAreaService && m.id === msgs[msgs.length - 1]?.id && m.role === 'assistant' && (() => {
                        const chipConfig = SERVICE_AREA_CHIPS[awaitingAreaService];
                        const chipsToShow = chipConfig?.chips ?? DEFAULT_AREA_CHIPS;
                        const chipEmoji = chipConfig?.emoji ?? '📍';
                        return (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.4 }}
                            className="flex flex-wrap justify-center gap-2 mt-4 w-full"
                          >
                            {chipsToShow.map((chipLabel) => (
                              <button
                                key={chipLabel}
                                onClick={() => handleAreaSubmit(chipLabel)}
                                className="flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-[12px] border border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:border-blue-400 transition-all active:scale-95 cursor-pointer"
                              >
                                {chipEmoji} {chipLabel}
                              </button>
                            ))}
                          </motion.div>
                        );
                      })()}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* ── Service shortcuts (Suggested mode only) ───────────────────────
                  Only services + their flow — no tangential follow-up questions.
                  Hidden while typing (Chat mode) or mid New/Renewal/district flow. */}
              {/* ── Dashboard-active: replace chips with new-chat button ──────── */}
              {hasDashboard && !busy && !pendingServiceChoice && !awaitingAreaService && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mt-5 mb-1"
                >
                  <button
                    onClick={() => handleNewChat()}
                    className={`w-full flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-2xl border font-semibold text-[13px] transition-all active:scale-95 hover:scale-[1.01] ${
                      assistantType === 'student'
                        ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-400 hover:bg-emerald-500/[0.12]'
                        : assistantType === 'lawyer'
                        ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-400 hover:bg-amber-500/[0.12]'
                        : 'border-blue-500/30 bg-blue-500/[0.06] text-blue-400 hover:bg-blue-500/[0.12]'
                    }`}
                  >
                    <Plus size={15} />
                    Start new chat for new service
                  </button>
                </motion.div>
              )}


              {busy && !replyStarted && (
                <motion.div
                  initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex w-full items-center justify-start py-4"
                >
                  <div className={`relative h-10 w-10 flex items-center justify-center shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing status ring */}
                    <div className={`absolute inset-0 rounded-xl border backdrop-blur-sm ${assistantType === 'student' ? 'border-emerald-500/20 bg-emerald-500/5' :
                      assistantType === 'lawyer' ? 'border-amber-500/20 bg-amber-500/5' :
                        'border-blue-500/20 bg-blue-500/5'
                      }`} />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`absolute inset-[-2px] rounded-xl border-t ${assistantType === 'student' ? 'border-emerald-500/60' :
                        assistantType === 'lawyer' ? 'border-amber-500/60' :
                          'border-blue-500/60'
                        }`}
                    />
                    <Cpu size={18} className={`${assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                        'text-blue-500'
                      } animate-pulse relative z-10`} />

                    {/* Live processing blip */}
                    <motion.div
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className={`absolute -top-0.5 ${isRTL ? '-left-0.5' : '-right-0.5'} w-1.5 h-1.5 rounded-full z-20 ${assistantType === 'student' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,1)]' :
                        assistantType === 'lawyer' ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,1)]' :
                          'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,1)]'
                        }`}
                    />
                  </div>
                  <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'}`}>
                    <span className={`text-[14px] font-medium animate-pulse ${assistantType === 'student' ? 'text-emerald-500/80' :
                      assistantType === 'lawyer' ? 'text-amber-500/80' :
                        'text-blue-500/80'
                      }`}>
                      {t('agent_thinking')}
                    </span>
                  </div>
                  {isSpeaking && (
                    <button
                      onClick={() => { stopNeuralAudio(); markSpeaking(false); setSpokenWordIndex(-1); }}
                      className="ml-4 p-1.5 rounded-full bg-[var(--surface-2)] text-red-500 hover:text-white hover:bg-red-500 transition-all shadow-sm active:scale-95"
                      title="Stop Speaking"
                    >
                      <VolumeX size={18} />
                    </button>
                  )}
                </motion.div>
              )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}

          {/* New-chat countdown banner — shown when user tries to message a completed session */}
          <AnimatePresence>
            {newChatCountdown !== null && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="absolute bottom-28 left-1/2 -translate-x-1/2 z-[70] px-4 w-full max-w-sm"
              >
                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl backdrop-blur-md ${
                  assistantType === 'student'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : assistantType === 'lawyer'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                }`}>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-black text-[13px] ${
                    assistantType === 'student' ? 'bg-emerald-500/20' : assistantType === 'lawyer' ? 'bg-amber-500/20' : 'bg-blue-500/20'
                  }`}>
                    {newChatCountdown}
                  </div>
                  <span className="text-[13px] font-medium">
                    Opening a new chat with same agent in {newChatCountdown}s...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Claude-style Quota Notification Overlay */}
          <AnimatePresence>
            {pendingConfirm && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[440px] z-[60] px-4"
              >
                <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.25)] p-6 relative">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <FileText size={20} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[15px] font-bold text-gray-900 mb-1">
                        {t('confirm_credit_title')}
                      </h4>

                      {pendingConfirm.requiresAuth ? (
                        <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
                          {t('confirm_credit_signin')}
                        </p>
                      ) : pendingConfirm.creditsAvailable > 0 ? (
                        <>
                          <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
                            {t('confirm_credit_desc')
                              .replace('{service}', pendingConfirm.service)
                              .replace('{location}', pendingConfirm.location)}
                          </p>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                            <span className="text-[12px] font-medium text-indigo-600">
                              {t('confirm_credit_balance').replace('{n}', String(pendingConfirm.creditsAvailable))}
                            </span>
                          </div>
                          {pendingConfirm.nextExpiry && (
                            <p className="text-[11px] text-gray-400 mb-4 pl-3.5">
                              {t('confirm_credit_expiry').replace(
                                '{date}',
                                new Date(pendingConfirm.nextExpiry).toLocaleDateString(),
                              )}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
                          {t('confirm_credit_none')}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                          onClick={() => setPendingConfirm(null)}
                          className="px-4 py-2 text-[13px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {t('confirm_credit_cancel')}
                        </button>
                        {pendingConfirm.requiresAuth || pendingConfirm.creditsAvailable < 1 ? (
                          <button
                            onClick={() => {
                              const target = pendingConfirm.requiresAuth ? '/login' : '/pricing';
                              setPendingConfirm(null);
                              router.push(target);
                            }}
                            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors"
                          >
                            {pendingConfirm.requiresAuth ? t('confirm_credit_signin_cta') : t('confirm_credit_buy')}
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              const q = pendingConfirm.query;
                              setPendingConfirm(null);
                              // Same message, now with the user's explicit consent to spend.
                              send(q, false, false, true);
                            }}
                            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold hover:bg-indigo-700 transition-colors"
                          >
                            {t('confirm_credit_confirm')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {showQuotaWarning && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-[440px] z-[60] px-4"
              >
                <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.25)] p-6 relative">
                  <div className="flex gap-4">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <Cpu size={20} className="text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[15px] font-bold text-gray-900 mb-1">
                        {t('quota_reached_title')}
                      </h4>
                      <p className="text-[13px] text-gray-600 leading-relaxed mb-4">
                        {t('quota_reached_desc')}
                      </p>

                      <div className="flex items-center gap-2 mb-6">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        <span className="text-[12px] font-medium text-indigo-600">
                          {t('quota_refresh_msg')} {getRefreshTimeLabel()}
                        </span>
                      </div>

                      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                          onClick={() => setShowQuotaWarning(false)}
                          className="px-4 py-2 text-[13px] font-semibold text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          {t('quota_dismiss')}
                        </button>
                        <Link
                          href="/pricing"
                          onClick={() => setShowQuotaWarning(false)}
                          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[13px] font-bold transition-all no-underline flex items-center gap-2 active:scale-95"
                        >
                          <span>{t('pricing_upgrade')}</span>
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Sticky Input Bar - Floating Gemini Pill */}
          {!isEmpty && (
            <div className="absolute bottom-0 left-0 w-full pt-16 pb-8 px-4 flex justify-center bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/90 to-transparent z-40">
              <div className="w-full max-w-3xl relative">
                <AnimatePresence>
                  {showTextInput && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
                      animate={{ opacity: 1, y: 0, scaleY: 1 }}
                      exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
                      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                      style={{ originY: 'bottom' }}
                    >
                <div className={`relative flex items-center gap-1 rounded-[28px] py-1 pl-2 pr-1.5 border border-[var(--border)]/70 bg-[var(--surface-1)] shadow-[0_2px_10px_rgba(0,0,0,0.06)] transition-shadow ${busy ? 'opacity-70' : 'focus-within:shadow-[0_4px_18px_rgba(0,0,0,0.10)]'}`}>
                  {/* Dictation bar. Sits over the composer rather than replacing its
                      children, so the text already typed is untouched underneath and
                      comes back exactly as it was if the recording is cancelled. */}
                  {(isDictating || isTranscribing) && (
                    <div className="absolute inset-0 z-10 flex items-center gap-2 rounded-[28px] bg-[var(--surface-1)] pl-2 pr-1.5">
                      {isTranscribing ? (
                        <div className="flex flex-1 items-center gap-2 px-2 text-[13px] text-[var(--muted)]">
                          <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--muted)]/30 border-t-[var(--muted)] animate-spin" />
                          <span>{t('chat_transcribing') || 'Transcribing…'}</span>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={cancelDictation}
                            aria-label={t('chat_dictation_cancel') || 'Cancel dictation'}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors active:scale-95"
                          >
                            <X size={16} />
                          </button>
                      
                          {/* Live level meter. Newest sample on the right, so it reads as
                              moving forward the way every recorder people know does. */}
                          <div className="flex h-9 flex-1 items-center justify-end gap-[3px] overflow-hidden" aria-hidden>
                            {dictationLevels.map((lvl, i) => (
                              <span
                                key={i}
                                className="w-[3px] shrink-0 rounded-full bg-[var(--muted)]/70"
                                style={{ height: `${Math.max(3, Math.round(lvl * 26))}px` }}
                              />
                            ))}
                          </div>
                      
                          {/* Stop: the words land in the box to be read before sending. */}
                          <button
                            onClick={() => finishDictation(false)}
                            aria-label={t('chat_dictation_stop') || 'Stop and insert text'}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors active:scale-95"
                          >
                            <span className="block h-[13px] w-[13px] rounded-[3px] bg-current" />
                          </button>
                      
                          {/* Stop and send, for when they already know what they said. */}
                          <button
                            onClick={() => finishDictation(true)}
                            aria-label={t('chat_dictation_send') || 'Stop and send'}
                            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-[#2f7bf6] text-white hover:bg-[#2569db] transition-colors active:scale-95"
                          >
                            <ArrowUp size={19} />
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors shrink-0"
                  >
                    <Plus size={22} />
                  </button>
                  {showTextInput ? (
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => {
                        setInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); if (inputRef.current) inputRef.current.style.height = 'auto'; }
                      }}
                      disabled={busy}
                      placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything..."}
                      className="flex-1 bg-transparent py-2.5 px-1 text-[16px] leading-normal text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:outline-none resize-none overflow-y-auto min-h-[44px] max-h-[120px] slim-scroll"
                      rows={1}
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => setShowTextInput(true)}
                      className="flex-1 flex items-center gap-2 py-2.5 px-3 text-[13px] text-[var(--muted)]/40 hover:text-[var(--muted)]/80 transition-colors group"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60 group-hover:opacity-100 transition-opacity shrink-0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                      <span>Type a message...</span>
                    </button>
                  )}
                  {/* Right cluster: a plain mic, then one round action button.
                      The action button is the only control that changes meaning —
                      an arrow to send when there is text, a waveform to start voice
                      when there is not — so there is never a question about which
                      button does what. */}
                  <div className="flex items-center gap-1 pr-1 shrink-0">
                    {!busy && (
                      <button
                        onClick={startDictation}
                        aria-label={isDictating ? (t('chat_dictation_stop') || 'Recording') : (t('chat_dictate') || 'Dictate a message')}
                        className={`h-9 w-9 flex items-center justify-center rounded-full transition-colors shrink-0 ${
                          isDictating
                            ? 'text-red-500'
                            : 'text-[var(--muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        <Mic size={19} className={isDictating ? 'animate-pulse' : ''} />
                      </button>
                    )}
                  
                    {busy ? (
                      <button
                        onClick={cancelResponse}
                        aria-label="Cancel"
                        className="h-9 w-9 flex items-center justify-center rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-red-500 hover:text-white transition-all shrink-0 active:scale-95"
                      >
                        <X size={17} />
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          if (input.trim()) {
                            send();
                            if (inputRef.current) inputRef.current.style.height = 'auto';
                          } else {
                            toggleVoice();
                          }
                        }}
                        aria-label={input.trim() ? 'Send' : (t('chat_voice') || 'Voice')}
                        className={`h-9 w-9 flex items-center justify-center rounded-full text-white shadow-sm transition-all shrink-0 active:scale-95 ${
                          isListening ? 'bg-red-500' : 'bg-[#2f7bf6] hover:bg-[#2569db]'
                        }`}
                      >
                        {input.trim() ? <ArrowUp size={19} /> : <AudioLines size={19} />}
                      </button>
                    )}
                  </div>

                  {file && (
                    <div className="absolute -top-12 left-4">
                      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-full px-3 py-1.5 text-[12px] text-[var(--text)] shadow-sm">
                        <FileText size={12} className="text-indigo-400" />
                        <span className="truncate max-w-[120px]">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={12} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}

                  {uploadError && (
                    <div className="absolute -top-12 left-4">
                      <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/40 rounded-full px-3 py-1.5 text-[12px] text-red-400 shadow-sm">
                        <span className="truncate max-w-[280px]">{uploadError}</span>
                        <button onClick={() => setUploadError(null)} className="ml-1 hover:text-red-300 transition-colors">
                          <Plus size={12} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

        </div>

        {/* ── ChatGPT-Style Voice Call Overlay ── */}
        <AnimatePresence>
          {isVoiceMode && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.35 }}
              className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
              style={{ background: 'radial-gradient(ellipse at 50% 55%, rgba(var(--surface-2-rgb), 0.85) 0%, var(--bg) 72%)' }}
            >
              {/* ── Ambient background glow ── */}
              <div className="absolute inset-0 pointer-events-none">
                <motion.div
                  animate={{ scale: isSpeaking ? [1, 1.3, 1] : [1, 1.08, 1], opacity: isSpeaking ? [0.25, 0.55, 0.25] : [0.12, 0.22, 0.12] }}
                  transition={{ duration: isSpeaking ? 1.2 : 3, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
                  style={{
                    background: `radial-gradient(circle, rgba(${(AGENT_ACCENT[assistantType] ?? AGENT_ACCENT.permit).glow}, ${0.16 + (isSpeaking ? voiceLevel : 0) * 0.30}) 0%, transparent 70%)`,
                  }}
                />
              </div>

              {/* ── Top bar: chip + hang up ── */}
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 pt-8 z-10">
                <div />   {/* spacer, so the chip stays centred */}

                {/* What the call has worked out so far. One lookup rather than the
                    same conditional restated in the border, icon, glow and label. */}
                <AnimatePresence>
                  {detectedService && (() => {
                    const SERVICE_CHIP: Record<string, { label: string; tone: string; text: string; glow: string }> = {
                      university: { label: 'University',       tone: 'border-emerald-500/20 bg-emerald-500/10 shadow-emerald-500/10', text: 'text-emerald-400', glow: 'bg-emerald-500/30' },
                      visa:       { label: 'Student Visa',     tone: 'border-blue-500/20 bg-blue-500/10 shadow-blue-500/10',          text: 'text-blue-400',    glow: 'bg-blue-500/30' },
                      ikamet:     { label: 'Residence Permit', tone: 'border-violet-500/20 bg-violet-500/10 shadow-violet-500/10',    text: 'text-violet-400',  glow: 'bg-violet-500/30' },
                      insurance:  { label: 'Health Insurance', tone: 'border-amber-500/20 bg-amber-500/10 shadow-amber-500/10',       text: 'text-amber-400',   glow: 'bg-amber-500/30' },
                    };
                    const chip = SERVICE_CHIP[detectedService];
                    if (!chip) return null;   // nothing recognised yet — no chip at all
                    return (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className={`flex items-center gap-2.5 px-4 py-2 rounded-full border backdrop-blur-xl shadow-lg transition-all ${chip.tone}`}
                      >
                        <div className="relative flex items-center justify-center">
                          <Cpu size={15} className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${chip.text}`} />
                          <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${chip.glow}`} />
                        </div>
                        <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${chip.text}`}>
                          {chip.label}
                        </span>
                      </motion.div>
                    );
                  })()}
                </AnimatePresence>

                {/* Close / hang up */}
                <button
                  onClick={hangUpCall}
                  className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--surface-2)] hover:bg-red-500/20 border border-[var(--border)] hover:border-red-500/40 text-[var(--muted)] hover:text-red-400 transition-all active:scale-90"
                >
                  <X size={20} />
                </button>
              </div>

              {/* ── Voice orb ── */}
              <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>

                {/* The circle itself. Scale and glow follow how loud the agent
                    actually is, not a looping keyframe — a canned pulse keeps
                    beating through pauses and stays flat through emphasis. */}
                <motion.div
                  animate={{ scale: isSpeaking ? 1 + voiceLevel * 0.13 : isListening ? 1 + voiceLevel * 0.05 : 1 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 20, mass: 0.6 }}
                  className="relative overflow-hidden"
                  style={{
                    width: 220, height: 220,
                    borderRadius: '50%',
                    background: (AGENT_ACCENT[assistantType] ?? AGENT_ACCENT.permit).gradient,
                    boxShadow: (() => {
                      const g = (AGENT_ACCENT[assistantType] ?? AGENT_ACCENT.permit).glow;
                      const lit = isSpeaking ? voiceLevel : 0;
                      const spread = 40 + lit * 55;
                      const blur = 12 + lit * 26;
                      return `0 0 ${spread}px ${blur}px rgba(${g}, ${0.18 + lit * 0.32}), `
                        + `0 0 ${spread * 1.9}px ${blur * 2.2}px rgba(${g}, ${0.06 + lit * 0.16})`;
                    })(),
                  }}
                >
                  {/* Cloud blob 1 — large bright wisp, top-left */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['-10%', '8%', '-6%', '5%', '-10%'],
                      y: isSpeaking ? ['-15%', '10%', '-8%', '12%', '-15%'] : ['-15%', '5%', '-10%', '3%', '-15%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.8 : 8, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute"
                    style={{
                      width: '130%', height: '130%',
                      top: '-15%', left: '-15%',
                      borderRadius: '50%',
                      background: 'radial-gradient(ellipse at 45% 42%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.4) 35%, transparent 65%)',
                      filter: 'blur(18px)',
                    }}
                  />
                  {/* Cloud blob 2 — medium, drifts bottom-right */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['20%', '-10%', '18%', '-5%', '20%'] : ['20%', '-5%', '12%', '-8%', '20%'],
                      y: isSpeaking ? ['20%', '-5%', '22%', '-2%', '20%'] : ['20%', '5%', '15%', '0%', '20%'],
                    }}
                    transition={{ duration: isSpeaking ? 3.2 : 10, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
                    className="absolute"
                    style={{
                      width: '110%', height: '110%',
                      top: '-5%', left: '-5%',
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(167,243,208,0.5) 30%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(254,243,199,0.5) 30%, transparent 60%)'
                          : 'radial-gradient(ellipse at 60% 65%, rgba(255,255,255,0.7) 0%, rgba(186,230,255,0.5) 30%, transparent 60%)',
                      filter: 'blur(22px)',
                    }}
                  />
                  {/* Cloud blob 3 — small bright accent, wanders freely */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['-5%', '25%', '-8%', '20%', '-5%'] : ['5%', '-12%', '15%', '-5%', '5%'],
                      y: isSpeaking ? ['10%', '-12%', '18%', '-8%', '10%'] : ['-5%', '10%', '-8%', '6%', '-5%'],
                    }}
                    transition={{ duration: isSpeaking ? 2.0 : 12, repeat: Infinity, ease: 'easeInOut', delay: 1.8 }}
                    className="absolute"
                    style={{
                      width: '80%', height: '80%',
                      top: '10%', left: '10%',
                      borderRadius: '60% 40% 50% 50% / 40% 50% 50% 60%',
                      background: 'radial-gradient(ellipse at 40% 40%, rgba(255,255,255,0.85) 0%, transparent 55%)',
                      filter: 'blur(14px)',
                    }}
                  />
                  {/* Cloud blob 4 — subtle deep color layer for depth */}
                  <motion.div
                    animate={{
                      x: isSpeaking ? ['15%', '-15%', '10%', '-10%', '15%'] : ['0%', '10%', '-5%', '8%', '0%'],
                      y: isSpeaking ? ['-10%', '15%', '-5%', '10%', '-10%'] : ['0%', '-8%', '5%', '-3%', '0%'],
                      scale: isSpeaking ? [1, 1.15, 0.9, 1.1, 1] : 1,
                    }}
                    transition={{ duration: isSpeaking ? 1.8 : 9, repeat: Infinity, ease: 'easeInOut', delay: 0.4 }}
                    className="absolute inset-0"
                    style={{
                      borderRadius: '50%',
                      background: assistantType === 'student'
                        ? 'radial-gradient(ellipse at 70% 30%, rgba(16,185,129,0.45) 0%, transparent 60%)'
                        : assistantType === 'lawyer'
                          ? 'radial-gradient(ellipse at 70% 30%, rgba(245,158,11,0.45) 0%, transparent 60%)'
                          : 'radial-gradient(ellipse at 70% 30%, rgba(59,130,246,0.5) 0%, transparent 60%)',
                      filter: 'blur(20px)',
                    }}
                  />
                </motion.div>

                {/* Soft outer glow ring — pulses on speak */}
                <motion.div
                  animate={{
                    opacity: isSpeaking ? 0.25 + voiceLevel * 0.55 : isListening ? 0.22 : 0.12,
                    scale: isSpeaking ? 1 + voiceLevel * 0.16 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 200, damping: 24, mass: 0.7 }}
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    width: 240, height: 240,
                    background: `radial-gradient(circle, rgba(${(AGENT_ACCENT[assistantType] ?? AGENT_ACCENT.permit).glow}, 0.38) 0%, transparent 70%)`,
                    filter: 'blur(20px)',
                  }}
                />

                {/* Busy processing dots overlay */}
                {busy && !isSpeaking && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex items-center justify-center z-[100]"
                  >
                    <div className="flex gap-2.5">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{ y: [0, -15, 0], scale: [1, 1.25, 1] }}
                          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
                          className="w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_15px_rgba(255,255,255,0.6)]"
                        />
                      ))}
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ── What they have chosen so far ──
                  Appears the moment record_choice fires, so the caller can SEE
                  that they were heard correctly instead of waiting until the end
                  of the call to find out. Each field animates in on its own, so a
                  university named now and a subject named later do not re-animate
                  each other. */}
              <AnimatePresence>
                {!callEnded && (voiceChoices.university || voiceChoices.major) && (
                  <motion.div
                    initial={{ opacity: 0, y: 12, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    className="mt-10 flex flex-wrap items-center justify-center gap-2 px-6 z-10"
                  >
                    {([
                      ['university', voiceChoices.university] as const,
                      ['major', voiceChoices.major] as const,
                    ] as const).map(([kind, value]) => value ? (
                      <motion.div
                        key={kind}
                        layout
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)]/85 px-4 py-2.5 shadow-lg backdrop-blur-xl"
                      >
                        {kind === 'university'
                          ? <Building2 size={15} className="shrink-0 text-[var(--muted)]" />
                          : <GraduationCap size={15} className="shrink-0 text-[var(--muted)]" />}
                        <span className="text-left">
                          <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-[var(--muted)]/70">
                            {kind === 'university'
                              ? (t('voice_choice_university') || 'University')
                              : (t('voice_choice_major') || 'Major')}
                          </span>
                          <span className="block text-[14px] font-bold leading-tight text-[var(--text)]">{value}</span>
                        </span>
                      </motion.div>
                    ) : null)}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Status text + transcript ── */}
              <div className="mt-20 text-center max-w-lg px-6 z-10">
                <AnimatePresence mode="wait">
                  {callEnded ? (
                    <motion.div key="ended" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center gap-3">
                      {voiceError ? (
                        <>
                          <p className="text-[var(--text)] text-xl font-bold">Call Ended</p>
                          <p className="text-[var(--muted)] text-sm max-w-xs text-center">{voiceError}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-[var(--text)] text-xl font-bold">Call Summary Saved</p>
                          <p className="text-[var(--muted)]/80 text-sm">Your dashboard has been updated with the conversation roadmap.</p>
                        </>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="active" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                      <p className="text-[var(--muted)]/75 text-[11px] font-black uppercase tracking-[0.35em] mb-3">
                        {isSpeaking ? 'Assistant Speaking…' : isListening ? 'Listening…' : 'Connecting…'}
                      </p>
                      <motion.div
                        key={voiceTranscript}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="text-[var(--text)]/85 text-lg font-semibold leading-relaxed min-h-[32px]"
                      >
                        {isListening ? (
                          voiceTranscript ? voiceTranscript : (
                            <div className="flex items-center justify-center h-[32px] gap-2 mt-2">
                              {[0, 1, 2].map(i => (
                                <motion.div
                                  key={i}
                                  animate={{ y: [0, -6, 0], scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                                  transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                                  className={`w-2.5 h-2.5 rounded-full ${assistantType === 'student' ? 'bg-emerald-400/80' : assistantType === 'lawyer' ? 'bg-amber-400/80' : 'bg-blue-400/80'}`}
                                />
                              ))}
                            </div>
                          )
                        ) : isSpeaking ? (
                          (() => {
                            // The caption rendered words 0-11 of the whole reply while spokenWordIndex
                            // counted across all of it, so on anything longer than twelve words the
                            // highlight filled up in the first second or two and then sat there,
                            // frozen, for the rest of the reply. Follow the spoken position instead.
                            const WINDOW = 12;
                            const words = fullCleanText.split(' ');
                            const start = Math.max(0, Math.min(spokenWordIndex - WINDOW + 4, words.length - WINDOW));
                            return words.slice(start, start + WINDOW).map((w, i) => (
                              <motion.span key={start + i} animate={{ opacity: start + i < spokenWordIndex ? 1 : 0.2 }} transition={{ duration: 0.08 }} className="inline-block mr-1">{w}</motion.span>
                            ));
                          })()
                        ) : null}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Hang-up button ── */}
              {!callEnded && (
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  onClick={hangUpCall}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.93 }}
                  className="absolute bottom-12 w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-[0_0_40px_rgba(239,68,68,0.5)] transition-colors z-10"
                >
                  {/* Phone hang-up icon */}
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                    <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C9.6 21 3 14.4 3 6c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                  </svg>
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>


        <style dangerouslySetInnerHTML={{
          __html: `
          .slim-scroll::-webkit-scrollbar { width: 6px; }
          .slim-scroll::-webkit-scrollbar-track { background: transparent; }
          .slim-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
          .slim-scroll::-webkit-scrollbar-thumb:hover { background: var(--border); }
        `}} />
      </main>
    </div>
  );
}
