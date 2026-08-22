'use client';

import { motion } from 'framer-motion';
import { Coins, FileText, LogIn, Sparkles } from 'lucide-react';

/**
 * Asks the user to approve spending a service credit before a roadmap is
 * built. Appears mid-conversation, so it has to explain itself in a glance.
 *
 * Three different questions were previously sharing one heading — "Use one
 * service credit?" was shown even when the real ask was "please sign in",
 * which reads as a non-sequitur. Each state now leads with its own question
 * and its own action.
 */

export type PendingConfirm = {
  service: string;
  location: string;
  creditsAvailable: number;
  nextExpiry: string | null;
  requiresAuth: boolean;
  documents: string[];
};

type Labels = {
  title: string;
  signinTitle: string;
  noneTitle: string;
  desc: string;
  balance: string;
  expiry: string;
  none: string;
  signin: string;
  signinCta: string;
  buy: string;
  confirm: string;
  cancel: string;
  documentsHeading: string;
  documentsMore: string;
};

export default function CreditConfirm({
  pending,
  labels,
  onCancel,
  onConfirm,
  onSignIn,
  onBuy,
}: {
  pending: PendingConfirm;
  labels: Labels;
  onCancel: () => void;
  onConfirm: () => void;
  onSignIn: () => void;
  onBuy: () => void;
}) {
  const mode = pending.requiresAuth
    ? 'auth'
    : pending.creditsAvailable > 0
      ? 'spend'
      : 'empty';

  const { icon, tone, title } = {
    auth: { icon: LogIn, tone: 'text-[var(--accent)]', title: labels.signinTitle },
    spend: { icon: Sparkles, tone: 'text-[var(--accent)]', title: labels.title },
    empty: { icon: Coins, tone: 'text-amber-500', title: labels.noneTitle },
  }[mode];
  const Icon = icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      role="dialog"
      aria-label={title}
      className="absolute bottom-24 left-1/2 z-[60] w-full max-w-[420px] -translate-x-1/2 px-4"
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_12px_40px_rgba(66,52,34,0.14)]">
        <div className="flex gap-3.5 px-5 pt-5 pb-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)]">
            <Icon size={17} className={tone} />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <h4 className="text-[15px] font-bold leading-snug tracking-tight text-[var(--text)]">
              {title}
            </h4>

            {mode === 'spend' && (
              <>
                {/* The subject of the purchase, stated plainly — you should not
                    have to reconstruct what you're paying for from a sentence. */}
                <p className="mt-2 text-[14px] font-semibold leading-snug text-[var(--text)]">
                  {pending.service}
                </p>
                <p className="text-[13px] text-[var(--muted)]">{pending.location}</p>
                {/* What they will actually have to gather. Shown before the
                    charge so nobody pays to find out they need paperwork they
                    cannot get. */}
                {pending.documents.length > 0 && (
                  <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/50 px-3 py-2.5">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                      {labels.documentsHeading}
                    </p>
                    <ul className="space-y-1">
                      {pending.documents.slice(0, 4).map((doc) => (
                        <li key={doc} className="flex items-start gap-1.5 text-[12.5px] leading-snug text-[var(--text)]">
                          <FileText size={12} className="mt-[3px] shrink-0 text-[var(--muted)]" />
                          <span>{doc}</span>
                        </li>
                      ))}
                    </ul>
                    {pending.documents.length > 4 && (
                      <p className="mt-1 pl-[18px] text-[11.5px] text-[var(--muted)]">
                        {labels.documentsMore.replace('{n}', String(pending.documents.length - 4))}
                      </p>
                    )}
                  </div>
                )}

                <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
                  {labels.balance.replace('{n}', String(pending.creditsAvailable))}
                </p>
                {pending.nextExpiry && (
                  <p className="mt-0.5 text-[11.5px] text-[var(--muted)]/75">
                    {labels.expiry.replace(
                      '{date}',
                      new Date(pending.nextExpiry).toLocaleDateString(),
                    )}
                  </p>
                )}
              </>
            )}

            {mode === 'auth' && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{labels.signin}</p>
            )}

            {mode === 'empty' && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">{labels.none}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-1 border-t border-[var(--border)] bg-[var(--surface-2)]/45 px-3 py-2.5">
          <button
            onClick={onCancel}
            className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
          >
            {labels.cancel}
          </button>
          <button
            onClick={mode === 'auth' ? onSignIn : mode === 'empty' ? onBuy : onConfirm}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
          >
            {mode === 'auth' ? labels.signinCta : mode === 'empty' ? labels.buy : labels.confirm}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
