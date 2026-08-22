'use client';

import { Check, Circle, FileText, Loader2, PartyPopper, Upload } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Live progress for a visa appointment application, rendered inline in the
 * chat stream.
 *
 * The intake is conversational — the applicant answers questions one at a time
 * over many turns — which on its own gives them no sense of how far along they
 * are or what is left. This is that missing feedback: what has been captured,
 * what is still outstanding, whether the supporting document arrived, and a
 * clear finish state.
 *
 * It shows field *names* only. The answers are passport-level details and
 * never leave the server, so there is nothing sensitive to render here even
 * if someone is screen-sharing.
 */

/**
 * How many outstanding items to list. The agent only asks for a few details
 * per turn, so the next few are the actionable part — a full 18-row list is a
 * wall of text that buries it and makes the application feel endless.
 */
const MISSING_SHOWN = 5;

export type VisaIntakeState = {
  collected: string[];
  missing: string[];
  documentAttached: boolean;
  status: string;
};

type Copy = {
  title: string;
  progress: string;
  needed: string;
  document: string;
  documentAttached: string;
  documentMissing: string;
  andMore: string;
  ready: string;
  readyBody: string;
};

const COPY: Record<string, Copy> = {
  en: {
    title: 'Your visa application',
    progress: '{done} of {total} details collected',
    needed: 'Still needed',
    document: 'Acceptance letter',
    documentAttached: 'Attached',
    documentMissing: 'Not attached yet',
    andMore: '+{n} more after that',
    ready: 'Application complete',
    readyBody: "We have everything. We'll book your appointment and email you the confirmation.",
  },
  tr: {
    title: 'Vize başvurunuz',
    progress: '{total} bilgiden {done} tanesi alındı',
    needed: 'Hâlâ gerekli',
    document: 'Kabul mektubu',
    documentAttached: 'Eklendi',
    documentMissing: 'Henüz eklenmedi',
    andMore: 'sonrasında {n} tane daha',
    ready: 'Başvuru tamamlandı',
    readyBody: 'Her şey tamam. Randevunuzu alıp onayı e-posta ile göndereceğiz.',
  },
  ar: {
    title: 'طلب التأشيرة الخاص بك',
    progress: 'تم جمع {done} من {total} من التفاصيل',
    needed: 'لا يزال مطلوباً',
    document: 'خطاب القبول',
    documentAttached: 'تم إرفاقه',
    documentMissing: 'لم يتم إرفاقه بعد',
    andMore: 'و{n} أخرى بعد ذلك',
    ready: 'اكتمل الطلب',
    readyBody: 'لدينا كل شيء. سنحجز موعدك ونرسل لك التأكيد عبر البريد الإلكتروني.',
  },
  tk: {
    title: 'Wiza arzaňyz',
    progress: '{total} maglumatdan {done} sanysy alyndy',
    needed: 'Ýene gerek',
    document: 'Kabul haty',
    documentAttached: 'Goşuldy',
    documentMissing: 'Heniz goşulmady',
    andMore: 'ondan soň ýene {n} sany',
    ready: 'Arza doly',
    readyBody: 'Hemme zat taýýar. Duşuşygyňyzy belläp, tassyklamany e-poçta bilen ibereris.',
  },
};

export default function VisaIntakeCard({
  state,
  language = 'en',
  onAttach,
}: {
  state: VisaIntakeState;
  language?: string;
  onAttach?: () => void;
}) {
  const t = COPY[language] ?? COPY.en;
  const done = state.collected.length;
  const total = done + state.missing.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const isReady = state.status === 'ready' || (state.missing.length === 0 && state.documentAttached);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
      className="my-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden"
    >
      {/* Heading + progress */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h4 className="text-[14px] font-bold text-[var(--text)]">{t.title}</h4>
          <span className="text-[12px] font-medium text-[var(--muted)] shrink-0">
            {t.progress.replace('{done}', String(done)).replace('{total}', String(total))}
          </span>
        </div>
        <div
          className="h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <motion.div
            className="h-full rounded-full bg-indigo-500"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </div>
      </div>

      {/* Everything still outstanding. Collected rows are summarised rather
          than listed in full — a 20-row wall of ticks buries the useful part,
          which is what the applicant still has to do. */}
      {state.missing.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)] mb-2">
            {t.needed}
          </p>
          <ul className="space-y-1.5">
            {state.missing.slice(0, MISSING_SHOWN).map((label) => (
              <li key={label} className="flex items-start gap-2 text-[13px] text-[var(--text)]">
                <Circle size={13} className="mt-[3px] shrink-0 text-[var(--muted)]" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
          {state.missing.length > MISSING_SHOWN && (
            <p className="text-[12px] text-[var(--muted)] mt-1.5 pl-[21px]">
              {t.andMore.replace('{n}', String(state.missing.length - MISSING_SHOWN))}
            </p>
          )}
        </div>
      )}

      {done > 0 && state.missing.length > 0 && (
        <div className="px-4 pb-3 flex items-center gap-2 text-[12px] text-[var(--muted)]">
          <Check size={13} className="text-emerald-500 shrink-0" />
          <span>
            {state.collected.slice(0, 3).join(', ')}
            {state.collected.length > 3 ? ` +${state.collected.length - 3}` : ''}
          </span>
        </div>
      )}

      {/* Supporting document */}
      <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2.5">
        <FileText size={15} className={state.documentAttached ? 'text-emerald-500' : 'text-[var(--muted)]'} />
        <span className="text-[13px] text-[var(--text)] flex-1 min-w-0 truncate">{t.document}</span>
        {state.documentAttached ? (
          <span className="text-[12px] font-medium text-emerald-500 shrink-0">{t.documentAttached}</span>
        ) : onAttach ? (
          <button
            onClick={onAttach}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-500 hover:text-indigo-400 transition-colors shrink-0"
          >
            <Upload size={13} />
            {t.documentMissing}
          </button>
        ) : (
          <span className="text-[12px] text-[var(--muted)] shrink-0">{t.documentMissing}</span>
        )}
      </div>

      {/* Finish state */}
      {isReady && (
        <div className="px-4 py-3 border-t border-[var(--border)] bg-emerald-500/5 flex items-start gap-2.5">
          <PartyPopper size={16} className="text-emerald-500 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-emerald-600 dark:text-emerald-400">{t.ready}</p>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed mt-0.5">{t.readyBody}</p>
          </div>
        </div>
      )}

      {state.status === 'in_progress' && (
        <div className="px-4 py-3 border-t border-[var(--border)] flex items-center gap-2.5">
          <Loader2 size={15} className="text-indigo-500 animate-spin shrink-0" />
          <span className="text-[13px] text-[var(--muted)]">Booking your appointment…</span>
        </div>
      )}
    </motion.div>
  );
}
