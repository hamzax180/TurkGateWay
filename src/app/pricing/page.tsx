'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ShieldCheck, RefreshCw, ArrowRight, ChevronDown, Lock, Headphones, FileText, Zap, Users, Clock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../context/LanguageContext';
import Navbar from '../components/Navbar';
import { apiFetch } from '../utils/api';

/* ─── Component ────────────────────────────────────────────────────── */

export default function PricingPage() {
  const { t } = useLanguage();
  
  const FEATURES = [
    { label: t('pricing_feat_ai'), free: t('pricing_feat_limited'), premium: t('pricing_feat_unlimited') },
    { label: t('pricing_feat_sessions'), free: '1', premium: t('pricing_feat_unlimited') },
    { label: t('pricing_feat_history'), free: t('pricing_feat_7days'), premium: t('pricing_feat_unlimited') },
    { label: t('pricing_feat_docs'), free: false, premium: true },
    { label: t('pricing_feat_priority'), free: false, premium: true },
    { label: t('pricing_feat_support'), free: false, premium: true },
    { label: t('pricing_feat_access'), free: false, premium: true },
    { label: t('pricing_feat_multi'), free: true, premium: true },
    { label: t('pricing_feat_comm'), free: true, premium: true },
  ];

  const FAQ_DATA = [
    {
      q: t('pricing_faq_q1'),
      a: t('pricing_faq_a1')
    },
    {
      q: t('pricing_faq_q2'),
      a: t('pricing_faq_a2')
    },
    {
      q: t('pricing_faq_q3'),
      a: t('pricing_faq_a3')
    },
    {
      q: t('pricing_faq_q4'),
      a: t('pricing_faq_a4')
    },
  ];

  const TRUST_ITEMS = [
    { icon: Lock, label: t('pricing_trust_enc'), sub: 'TLS 1.3 + AES-256' },
    { icon: ShieldCheck, label: t('pricing_trust_pci'), sub: 'via iyzico' },
    { icon: Headphones, label: t('pricing_trust_supp'), sub: t('pricing_trust_resp') },
    { icon: Clock, label: t('pricing_trust_cancel'), sub: t('pricing_trust_lockin') },
  ];
  const router = useRouter();
  const [isYearly, setIsYearly] = useState(true);
  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const monthlyPrice = 299;
  const yearlyTotal = 3157;
  const yearlyMonthly = Math.round(yearlyTotal / 12);

  const displayPrice = isYearly ? yearlyMonthly : monthlyPrice;

  const handleSubscribe = async (planType: 'monthly' | 'yearly') => {
    try {
      setIsSubscribing(true);
      const token = localStorage.getItem('permitops_token');
      if (!token) {
        setToast({ message: 'Please log in to browse plans', type: 'error' });
        router.push('/login');
        return;
      }
      const planCode = planType === 'yearly' ? 'P66275815_YEARLY' : 'P66275815_MONTHLY';
      const res = await apiFetch(`/payment/subscribe?token=${token}&plan_code=${planCode}`, { method: 'POST' });
      if (res && res.ok) {
        const json = await res.json();
        if (json.status === 'success' && json.checkoutFormContent) {
          setIyzicoFormHtml(json.checkoutFormContent);
        } else {
          throw new Error(json.errorMessage || 'Initialization failed');
        }
      } else {
        throw new Error('Payment server unreachable');
      }
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to start subscription', type: 'error' });
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] font-sans">
      <Navbar />

      <main className="relative z-10">

        {/* ── Hero ── */}
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-14 text-center">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-4"
          >
            {t('navbar_pricing')}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-3xl md:text-[2.75rem] font-bold text-[var(--text)] leading-tight tracking-tight mb-4"
          >
            {t('pricing_title')}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-[var(--muted)] text-base max-w-lg mx-auto leading-relaxed"
          >
            {t('pricing_subtitle')}
          </motion.p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center gap-3 bg-[var(--surface)] border border-[var(--border)] rounded-full px-1.5 py-1.5 shadow-sm">
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${!isYearly ? 'bg-[var(--surface-2)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              {t('pricing_monthly')}
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${isYearly ? 'bg-[var(--surface-2)] text-[var(--text)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              {t('pricing_annual')}
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md">
                −12%
              </span>
            </button>
          </div>
        </section>

        {/* ── Plan Cards ── */}
        <section className="max-w-3xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Free Card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] p-7 shadow-sm"
            >
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted)] mb-3">{t('sidebar_free')}</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold text-[var(--text)]">₺0</span>
                  <span className="text-sm text-[var(--muted)]">/ {t('pricing_monthly_unit') || 'month'}</span>
                </div>
                <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
                  {t('pricing_free_desc')}
                </p>
              </div>

              <div className="flex-1 space-y-2.5 mb-7">
                {['Basic AI Permit Consultation', 'Standard Search Capability', 'Single Active Session', 'Community Support'].map(f => (
                  <div key={f} className="flex items-center gap-2.5">
                    <Check size={14} className="text-[var(--muted)] flex-shrink-0" strokeWidth={2} />
                    <span className="text-sm text-[var(--text)]">{f}</span>
                  </div>
                ))}
              </div>

              <button
                disabled
                className="w-full py-2.5 rounded-lg text-sm font-medium border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] cursor-not-allowed"
              >
                {t('pricing_current')}
              </button>
            </motion.div>

            {/* Premium Card */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="relative flex flex-col rounded-xl border-2 border-indigo-600 bg-[var(--surface)] p-7 shadow-lg"
            >
              {/* Popular badge */}
              <div className="absolute -top-3.5 left-6">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-600 text-white text-[11px] font-semibold shadow">
                  {t('pricing_most_popular')}
                </span>
              </div>

              <div className="mb-6 mt-1">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-indigo-500 mb-3">Premium</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-bold text-[var(--text)]">₺{displayPrice}</span>
                  <span className="text-sm text-[var(--muted)]">/ month</span>
                </div>
                {isYearly ? (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Billed as <strong className="text-[var(--text)]">₺{yearlyTotal}</strong>/year &nbsp;·&nbsp;
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium">Save ₺{(monthlyPrice * 12) - yearlyTotal}/yr</span>
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">Billed monthly</p>
                )}
                <p className="mt-3 text-sm text-[var(--muted)] leading-relaxed">
                  Full capabilities for businesses managing compliance at scale in Istanbul.
                </p>
              </div>

              <div className="flex-1 space-y-2.5 mb-7">
                {[
                  'Unlimited AI Permit Consultations',
                  'Priority Agent Workflows',
                  'Unlimited Project Histories',
                  'Advanced Document Management',
                  '1-on-1 Regulatory Support',
                  'Early Access to New Laws',
                ].map(f => (
                  <div key={f} className="flex items-center gap-2.5">
                    <div className="flex-shrink-0 w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                      <Check size={10} className="text-indigo-600 dark:text-indigo-400" strokeWidth={2.5} />
                    </div>
                    <span className="text-sm text-[var(--text)]">{f}</span>
                  </div>
                ))}
              </div>

              <button
                disabled={isSubscribing}
                onClick={() => handleSubscribe(isYearly ? 'yearly' : 'monthly')}
                className="w-full py-2.5 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center justify-center gap-2 shadow active:scale-[0.98]"
              >
                {isSubscribing ? (
                  <RefreshCw size={15} className="animate-spin" />
                ) : (
                  <>{t('pricing_upgrade')} <ArrowRight size={15} /></>
                )}
              </button>
            </motion.div>
          </div>
        </section>

        {/* ── Trust Bar ── */}
        <section className="border-y border-[var(--border)] bg-[var(--surface)] py-8">
          <div className="max-w-4xl mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {TRUST_ITEMS.map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0 p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                    <Icon size={15} />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text)]">{label}</p>
                    <p className="text-[11px] text-[var(--muted)]">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Feature Comparison Table ── */}
        <section className="max-w-3xl mx-auto px-6 py-16">
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">{t('pricing_compare')}</h2>
          <p className="text-sm text-[var(--muted)] mb-8">{t('pricing_compare_subtitle')}</p>

          <div className="rounded-xl border border-[var(--border)] overflow-hidden shadow-sm">
            {/* Table header */}
            <div className="grid grid-cols-3 bg-[var(--surface-2)] border-b border-[var(--border)] px-5 py-3">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider">{t('pricing_feat_label') || 'Feature'}</span>
              <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider text-center">{t('sidebar_free')}</span>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-center">{t('sidebar_upgrade')}</span>
            </div>

            {FEATURES.map((row, i) => (
              <div
                key={row.label}
                className={`grid grid-cols-3 px-5 py-3.5 border-b border-[var(--border)] last:border-0 ${i % 2 === 0 ? 'bg-[var(--surface)]' : 'bg-[var(--bg)]'}`}
              >
                <span className="text-sm text-[var(--text)]">{row.label}</span>
                <span className="text-center">
                  {row.free === true ? (
                    <Check size={16} className="mx-auto text-[var(--muted)]" strokeWidth={2} />
                  ) : row.free === false ? (
                    <X size={16} className="mx-auto text-[var(--muted)] opacity-30" strokeWidth={2} />
                  ) : (
                    <span className="text-xs text-[var(--muted)]">{row.free}</span>
                  )}
                </span>
                <span className="text-center">
                  {row.premium === true ? (
                    <div className="flex justify-center">
                      <div className="w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                        <Check size={11} className="text-indigo-600 dark:text-indigo-400" strokeWidth={2.5} />
                      </div>
                    </div>
                  ) : row.premium === false ? (
                    <X size={16} className="mx-auto text-[var(--muted)] opacity-30" strokeWidth={2} />
                  ) : (
                    <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">{row.premium}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="max-w-2xl mx-auto px-6 pb-20">
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">{t('pricing_faq_title')}</h2>
          <p className="text-sm text-[var(--muted)] mb-8">{t('pricing_faq_subtitle')} <a href="mailto:support@permitops.ai" className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium">{t('pricing_contact_us')}</a></p>

          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden shadow-sm">
            {FAQ_DATA.map((item: any, i: number) => (
              <div key={i} className="bg-[var(--surface)]">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[var(--surface-2)] transition-colors"
                >
                  <span className="text-sm font-medium text-[var(--text)] pr-4">{item.q}</span>
                  <ChevronDown
                    size={16}
                    className={`flex-shrink-0 text-[var(--muted)] transition-transform duration-200 ${openFaq === i ? 'rotate-180' : ''}`}
                  />
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-4 text-sm text-[var(--muted)] leading-relaxed">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ── */}
        <section className="border-t border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-2xl mx-auto px-6 py-16 text-center">
            <h2 className="text-xl font-bold text-[var(--text)] mb-2">{t('pricing_ready')}</h2>
            <p className="text-sm text-[var(--muted)] mb-6 max-w-sm mx-auto">{t('pricing_cta_subtitle')}</p>
            <button
              onClick={() => handleSubscribe(isYearly ? 'yearly' : 'monthly')}
              disabled={isSubscribing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors shadow active:scale-[0.98]"
            >
              {isSubscribing ? <RefreshCw size={15} className="animate-spin" /> : <>{t('pricing_get_started')} <ArrowRight size={15} /></>}
            </button>
            <p className="mt-4 text-xs text-[var(--muted)]">
              <ShieldCheck size={12} className="inline mr-1 text-emerald-500" />
              {t('pricing_secure_checkout')} · {t('pricing_cancel_anytime')} · {t('pricing_vat_included')}
            </p>
          </div>
        </section>
      </main>

      {/* ── iyzico Modal ── */}
      <AnimatePresence>
        {iyzicoFormHtml && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="bg-[var(--surface)] w-full max-w-xl rounded-xl shadow-2xl overflow-hidden flex flex-col border border-[var(--border)]"
              style={{ minHeight: '600px' }}
            >
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-[var(--text)]">Secure Checkout</h3>
                  <p className="text-xs text-[var(--muted)]">Complete your Premium subscription via iyzico</p>
                </div>
                <button onClick={() => setIyzicoFormHtml(null)} className="p-1.5 hover:bg-[var(--surface-2)] rounded-lg text-[var(--muted)] transition-colors">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4" id="iyzico-form-container">
                <div dangerouslySetInnerHTML={{ __html: iyzicoFormHtml }} />
                <div id="iyzipay-checkout-form" className="responsive" />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]">
            <motion.div
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 8, opacity: 0 }}
              className={`px-5 py-3 rounded-lg shadow-xl flex items-center gap-3 border text-sm font-medium bg-[var(--surface)] ${
                toast.type === 'success'
                  ? 'border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                  : 'border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400'
              }`}
            >
              {toast.type === 'success' ? <Check size={15} /> : <X size={15} />}
              {toast.message}
              <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70 transition-opacity">
                <X size={12} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
