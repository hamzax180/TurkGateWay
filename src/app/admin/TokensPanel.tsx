'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Coins, Clock } from 'lucide-react';
import { apiFetch } from '../utils/api';

/**
 * The credit statement — what came in, what went out, and on which service.
 *
 * In and out stay two columns rather than one net balance. A net figure would
 * answer neither of the questions this screen is for: which service is
 * consuming the credits, and whether a given account is spending more than it
 * bought. Those only show up side by side.
 */
export default function TokensPanel() {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch(`/api/admin/usage?days=${days}`);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const n = (v: unknown) => Number(v ?? 0).toLocaleString();
  const try_ = (minor: unknown) => `₺${(Number(minor ?? 0) / 100).toLocaleString()}`;

  /** 'visa_appointment' → 'Visa appointment'. */
  const serviceLabel = (s: string) =>
    (s ?? 'unknown').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              days === d
                ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                : 'text-[var(--muted)] border border-[var(--border)] hover:text-[var(--text)]'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Could not load the statement.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: 'Credits in',
                value: n(data.purchased?.credits),
                sub: `${n(data.purchased?.orders)} orders · ${try_(data.purchased?.revenueTryMinor)}`,
                Icon: ArrowDownLeft,
              },
              {
                label: 'Credits out',
                value: n((data.byService ?? []).reduce((a: number, r: any) => a + Number(r.credits ?? 0), 0)),
                sub: `in the last ${data.days} days`,
                Icon: ArrowUpRight,
              },
              {
                label: 'Available',
                value: n(data.balances?.available),
                sub: `${n(data.balances?.total)} ever issued`,
                Icon: Coins,
              },
              {
                label: 'Expired unused',
                value: n(data.balances?.expired),
                sub: 'bought, never spent',
                Icon: Clock,
              },
            ].map(({ label, value, sub, Icon }) => (
              <div key={label} className="glass-card p-4">
                <div className="flex items-center gap-2 text-[var(--muted)] mb-2">
                  <Icon size={14} />
                  <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
                </div>
                <p className="text-2xl font-bold text-[var(--text)]">{value}</p>
                <p className="text-[11px] text-[var(--muted)] mt-1">{sub}</p>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="glass-card p-5">
              <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest mb-4">
                Credits out — by service
              </p>
              <div className="space-y-1">
                {(data.byService ?? []).map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[13px] py-2 border-b border-[var(--border)] last:border-0"
                  >
                    <span className="text-[var(--text)] font-medium">{serviceLabel(r.service)}</span>
                    <span className="text-[var(--text)] tabular-nums font-bold">{n(r.credits)}</span>
                  </div>
                ))}
                {!(data.byService ?? []).length && (
                  <p className="text-[13px] text-[var(--muted)]">No credits spent in this period.</p>
                )}
              </div>
            </div>

            <div className="glass-card p-5">
              <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest mb-4">
                Credits out — by user
              </p>
              <div className="space-y-1">
                {(data.byUser ?? []).map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[13px] py-2 border-b border-[var(--border)] last:border-0"
                  >
                    <span className="text-[var(--text)] font-medium truncate max-w-[65%]">
                      {r.email ?? 'unknown'}
                    </span>
                    <span className="text-[var(--text)] tabular-nums font-bold">{n(r.spent)}</span>
                  </div>
                ))}
                {!(data.byUser ?? []).length && (
                  <p className="text-[13px] text-[var(--muted)]">No credits spent in this period.</p>
                )}
              </div>
            </div>
          </div>

          <div className="glass-card p-5">
            <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest mb-4">
              Recent credit spends
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-[var(--muted)] text-left">
                    <th className="pb-2 font-semibold">When</th>
                    <th className="pb-2 font-semibold">User</th>
                    <th className="pb-2 font-semibold">Service</th>
                    <th className="pb-2 font-semibold">Conversation</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.recent ?? []).map((r: any) => (
                    <tr key={r.id} className="border-t border-[var(--border)]">
                      <td className="py-2 text-[var(--muted)] whitespace-nowrap">
                        {r.at ? new Date(r.at).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 text-[var(--text)] truncate max-w-[180px]">
                        {r.email ?? 'unknown'}
                      </td>
                      <td className="py-2 text-[var(--text)]">{serviceLabel(r.service)}</td>
                      <td className="py-2 text-[var(--muted)] truncate max-w-[220px]">
                        {r.sessionTitle ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!(data.recent ?? []).length && (
                <p className="text-[13px] text-[var(--muted)] mt-2">
                  No credit has been spent yet.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
