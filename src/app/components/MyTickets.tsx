'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Ticket } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

/**
 * MyTickets — the customer's own support history.
 *
 * Renders nothing at all for signed-out visitors: support works without an
 * account, but a ticket can only be tied back to someone who has one, so there
 * is no history to show and an empty panel would just look broken.
 */

type TicketRow = {
  id: number;
  ref: string;
  subject: string;
  status: string;
  priority: string;
  category: string;
  agent: string | null;
  created_at: string | null;
  last_message_at: string | null;
  message_count: number;
};

type Message = { id: number; role: string; content: string; timestamp: string | null };

const COPY: Record<string, Record<string, string>> = {
  en: {
    title: 'My tickets', empty: 'You have no support tickets yet.',
    open: 'Open', pending: 'Pending', resolved: 'Resolved', closed: 'Closed',
    messages: 'messages', handledBy: 'Handled by',
  },
  tr: {
    title: 'Taleplerim', empty: 'Henüz destek talebiniz yok.',
    open: 'Açık', pending: 'Beklemede', resolved: 'Çözüldü', closed: 'Kapalı',
    messages: 'mesaj', handledBy: 'İlgilenen',
  },
  ar: {
    title: 'تذاكري', empty: 'لا توجد لديك تذاكر دعم بعد.',
    open: 'مفتوحة', pending: 'قيد الانتظار', resolved: 'تم الحل', closed: 'مغلقة',
    messages: 'رسائل', handledBy: 'تولاها',
  },
  tk: {
    title: 'Meniň talaplarym', empty: 'Heniz goldaw talabyňyz ýok.',
    open: 'Açyk', pending: 'Garaşylýar', resolved: 'Çözüldi', closed: 'Ýapyk',
    messages: 'habar', handledBy: 'Alyp baran',
  },
  az: {
    title: 'Müraciətlərim', empty: 'Hələ dəstək müraciətiniz yoxdur.',
    open: 'Açıq', pending: 'Gözləyir', resolved: 'Həll olundu', closed: 'Bağlı',
    messages: 'mesaj', handledBy: 'Baxan',
  },
  uz: {
    title: 'Mening murojaatlarim', empty: 'Hali qoʻllab-quvvatlash murojaatlaringiz yoʻq.',
    open: 'Ochiq', pending: 'Kutilmoqda', resolved: 'Hal qilindi', closed: 'Yopiq',
    messages: 'xabar', handledBy: 'Koʻrib chiqdi',
  },
  kk: {
    title: 'Менің өтініштерім', empty: 'Сізде әзірге қолдау өтініштері жоқ.',
    open: 'Ашық', pending: 'Күтуде', resolved: 'Шешілді', closed: 'Жабық',
    messages: 'хабарлама', handledBy: 'Қараған',
  },
  fa: {
    title: 'تیکت‌های من', empty: 'هنوز تیکت پشتیبانی ندارید.',
    open: 'باز', pending: 'در انتظار', resolved: 'حل شد', closed: 'بسته',
    messages: 'پیام', handledBy: 'رسیدگی توسط',
  },
  ru: {
    title: 'Мои обращения', empty: 'У вас пока нет обращений в поддержку.',
    open: 'Открыто', pending: 'Ожидает', resolved: 'Решено', closed: 'Закрыто',
    messages: 'сообщений', handledBy: 'Обработал',
  },
};

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  closed: 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]',
};

export default function MyTickets() {
  const { language } = useLanguage();
  const { token } = useAuth();
  const copy = COPY[language] ?? COPY.en;

  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<number, Message[]>>({});

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch('/api/support/tickets', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setTickets(d?.tickets ?? []);
      })
      .catch(() => {
        if (!cancelled) setTickets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Transcripts are fetched on expand and then cached — a customer with twenty
  // tickets should not download twenty transcripts to look at one.
  const toggle = useCallback(
    async (id: number) => {
      if (openId === id) {
        setOpenId(null);
        return;
      }
      setOpenId(id);
      if (messages[id] || !token) return;
      const res = await fetch(`/api/support/tickets/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const d = await res.json();
        setMessages((m) => ({ ...m, [id]: d.messages ?? [] }));
      }
    },
    [openId, messages, token],
  );

  // Signed out, still loading, or genuinely no history — show nothing rather
  // than an empty shell.
  if (!token || tickets === null || tickets.length === 0) return null;

  return (
    <section className="max-w-3xl mx-auto mt-14 md:mt-20">
      <div className="flex items-center gap-2 mb-3 px-1">
        <Ticket size={14} className="text-[var(--muted)]" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          {copy.title}
        </h2>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="divide-y divide-[var(--border)]">
          {tickets.map((tk) => (
            <div key={tk.id}>
              <button
                onClick={() => toggle(tk.id)}
                className="w-full text-start px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold tabular-nums text-[var(--muted)]">{tk.ref}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[tk.status] ?? ''}`}
                    >
                      {copy[tk.status] ?? tk.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[15px] font-medium leading-snug text-[var(--text)] truncate">
                    {tk.subject}
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--muted)]">
                    {tk.message_count} {copy.messages}
                    {tk.agent ? ` · ${copy.handledBy} ${tk.agent}` : ''}
                  </p>
                </div>
                <ChevronDown
                  className={`shrink-0 w-4 h-4 text-[var(--muted)] transition-transform duration-300 ${
                    openId === tk.id ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence initial={false}>
                {openId === tk.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 space-y-3">
                      {(messages[tk.id] ?? []).map((m) => (
                        <div
                          key={m.id}
                          className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap ${
                              m.role === 'user'
                                ? 'bg-red-600 text-white'
                                : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]'
                            }`}
                          >
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
