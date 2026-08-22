'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Headset, ArrowLeft, BadgeCheck } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/**
 * CustomerServiceChat — the help page's live support chatbox, backed by the
 * five-agent queue.
 *
 * Flow: join the queue → either an agent connects immediately or the user
 * waits with a position number → when an agent connects there is a short
 * 6-second "agent is joining" beat (like a real operator picking up) → chat
 * goes live. The transcript is saved under a 'support' session so it shows up
 * in the admin dashboard alongside every other conversation.
 */

const AGENT_FALLBACK = ['Merve', 'Emre', 'Zeynep', 'Kerem', 'Elif'];
const JOIN_DELAY_MS = 6000;
const WAIT_POLL_MS = 3500;
const HEARTBEAT_MS = 15000;

// ── Human pacing ────────────────────────────────────────────────────────────
// A person does not stream text at you a character at a time — that is what
// gives an AI away. They read, they type while you watch the "typing…"
// indicator, and then the finished message lands all at once.
//
// So the model's answer is buffered completely and held back: the dots run for
// as long as it would plausibly take someone to write that many characters,
// and then the whole bubble appears.
const THINK_MIN_MS = 900;      // reading your message before starting to type
const THINK_MAX_MS = 2200;     // varies per reply so it is not metronomic
const TYPE_MS_PER_CHAR = 18;   // roughly 65 wpm while composing
const MIN_TYPE_MS = 1200;      // even "Yes." takes a moment to send
const MAX_TYPE_MS = 6500;      // nobody waits eleven seconds for a paragraph

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = { id: string; role: 'user' | 'agent'; text: string; time?: string };

const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

type Phase = 'connecting' | 'waiting' | 'joining' | 'connected';

const COPY: Record<string, Record<string, string>> = {
  en: {
    online: 'Online',
    ticket: 'Ticket reference',
    typing: 'typing…',
    header: 'Customer Service',
    back: 'Back to FAQ',
    today: 'Today',
    findingAgent: 'Finding an agent…',
    joining: '{name} is joining the chat…',
    queueWaitingTitle: 'All our agents are busy',
    queueWaitingDesc: 'You are number {position} in the queue — please wait a moment.',
    queueWaitingEta: 'About {minutes} min until an agent is free.',
    placeholder: 'Ask the customer service…',
    welcome: 'Merhaba! I am {name} from TurkGateway customer service. How can I help you today?',
    networkError: 'Sorry, I could not connect right now. Please try again in a moment.',
  },
  tr: {
    online: 'Çevrimiçi',
    ticket: 'Talep numarası',
    typing: 'yazıyor…',
    header: 'Müşteri Hizmetleri',
    back: "SSS'e dön",
    today: 'Bugün',
    findingAgent: 'Temsilci aranıyor…',
    joining: '{name} sohbete katılıyor…',
    queueWaitingTitle: 'Tüm temsilcilerimiz meşgul',
    queueWaitingDesc: 'Sırada {position}. sıradasınız — lütfen bir dakika bekleyin.',
    queueWaitingEta: 'Bir temsilcinin boşalmasına yaklaşık {minutes} dk.',
    placeholder: 'Müşteri hizmetlerine sorun…',
    welcome: 'Merhaba! Ben TurkGateway müşteri hizmetlerinden {name}. Bugün size nasıl yardımcı olabilirim?',
    networkError: 'Üzgünüm, şu anda bağlanamıyorum. Lütfen biraz sonra tekrar deneyin.',
  },
  ar: {
    online: 'متصل',
    ticket: 'رقم التذكرة',
    typing: 'يكتب…',
    header: 'خدمة العملاء',
    back: 'العودة إلى الأسئلة',
    today: 'اليوم',
    findingAgent: 'جارٍ البحث عن وكيل…',
    joining: '{name} ينضم إلى الدردشة…',
    queueWaitingTitle: 'جميع وكلائنا مشغولون',
    queueWaitingDesc: 'أنت رقم {position} في الطابور — يرجى الانتظار لحظة.',
    queueWaitingEta: 'حوالي {minutes} دقيقة حتى يتوفر وكيل.',
    placeholder: 'اسأل خدمة العملاء…',
    welcome: 'مرحباً! أنا {name} من خدمة عملاء TurkGateway. كيف يمكنني مساعدتك اليوم؟',
    networkError: 'عذراً، لا يمكنني الاتصال الآن. يرجى المحاولة بعد قليل.',
  },
  tk: {
    online: 'Onlaýn',
    ticket: 'Talap belgisi',
    typing: 'ýazýar…',
    header: 'Müşderi Hyzmaty',
    back: 'Soraglara gaýt',
    today: 'Şu gün',
    findingAgent: 'Agent gözlenýär…',
    joining: '{name} söhbete goşulýar…',
    queueWaitingTitle: 'Ähli agentlerimiz meşgul',
    queueWaitingDesc: 'Nobatda {position}. ýerde durşuňyz — biraz garaşyň.',
    queueWaitingEta: 'Agent boşamagyna takmynan {minutes} min galdy.',
    placeholder: 'Müşderi hyzmatyndan soraň…',
    welcome: 'Salam! Men TurkGateway müşderi hyzmatyndan {name}. Size nädip kömek edip bilerin?',
    networkError: 'Bagyşlaň, häzir baglanyp bilmedim. Biraz soň täzeden synanyşyň.',
  },
};

const QUICK_CHIPS: Record<string, string[]> = {
  en: [
    'Pricing & credits',
    'Credits lost after payment',
    'Payment or refund',
    'Questions ran out',
    'Account help',
    '2FA / security',
    'Delete my account',
    'How the agency works',
  ],
  tr: [
    'Fiyatlar ve krediler',
    'Ödeme sonrası krediler kayboldu',
    'Ödeme veya iade',
    'Soru hakkım bitti',
    'Hesap yardımı',
    '2FA / güvenlik',
    'Hesabımı silmek istiyorum',
    'Ajans nasıl çalışır?',
  ],
  ar: [
    'الأسعار والرصيد',
    'فقدت الرصيد بعد الدفع',
    'الدفع أو الاسترداد',
    'انتهت أسئلتي المجانية',
    'مساعدة الحساب',
    'التحقق بخطوتين / الأمان',
    'حذف حسابي',
    'كيف تعمل الوكالة؟',
  ],
  tk: [
    'Bahalar we kreditler',
    'Tölegden soň kreditler ýitdi',
    'Töleg ýa-da yzyna gaýtarma',
    'Sorag hakym gutardy',
    'Hasap kömegi',
    '2FA / howpsuzlyk',
    'Hasabymy pozmak',
    'Agentlik nähili işleýär?',
  ],
};

export default function CustomerServiceChat({
  initialQuestion,
  onBack,
}: {
  initialQuestion?: string | null;
  onBack?: () => void;
}) {
  const { language } = useLanguage();
  const lang = COPY[language] ? language : 'en';
  const copy = COPY[lang];
  const chips = QUICK_CHIPS[lang] ?? QUICK_CHIPS.en;

  const [phase, setPhase] = useState<Phase>('connecting');
  const [position, setPosition] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [ticketNo, setTicketNo] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [sessionId] = useState(() => `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const listRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef('');
  const handledQuestion = useRef<string | null>(null);
  const sendRef = useRef<(query: string) => Promise<void>>(async () => {});
  const aliveRef = useRef(true);

  // ── Queue lifecycle ────────────────────────────────────────────────────────
  useEffect(() => {
    aliveRef.current = true;
    let stop = false;
    let joiningTimer: ReturnType<typeof setTimeout> | null = null;
    let waitTimer: ReturnType<typeof setInterval> | null = null;
    let beatTimer: ReturnType<typeof setInterval> | null = null;

    const post = async (path: string, body: Record<string, string>) => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    };

    const startJoining = (name: string) => {
      setAgentName(name);
      setPhase('joining');
      joiningTimer = setTimeout(() => {
        if (stop) return;
        setMessages([{ id: 'welcome', role: 'agent', text: copy.welcome.replace('{name}', name), time: nowTime() }]);
        setPhase('connected');
      }, JOIN_DELAY_MS);
    };

    const join = async () => {
      const res = await post('/api/support/queue/join', {
        session_id: sessionId,
        // The escalated FAQ question is the ticket subject — it is what the
        // customer actually came in about, and it drives the category/priority.
        subject: initialQuestion ?? '',
        language,
      });
      if (res?.ticket_ref) setTicketNo(res.ticket_ref);
      if (!res || (res.status !== 'connected' && res.status !== 'waiting')) {
        // Queue unavailable — degrade gracefully to a random agent.
        startJoining(AGENT_FALLBACK[Math.floor(Math.random() * AGENT_FALLBACK.length)]);
        return;
      }
      if (res.status === 'connected') {
        startJoining(res.agent);
        return;
      }
      ticketRef.current = res.ticket_id ?? '';
      setPosition(res.position ?? 1);
      setEtaSeconds(typeof res.eta_seconds === 'number' ? res.eta_seconds : null);
      setPhase('waiting');
      waitTimer = setInterval(async () => {
        const poll = await post('/api/support/queue/poll', {
          ticket_id: ticketRef.current,
          session_id: sessionId,
        });
        if (!poll || poll.status === 'dropped') {
          startJoining(AGENT_FALLBACK[Math.floor(Math.random() * AGENT_FALLBACK.length)]);
          if (waitTimer) clearInterval(waitTimer);
          return;
        }
        if (poll.status === 'connected') {
          if (waitTimer) clearInterval(waitTimer);
          startJoining(poll.agent);
        } else {
          setPosition(poll.position ?? 1);
          setEtaSeconds(typeof poll.eta_seconds === 'number' ? poll.eta_seconds : null);
        }
      }, WAIT_POLL_MS);
    };

    join();

    // Keep the slot alive while connected/joining.
    beatTimer = setInterval(() => {
      post('/api/support/queue/poll', { ticket_id: ticketRef.current, session_id: sessionId });
    }, HEARTBEAT_MS);

    return () => {
      stop = true;
      aliveRef.current = false;
      if (joiningTimer) clearTimeout(joiningTimer);
      if (waitTimer) clearInterval(waitTimer);
      if (beatTimer) clearInterval(beatTimer);
      post('/api/support/queue/leave', { ticket_id: ticketRef.current, session_id: sessionId });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Escalation: the FAQ question is sent once the agent is live ─────────────
  useEffect(() => {
    if (phase === 'connected' && initialQuestion && handledQuestion.current !== initialQuestion) {
      handledQuestion.current = initialQuestion;
      const timer = setTimeout(() => sendRef.current(initialQuestion), 400);
      return () => clearTimeout(timer);
    }
  }, [phase, initialQuestion]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, phase]);

  async function send(query: string) {
    const text = query.trim();
    if (!text || typing || phase !== 'connected') return;
    setInput('');
    setTyping(true);

    const history = messages.map((m) => ({ role: m.role === 'agent' ? 'assistant' : 'user', content: m.text }));

    // One stable message for the whole reply — every delta updates THIS bubble
    // by id instead of appending, so a streamed answer stays a single message.
    const streamId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((m) => [
      ...m,
      { id: streamId, role: 'user', text, time: nowTime() },
      { id: `a-${streamId}`, role: 'agent', text: '', time: nowTime() },
    ]);

    // The reply is collected in full and shown in one piece — never streamed
    // into the bubble, which is the tell that there is no person on the other
    // end. The bubble stays empty (so the dots keep bouncing) until then.
    let pending = '';
    let streamDone = false;

    const setBubble = (text: string) =>
      setMessages((m) =>
        m.map((msg) => (msg.id === `a-${streamId}` ? { ...msg, text } : msg)),
      );

    const reveal = (async () => {
      // Reading your message.
      await sleep(THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS));

      // Wait for the whole answer before starting the "typing" beat — its
      // length is what decides how long someone would have spent writing it.
      while (aliveRef.current && !streamDone) await sleep(50);
      if (!aliveRef.current) return;

      const composing = Math.min(
        MAX_TYPE_MS,
        Math.max(MIN_TYPE_MS, pending.length * TYPE_MS_PER_CHAR),
      );
      await sleep(composing);

      if (aliveRef.current) setBubble(pending);
    })();

    const pushAgent = (chunk: string) => {
      pending += chunk;
    };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const token = typeof window !== 'undefined' ? localStorage.getItem('permitops_token') : null;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/agent/query', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: text,
          language: ['tk', 'ar', 'tr', 'az', 'uz', 'kk', 'fa', 'ru'].includes(language) ? language : 'en',
          assistant_type: 'support',
          session_id: sessionId,
          history,
        }),
      });

      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null);
        pushAgent(detail?.detail || copy.networkError);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split('\n');
          let event = '';
          const data: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data.push(line.slice(6));
          }
          if (!data.length) continue;
          const payload = JSON.parse(data.join('\n'));
          if (event === 'delta' && payload.t) pushAgent(payload.t);
          else if (event === 'error') pushAgent(payload.detail || copy.networkError);
        }
      }

      if (!pending.trim()) pushAgent(copy.networkError);
    } catch {
      if (!pending.trim()) pushAgent(copy.networkError);
    } finally {
      // The network is done, but the agent is not: hold "typing…" through the
      // composing beat so the indicator and the message stay in step.
      streamDone = true;
      await reveal;
      setTyping(false);
    }
  }

  sendRef.current = send;

  const agentLabel = agentName ?? copy.header;

  return (
    <section id="support-chat" className="relative w-full max-w-3xl mx-auto mb-12 md:mb-20">
      {/* Back to FAQ — outside the card, so it reads as leaving the chat */}
      {onBack && (
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px] font-medium text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-2)] transition-colors active:scale-95 mb-4 cursor-pointer"
        >
          <ArrowLeft
            size={14}
            className={`transition-transform group-hover:-translate-x-0.5 ${language === 'ar' ? 'rotate-180 group-hover:translate-x-0.5' : ''}`}
          />
          {copy.back}
        </button>
      )}

      <div className="relative rounded-[28px] border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden shadow-[0_24px_60px_-24px_rgba(66,52,34,0.28)]">
        {/* ── Header ──────────────────────────────────────────────────────
            Warm ink rather than flat black, with the agent's chip on the left
            so the bar has a subject instead of floating text. */}
        <div
          className="flex items-center gap-3 px-4 md:px-5 py-3.5 text-[#faf8f4]"
          style={{ background: 'linear-gradient(180deg, #262019 0%, #1a1712 100%)' }}
        >
          <div className="cs-chip h-9 w-9 rounded-xl flex items-center justify-center shrink-0">
            <Headset size={16} className="relative z-10 text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 text-[14.5px] font-semibold leading-tight truncate">
              {agentLabel}
              {phase === 'connected' && <BadgeCheck size={14} className="shrink-0 text-emerald-400" />}
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-[#faf8f4]/60 leading-tight mt-0.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${phase === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'} ${typing ? 'animate-pulse' : ''}`}
              />
              {typing ? copy.typing : `${copy.online} · ${copy.header}`}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {ticketNo && (
              <span
                className="rounded-full bg-white/[0.08] border border-white/10 px-2.5 py-1 text-[10.5px] font-medium tracking-wide tabular-nums text-[#faf8f4]/80"
                title={copy.ticket}
              >
                {ticketNo}
              </span>
            )}
            <span className="hidden sm:flex items-center gap-1.5 rounded-full bg-white/[0.08] border border-white/10 px-2.5 py-1 text-[10.5px] font-medium text-[#faf8f4]/80">
              <Headset size={12} />
              7/24
            </span>
          </div>
        </div>

        {/* Queue / joining status (before the agent is live) */}
        {phase !== 'connected' ? (
          <div
            className="flex flex-col items-center justify-center gap-4 h-[360px] md:h-[440px] px-6"
            dir={language === 'ar' ? 'rtl' : 'ltr'}
          >
            {/* Concentric rings read as "connecting" without another spinner */}
            <div className="relative flex items-center justify-center">
              <span className="absolute h-24 w-24 rounded-full border border-red-500/10" />
              <span className="absolute h-16 w-16 rounded-full border border-red-500/20 animate-pulse" />
              <div className="cs-chip relative h-14 w-14 rounded-2xl flex items-center justify-center">
                <Headset size={24} className="relative z-10 text-white" />
              </div>
            </div>

            {phase === 'connecting' && (
              <p className="text-sm text-[var(--muted)] mt-2">{copy.findingAgent}</p>
            )}

            {phase === 'waiting' && (
              <>
                <p className="text-[17px] font-semibold text-[var(--text)] mt-2">{copy.queueWaitingTitle}</p>
                <p className="text-[13px] text-[var(--muted)] text-center max-w-xs leading-relaxed">
                  {copy.queueWaitingDesc.replace('{position}', String(position ?? 1))}
                </p>
                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-2)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-ping" />
                  <span className="text-[12px] font-medium tabular-nums text-[var(--text)]">#{position ?? 1}</span>
                </div>
                {etaSeconds !== null && (
                  <p className="text-[12px] text-[var(--muted)] tabular-nums">
                    {copy.queueWaitingEta.replace(
                      '{minutes}',
                      String(Math.max(1, Math.ceil(etaSeconds / 60))),
                    )}
                  </p>
                )}
              </>
            )}

            {phase === 'joining' && (
              <>
                <p className="text-[17px] font-semibold text-[var(--text)] mt-2">
                  {copy.joining.replace('{name}', agentLabel)}
                </p>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500/60" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500/60" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-red-500/60" style={{ animationDelay: '300ms' }} />
                </span>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Messages */}
            <div
              ref={listRef}
              className="h-[360px] md:h-[440px] overflow-y-auto slim-scroll px-4 md:px-5 py-5 space-y-4"
              dir={language === 'ar' ? 'rtl' : 'ltr'}
            >
              {/* Today divider */}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--border)]" />
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">{copy.today}</span>
                <span className="h-px flex-1 bg-[var(--border)]" />
              </div>

              {messages.map((m) => (
                <div key={m.id} className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {m.role === 'agent' && (
                    <div className={`cs-chip h-8 w-8 rounded-[10px] flex items-center justify-center shrink-0 mt-0.5 ${language === 'ar' ? 'ml-2.5' : 'mr-2.5'}`}>
                      <Headset size={13} className="relative z-10 text-white" />
                    </div>
                  )}
                  <div className={`flex flex-col max-w-[85%] md:max-w-[76%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`text-[14.5px] leading-[1.65] whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'px-4 py-2.5 rounded-2xl rounded-br-md bg-red-600 text-white shadow-[0_2px_8px_rgba(220,38,38,0.18)]'
                          : 'px-4 py-3 rounded-2xl rounded-bl-md bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]'
                      }`}
                    >
                      {m.role === 'agent' && !m.text ? (
                        <span className="flex items-center gap-1.5 py-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" style={{ animationDelay: '0ms' }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" style={{ animationDelay: '140ms' }} />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" style={{ animationDelay: '280ms' }} />
                        </span>
                      ) : (
                        m.text
                      )}
                    </div>
                    {m.time && (
                      <span className="mt-1 px-1 text-[10px] tabular-nums text-[var(--muted)]">{m.time}</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Quick chips when the conversation is just starting */}
              {messages.length <= 1 && (
                <div className={`flex flex-wrap gap-2 pt-1 ${language === 'ar' ? 'pe-11' : 'ps-11'}`}>
                  {chips.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => send(chip)}
                      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--text)] hover:border-[var(--border-2)] active:scale-95 cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="border-t border-[var(--border)] bg-[var(--surface)] p-3 md:p-3.5"
            >
              <div className="flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] bg-[var(--surface-1)] focus-within:border-[var(--border-2)] transition-colors">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={copy.placeholder}
                  className="flex-1 bg-transparent py-2 px-4 text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none min-w-0"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || typing}
                  className="h-9 w-9 flex items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors shrink-0 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  aria-label="Send"
                >
                  <Send size={16} className={language === 'ar' ? 'rotate-180' : ''} />
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </section>
  );
}
