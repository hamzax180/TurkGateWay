'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, ShieldCheck, RefreshCw, ArrowRight, ChevronDown, Lock, Headphones, FileText, Zap, Users, Clock, CreditCard, Sparkles, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '../context/LanguageContext';
import Navbar from '../components/Navbar';
import { apiFetch } from '../utils/api';

export default function PricingPage() {
  const { t } = useLanguage();
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

  const FEATURES = [
    { label: t('pricing_feat_ai') || 'Unlimited AI Consultations', free: 'Basic', premium: 'Unlimited' },
    { label: t('pricing_feat_sessions') || 'Active Sessions', free: '1', premium: 'Unlimited' },
    { label: t('pricing_feat_history') || 'Project History', free: '7 Days', premium: 'Lifetime' },
    { label: t('pricing_feat_docs') || 'Advanced Doc Management', free: false, premium: true },
    { label: t('pricing_feat_priority') || 'Priority Workflows', free: false, premium: true },
    { label: t('pricing_feat_support') || 'Regulatory Support', free: false, premium: true },
    { label: t('pricing_feat_compliance') || 'MERSİS/e-Devlet Integration', free: false, premium: true },
    { label: t('pricing_feat_updates') || 'Early Legal Updates', free: true, premium: true },
  ];

  const TRUST_ITEMS = [
    { icon: Lock, label: 'Secure Encryption', sub: '256-bit SSL Protection' },
    { icon: ShieldCheck, label: 'Verified Payments', sub: 'Secured by iyzico' },
    { icon: Headphones, label: 'Expert Support', sub: '24/7 Response Time' },
    { icon: Clock, label: 'No Commitment', sub: 'Cancel Anytime' },
  ];

  const FAQ_DATA = [
    { q: t('pricing_faq_q1') || 'Is there a free trial?', a: t('pricing_faq_a1') || 'Yes, the Free plan allows you to explore basic permit requirements without any credit card.' },
    { q: t('pricing_faq_q2') || 'What payment methods do you accept?', a: t('pricing_faq_a2') || 'We accept all major credit and debit cards through our secure payment partner, iyzico.' },
    { q: t('pricing_faq_q3') || 'Can I change plans later?', a: t('pricing_faq_a3') || 'Absolutely! You can upgrade to Premium or cancel your subscription at any time from your dashboard.' },
    { q: t('pricing_faq_q4') || 'Is my data secure?', a: t('pricing_faq_a4') || 'We use banking-grade encryption and follow strict Turkish data protection (KVKK) protocols.' },
  ];

  const handleSubscribe = async (planType: 'monthly' | 'yearly') => {
    try {
      setIsSubscribing(true);
      const token = localStorage.getItem('TurkGateway_token');
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
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-indigo-500/30">
      <Navbar />

      {/* Decorative background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-indigo-500/10 blur-[120px] rounded-full" />
        <div className="absolute top-[20%] -right-[10%] w-[35%] h-[35%] bg-purple-500/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative z-10 pt-20">
        
        {/* Hero Section */}
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-[var(--text)] to-[var(--text)]/60">
              {t('pricing_title') || 'Simple Pricing for Every Business'}
            </h1>
            <p className="text-[var(--muted)] text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              {t('pricing_subtitle') || 'Start for free and scale as your regulatory needs grow. No hidden fees, just pure AI efficiency.'}
            </p>
          </motion.div>

          {/* Billing Toggle */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="mt-12 flex flex-col items-center"
          >
            <div className="inline-flex items-center p-1 bg-[var(--surface-1)] border border-[var(--border)] rounded-full shadow-inner">
              <button
                onClick={() => setIsYearly(false)}
                className={`px-8 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 ${!isYearly ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-md' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
              >
                {t('pricing_monthly') || 'Monthly'}
              </button>
              <button
                onClick={() => setIsYearly(true)}
                className={`px-8 py-2.5 rounded-full text-sm font-semibold transition-all duration-300 flex items-center gap-2 ${isYearly ? 'bg-indigo-600 text-white shadow-lg' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
              >
                {t('pricing_annual') || 'Annual'}
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${isYearly ? 'bg-white/20' : 'bg-emerald-500/10 text-emerald-500'}`}>
                  SAVE 12%
                </span>
              </button>
            </div>
          </motion.div>
        </section>

        {/* Pricing Cards */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12 max-w-5xl mx-auto">
            
            {/* Free Plan */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="group relative flex flex-col p-8 rounded-[32px] bg-[var(--surface-1)] border border-[var(--border)] hover:border-[var(--border-2)] transition-all duration-300 shadow-xl"
            >
              <div className="mb-8">
                <h3 className="text-xl font-bold mb-2">{t('sidebar_free') || 'Free'}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-5xl font-bold">₺0</span>
                  <span className="text-[var(--muted)] text-sm">/ {t('pricing_monthly_unit') || 'mo'}</span>
                </div>
                <p className="text-sm text-[var(--muted)] leading-relaxed">
                  Perfect for individuals exploring permit requirements and basic regulations.
                </p>
              </div>

              <div className="space-y-4 mb-10 flex-1">
                {['Basic AI Consultations', '1 Active Session', '7-Day History', 'Community Access', 'Web Platform'].map((feat) => (
                  <div key={feat} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-[var(--surface-2)] flex items-center justify-center border border-[var(--border)]">
                      <Check size={12} className="text-[var(--muted)]" />
                    </div>
                    <span className="text-sm text-[var(--text)]/80">{feat}</span>
                  </div>
                ))}
                {['Advanced Reports', 'Priority Support'].map((feat) => (
                  <div key={feat} className="flex items-center gap-3 opacity-40">
                    <div className="w-5 h-5 rounded-full bg-[var(--surface-2)] flex items-center justify-center border border-[var(--border)]">
                      <X size={12} className="text-[var(--muted)]" />
                    </div>
                    <span className="text-sm text-[var(--text)]/80 line-through">{feat}</span>
                  </div>
                ))}
              </div>

              <button
                disabled
                className="w-full py-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] font-bold text-sm cursor-not-allowed"
              >
                {t('pricing_current') || 'Current Plan'}
              </button>
            </motion.div>

            {/* Premium Plan */}
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.6 }}
              className="group relative flex flex-col p-8 rounded-[32px] bg-gradient-to-b from-indigo-600 to-indigo-700 text-white shadow-[0_20px_50px_-12px_rgba(79,70,229,0.5)] transform hover:-translate-y-1 transition-all duration-300"
            >
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-white text-indigo-600 text-[11px] font-black uppercase tracking-wider shadow-xl flex items-center gap-1.5">
                <Star size={12} fill="currentColor" />
                {t('pricing_most_popular') || 'Most Popular'}
              </div>

              <div className="mb-8">
                <h3 className="text-xl font-bold mb-2">Premium</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-5xl font-bold">₺{displayPrice}</span>
                  <span className="text-white/60 text-sm">/ mo</span>
                </div>
                {isYearly ? (
                  <div className="inline-block px-2 py-1 rounded bg-white/10 text-[10px] font-bold uppercase tracking-wider">
                    Billed as ₺{yearlyTotal}/year (Save ₺{(monthlyPrice * 12) - yearlyTotal})
                  </div>
                ) : (
                  <div className="text-white/60 text-xs font-medium">Billed monthly</div>
                )}
                <p className="text-sm text-white/80 leading-relaxed mt-4">
                  Full capabilities for businesses managing high-stakes compliance and expansion in Turkey.
                </p>
              </div>

              <div className="space-y-4 mb-10 flex-1">
                {[
                  'Unlimited AI Consultations',
                  'Priority Agent Workflows',
                  'Lifetime Project History',
                  'Advanced Doc Processing',
                  'Expert Regulatory Support',
                  'MERSİS/e-Devlet Integration',
                  'Priority Feature Access'
                ].map((feat) => (
                  <div key={feat} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center">
                      <Check size={12} className="text-white" strokeWidth={3} />
                    </div>
                    <span className="text-sm font-medium text-white">{feat}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleSubscribe(isYearly ? 'yearly' : 'monthly')}
                disabled={isSubscribing}
                className="w-full py-4 rounded-2xl bg-white text-indigo-600 hover:bg-white/90 font-bold text-sm shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                {isSubscribing ? <RefreshCw size={18} className="animate-spin" /> : <>{t('pricing_upgrade') || 'Upgrade to Premium'} <ArrowRight size={18} /></>}
              </button>
            </motion.div>
          </div>
        </section>

        {/* Trust Section */}
        <section className="py-20 bg-[var(--surface-1)] border-y border-[var(--border)]">
          <div className="max-w-6xl mx-auto px-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-12">
              {TRUST_ITEMS.map(({ icon: Icon, label, sub }) => (
                <div key={label} className="flex flex-col items-center text-center gap-4 group">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300">
                    <Icon size={24} />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold mb-1">{label}</h4>
                    <p className="text-xs text-[var(--muted)]">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Detailed Comparison */}
        <section className="max-w-5xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">{t('pricing_compare') || 'Compare Plans'}</h2>
            <p className="text-[var(--muted)]">{t('pricing_compare_subtitle') || 'Everything you need to know about TurkGateway features.'}</p>
          </div>

          <div className="rounded-[32px] border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden shadow-2xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                  <th className="px-8 py-6 text-xs font-black uppercase tracking-widest text-[var(--muted)]">{t('pricing_feat_label') || 'Feature'}</th>
                  <th className="px-8 py-6 text-xs font-black uppercase tracking-widest text-center text-[var(--muted)]">Free</th>
                  <th className="px-8 py-6 text-xs font-black uppercase tracking-widest text-center text-indigo-500">Premium</th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((row, i) => (
                  <tr key={row.label} className={`border-b border-[var(--border)] last:border-0 ${i % 2 === 0 ? 'bg-transparent' : 'bg-[var(--surface-2)]/30'}`}>
                    <td className="px-8 py-5 text-sm font-medium">{row.label}</td>
                    <td className="px-8 py-5 text-center">
                      {row.free === true ? <Check size={18} className="mx-auto text-emerald-500" /> : row.free === false ? <X size={18} className="mx-auto text-[var(--muted)]/30" /> : <span className="text-xs font-bold text-[var(--muted)]">{row.free}</span>}
                    </td>
                    <td className="px-8 py-5 text-center">
                      {row.premium === true ? <div className="w-6 h-6 rounded-full bg-indigo-500/20 flex items-center justify-center mx-auto"><Check size={14} className="text-indigo-500" strokeWidth={3} /></div> : <span className="text-sm font-black text-indigo-500">{row.premium}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="max-w-3xl mx-auto px-6 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold mb-4">{t('pricing_faq_title') || 'Frequently Asked Questions'}</h2>
            <p className="text-[var(--muted)]">
              {t('pricing_faq_subtitle') || 'Have more questions?'} <a href="mailto:support@turkgateway.ai" className="text-indigo-500 hover:underline font-bold">Contact our support team</a>
            </p>
          </div>

          <div className="space-y-4">
            {FAQ_DATA.map((item, i) => (
              <div key={i} className={`rounded-2xl border transition-all duration-300 ${openFaq === i ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-[var(--border)] bg-[var(--surface-1)]'}`}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-6 py-5 text-left"
                >
                  <span className="font-bold text-sm md:text-base">{item.q}</span>
                  <ChevronDown size={20} className={`text-[var(--muted)] transition-transform duration-300 ${openFaq === i ? 'rotate-180 text-indigo-500' : ''}`} />
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 text-sm md:text-base text-[var(--muted)] leading-relaxed">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="max-w-5xl mx-auto px-6 py-24">
          <div className="relative rounded-[48px] bg-gradient-to-br from-indigo-600 via-indigo-600 to-purple-700 p-12 md:p-20 text-center overflow-hidden shadow-2xl">
            <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-96 h-96 bg-white/10 blur-[100px] rounded-full" />
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-black text-white mb-6 leading-tight">
                {t('pricing_cta_title') || 'Ready to simplify your Turkish business expansion?'}
              </h2>
              <p className="text-white/80 text-lg mb-10 max-w-2xl mx-auto">
                Join hundreds of businesses using TurkGateway to automate their regulatory compliance.
              </p>
              <div className="flex flex-col md:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => handleSubscribe(isYearly ? 'yearly' : 'monthly')}
                  disabled={isSubscribing}
                  className="px-10 py-5 rounded-2xl bg-white text-indigo-600 font-black text-lg shadow-2xl hover:bg-white/90 transition-all active:scale-[0.98] min-w-[240px]"
                >
                  {isSubscribing ? <RefreshCw size={24} className="animate-spin" /> : (t('pricing_get_started') || 'Get Started Now')}
                </button>
              </div>
              <div className="mt-8 flex items-center justify-center gap-6 text-white/60 text-[10px] md:text-xs font-bold uppercase tracking-[0.2em]">
                <div className="flex items-center gap-1.5"><ShieldCheck size={14} /> SECURE IYZICO CHECKOUT</div>
                <div className="flex items-center gap-1.5"><RefreshCw size={14} /> CANCEL ANYTIME</div>
                <div className="flex items-center gap-1.5"><CreditCard size={14} /> VAT INCLUDED</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* iyzico Modal */}
      <AnimatePresence>
        {iyzicoFormHtml && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIyzicoFormHtml(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md" 
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-[var(--surface-1)] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col border border-[var(--border)] h-[80vh]"
            >
              <div className="px-8 py-6 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-2)]">
                <div>
                  <h3 className="font-black text-lg tracking-tight">Secure Payment Gateway</h3>
                  <p className="text-xs text-[var(--muted)] font-bold uppercase tracking-wider">Transaction secured by iyzico & TurkGateway</p>
                </div>
                <button onClick={() => setIyzicoFormHtml(null)} className="p-2 hover:bg-red-500 hover:text-white rounded-xl transition-all">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8" id="iyzico-form-container">
                <div dangerouslySetInnerHTML={{ __html: iyzicoFormHtml }} />
                <div id="iyzipay-checkout-form" className="responsive" />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Toast */}
      <AnimatePresence>
        {toast && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200]">
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.8 }}
              className={`px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-4 border-2 ${
                toast.type === 'success'
                  ? 'bg-emerald-500 border-emerald-400 text-white'
                  : 'bg-red-500 border-red-400 text-white'
              }`}
            >
              {toast.type === 'success' ? <Check size={20} strokeWidth={3} /> : <X size={20} strokeWidth={3} />}
              <span className="font-bold tracking-tight">{toast.message}</span>
              <button onClick={() => setToast(null)} className="ml-4 opacity-50 hover:opacity-100 transition-opacity">
                <X size={16} strokeWidth={3} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
