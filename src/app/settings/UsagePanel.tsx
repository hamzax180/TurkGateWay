'use client';

import { useEffect, useState } from 'react';
import { Coins, MessageSquare, Clock } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../context/LanguageContext';

/**
 * The customer's own credit statement: what they have, and what it went on.
 *
 * Not the admin view with a filter. No revenue or cost figure appears here —
 * what the platform earns is our number, not theirs.
 *
 * Questions and credits are shown as two separate balances because the product
 * genuinely has two, and running them together is what made "how many credits
 * do I have" ambiguous enough to be worth asking support about.
 */
export default function UsagePanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/usage')
      .then(async (r) => {
        if (cancelled || !r?.ok) return;
        setData(await r.json());
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-[var(--muted)]">{t('usage_loading')}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">{t('usage_unavailable')}</p>;

  const n = (v: unknown) => Number(v ?? 0).toLocaleString();
  const q = data.questions ?? {};
  const c = data.credits ?? {};

  const serviceLabel = (s: string) =>
    (s ?? '').replace(/_/g, ' ').replace(/^./, (ch) => ch.toUpperCase());

  const refresh = q.refreshesAt ? new Date(q.refreshesAt) : null;
  const refreshText = q.refreshDue
    ? t('usage_refresh_due')
    : refresh
      ? `${t('usage_refreshes')} ${refresh.toLocaleString()}`
      : '';

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-[var(--muted)] mb-2">
            <MessageSquare size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t('usage_questions')}
            </span>
          </div>
          <p className="text-2xl font-bold text-[var(--text)]">
            {n(q.remaining)}
            <span className="text-sm font-medium text-[var(--muted)]"> / {n(q.allowance)}</span>
          </p>
          <p className="text-[11px] text-[var(--muted)] mt-1 flex items-center gap-1">
            <Clock size={11} /> {refreshText}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
          <div className="flex items-center gap-2 text-[var(--muted)] mb-2">
            <Coins size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t('usage_credits')}
            </span>
          </div>
          <p className="text-2xl font-bold text-[var(--text)]">{n(c.available)}</p>
          <p className="text-[11px] text-[var(--muted)] mt-1">
            {n(c.purchased)} {t('usage_in')} · {n(c.spent)} {t('usage_out')}
          </p>
        </div>
      </div>

      {/* Where the credits went */}
      <div>
        <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest mb-3">
          {t('usage_by_service')}
        </p>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border)]">
          {(data.byService ?? []).map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
              <span className="text-[var(--text)] font-medium">{serviceLabel(r.service)}</span>
              <span className="text-[var(--text)] tabular-nums font-bold">{n(r.credits)}</span>
            </div>
          ))}
          {!(data.byService ?? []).length && (
            <p className="px-4 py-3 text-[13px] text-[var(--muted)]">{t('usage_none')}</p>
          )}
        </div>
      </div>

      {/* The statement — one line per credit, in and out */}
      {(data.history ?? []).length > 0 && (
        <div>
          <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest mb-3">
            {t('usage_credit_history')}
          </p>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-1)] divide-y divide-[var(--border)]">
            {data.history.map((r: any) => {
              const spent = Boolean(r.consumedAt);
              const expired = !spent && new Date(r.expiresAt) <= new Date();
              return (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 text-[13px] gap-3">
                  <span className="text-[var(--text)] min-w-0">
                    {spent
                      ? `${t('usage_credit_used')} · ${serviceLabel(r.service)}`
                      : expired
                        ? t('usage_credit_expired')
                        : t('usage_credit_available')}
                    <span className="text-[var(--muted)]">
                      {' '}
                      · {new Date(r.consumedAt ?? r.grantedAt).toLocaleDateString()}
                    </span>
                  </span>
                  <span
                    className={`text-[11px] font-black uppercase tracking-widest shrink-0 ${
                      spent ? 'text-[var(--muted)]' : expired ? 'text-red-400' : 'text-emerald-500'
                    }`}
                  >
                    {spent ? '−1' : expired ? '0' : '+1'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-[11px] text-[var(--muted)]">{t('usage_footnote')}</p>
    </div>
  );
}
