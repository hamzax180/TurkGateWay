'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowLeft, RefreshCw, X, Users, Cpu, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import BackButton from '../components/BackButton';
import Footer from '../components/Footer';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { PLANS, plansByTier, minorToDecimalString, type PlanId } from '@/lib/plans';

const INDIVIDUAL_PLANS = plansByTier('individual');
const FAMILY_PLANS = plansByTier('family');

const PLAN_ICON: Record<PlanId, React.ReactNode> = {
  single: <Cpu className="text-white w-4 h-4 md:w-8 md:h-8" />,
  triple: <Cpu className="text-white w-4 h-4 md:w-8 md:h-8" />,
  six: <Cpu className="text-white w-4 h-4 md:w-8 md:h-8" />,
  family: <Users size={32} className="text-white" />,
  family_plus: <Users size={32} className="text-white" />,
  business: <Building2 size={32} className="text-white" />,
};

const PLAN_COLOR: Record<PlanId, string> = {
  single: 'bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]',
  triple: 'bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)]',
  six: 'bg-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.5)]',
  family: 'bg-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.5)]',
  family_plus: 'bg-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.5)]',
  business: 'bg-gray-800 shadow-[0_0_30px_rgba(31,41,55,0.5)]',
};

/** What each tier includes, beyond "N service credits" — shown as bullets. */
const PLAN_FEATURES: Record<PlanId, string[]> = {
  single: ['1 finalised roadmap', 'Valid for 12 months', 'All 3 AI Agents', 'EN, TR, AR, TM languages'],
  triple: ['3 finalised roadmaps', 'Valid for 12 months', 'All 3 AI Agents', 'Priority generation queue'],
  six: ['6 finalised roadmaps', 'Valid for 12 months', 'All 3 AI Agents', 'Priority generation queue', 'Best price per service'],
  family: ['5 finalised roadmaps total', 'Invite up to 4 people by email', 'Each member gets their own service', 'Valid for 12 months'],
  family_plus: ['10 finalised roadmaps total', 'Invite up to 9 people by email', 'Each member gets their own service', 'Valid for 12 months'],
  business: ['25 finalised roadmaps total', 'Invite up to 24 team members', 'Centralized usage overview', 'Valid for 12 months'],
};

function usd(minor: number): string {
  return `$${(minor / 100).toFixed(0)}`;
}
function tryFmt(minor: number): string {
  return `₺${(minor / 100).toFixed(0)}`;
}

export default function PricingPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [checkoutPlan, setCheckoutPlan] = useState<PlanId | null>(null);
  const [billingPlan, setBillingPlan] = useState<'individual' | 'family'>('individual');

  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!checkoutPlan) setIyzicoFormHtml(null);
  }, [checkoutPlan]);

  const handleBuyClick = async () => {
    if (!checkoutPlan) return;
    try {
      setIsSubscribing(true);
      const token = localStorage.getItem('permitops_token');
      if (!token) {
        setToast({ message: 'Please log in to checkout', type: 'error' });
        router.push('/login');
        return;
      }

      const res = await apiFetch(`/payment/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: checkoutPlan }),
      });
      if (res && res.ok) {
        const json = await res.json();
        if (json.status === 'success' && json.checkoutFormContent) {
          setIyzicoFormHtml(json.checkoutFormContent);
        } else {
          throw new Error(json.errorMessage || json.detail || 'Initialization failed');
        }
      } else {
        const detail = await res?.json().catch(() => null);
        throw new Error(detail?.detail || 'Payment server unreachable');
      }
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to start checkout', type: 'error' });
    } finally {
      setIsSubscribing(false);
    }
  };

  const renderCheckmark = () => <Check size={14} className="text-gray-400 mt-0.5 shrink-0" />;

  // ────────────────────────────────────────────────────────────
  // CHECKOUT SCREEN — one-time purchase, no billing-cycle toggle:
  // credits don't renew, they're bought once and spent over time.
  // ────────────────────────────────────────────────────────────
  if (checkoutPlan) {
    const plan = PLANS[checkoutPlan];
    // Flat VAT display, matching how iyzico settles — see minorToDecimalString.
    const tax = Math.round(plan.priceTryMinor * 0.20);
    const total = plan.priceTryMinor + tax;

    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-blue-500/30 pt-20 pb-24">
        <Navbar />
        <MobileMenuButton />
        <main className="max-w-2xl mx-auto px-6 pt-12">
          <button
            onClick={() => setCheckoutPlan(null)}
            className="mb-8 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={24} />
          </button>

          <h1 className="text-2xl font-semibold text-[var(--text)] mb-2">{plan.name}</h1>
          <p className="text-sm text-[var(--muted)] mb-8">{plan.tagline}</p>

          {/* Order details */}
          <div className="border border-[var(--border)] rounded-xl p-6 mb-6 bg-[var(--surface-1)]">
            <h2 className="font-semibold text-[var(--text)] mb-6">Order details</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between text-[var(--muted)]">
                <span>{plan.name}<br /><span className="text-[var(--text)]/50">{plan.credits} service credit{plan.credits > 1 ? 's' : ''} · one-time purchase</span></span>
                <span>{minorToDecimalString(plan.priceTryMinor)} TL</span>
              </div>
              <div className="h-px w-full bg-[var(--border)] my-2" />
              <div className="flex justify-between text-[var(--muted)]">
                <span>Subtotal</span>
                <span>{minorToDecimalString(plan.priceTryMinor)} TL</span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>Tax (VAT 20%)</span>
                <span>{minorToDecimalString(tax)} TL</span>
              </div>
              <div className="h-px w-full bg-[var(--border)] my-2" />
              <div className="flex justify-between font-semibold text-[var(--text)]">
                <span>Total due today</span>
                <span>{minorToDecimalString(total)} TL</span>
              </div>
            </div>

            <div className="mt-6 p-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--muted)] flex gap-3 leading-relaxed">
              <span className="shrink-0 w-4 h-4 rounded-full border border-gray-500 flex items-center justify-center font-serif italic text-[10px]">i</span>
              <span>
                One-time charge — no subscription, no auto-renewal. Your {plan.credits} credit{plan.credits > 1 ? 's' : ''} expire
                {' '}{new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toLocaleDateString()} if unused.
                {plan.invitableSeats > 0 && ' Invite people to your plan any time from Settings → Family.'}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          <div className="border border-[var(--border)] rounded-xl p-6 bg-[var(--surface-1)]">
            <h2 className="font-semibold text-[var(--text)] mb-6">Payment method</h2>

            {!iyzicoFormHtml ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Full name</label>
                  <input type="text" readOnly value={user?.fullName || 'Guest User'} className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Country or region</label>
                  <select className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none appearance-none">
                    <option>Türkiye</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)] mb-1.5">Address</label>
                  <input type="text" className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-blue-500" />
                </div>

                <button
                  onClick={handleBuyClick}
                  disabled={isSubscribing}
                  className="w-full mt-6 bg-[var(--text)] text-[var(--bg)] font-semibold rounded-lg py-3 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                >
                  {isSubscribing ? <RefreshCw size={18} className="animate-spin" /> : 'Proceed to Secure Checkout'}
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-lg p-2 mt-4" id="iyzico-form-container">
                <div dangerouslySetInnerHTML={{ __html: iyzicoFormHtml }} />
                <div id="iyzipay-checkout-form" className="responsive" />
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────
  // PRICING SCREEN — two separate ladders, 3 tiers each.
  // ────────────────────────────────────────────────────────────
  const shownPlans = billingPlan === 'individual' ? INDIVIDUAL_PLANS : FAMILY_PLANS;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-blue-500/30">
      <Navbar />
      <MobileMenuButton />

      <main className="pt-24 md:pt-32 pb-24 relative z-10 px-2 md:px-6 overflow-hidden">
        <div className="max-w-5xl mx-auto mb-6 px-2 md:px-0 relative z-10">
          <BackButton />
        </div>
        {/* Glow Effects */}
        <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
        <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none -z-10" />

        {/* Header */}
        <div className="text-center mb-6 md:mb-12">
          <h1 className="text-3xl md:text-5xl text-[var(--text)] mb-4 md:mb-8 font-serif tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Plan prices
          </h1>
          <p className="text-sm text-[var(--muted)] mb-6 max-w-xl mx-auto">
            Chat with every agent for free. Pay only when you want a finalised, step-by-step roadmap — one credit per service.
          </p>

          <div className="inline-flex items-center p-1 bg-[var(--surface-1)] rounded-xl border border-[var(--border)] shadow-inner">
            <button
              onClick={() => setBillingPlan('individual')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-colors ${billingPlan === 'individual' ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-sm border border-[var(--border)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
            >
              Individual
            </button>
            <button
              onClick={() => setBillingPlan('family')}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${billingPlan === 'family' ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-sm border border-[var(--border)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
            >
              Family
            </button>
          </div>
        </div>

        {/* Pricing Cards — same 3-card grid shape for both tabs */}
        <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-6">
          {shownPlans.map((plan) => (
            <div key={plan.id} className="bg-[var(--surface-1)] border border-[var(--border)] rounded-xl md:rounded-2xl p-4 md:p-8 flex flex-col">
              <div className="mb-3 md:mb-6 md:h-16 flex items-start">
                <div className="flex items-center gap-3 md:gap-4">
                  <div className={`relative shrink-0 h-10 w-10 md:h-16 md:w-16 rounded-lg md:rounded-2xl flex items-center justify-center ${PLAN_COLOR[plan.id]}`}>
                    {PLAN_ICON[plan.id]}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm md:text-base font-bold text-[var(--text)]">{plan.name}</span>
                    <span className="text-[10px] md:text-xs text-[var(--muted)]">{plan.credits} service{plan.credits > 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>

              <p className="text-[11px] md:text-sm text-[var(--muted)] mb-3 md:mb-6 leading-snug min-h-[2.25rem]">{plan.tagline}</p>

              <div className="flex items-baseline gap-2 mb-4 md:mb-8">
                <div className="text-2xl md:text-3xl font-semibold text-[var(--text)]">{usd(plan.priceUsdMinor)}</div>
                <div className="text-xs md:text-sm text-[var(--muted)]">/ {tryFmt(plan.priceTryMinor)}</div>
              </div>

              <button
                onClick={() => setCheckoutPlan(plan.id)}
                className="w-full py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] font-semibold text-[13px] md:text-sm mb-2 hover:opacity-90 transition-opacity"
              >
                Get {plan.name}
              </button>
              <p className="text-[9px] md:text-[10px] text-[var(--muted)] text-center mb-4 md:mb-5 font-medium">One-time purchase · no subscription</p>

              <div className="space-y-2 md:space-y-4 text-[12px] md:text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-4 md:pt-6">
                {PLAN_FEATURES[plan.id].map((f, i) => (
                  <div key={i} className="flex items-start gap-2 md:gap-3 leading-tight">
                    {renderCheckmark()} <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-[var(--muted)] mt-12 max-w-2xl mx-auto">
          *Chat is always free. Credits are spent only when you confirm building a roadmap, and never automatically.
          Prices shown don't include applicable tax. Prices and plans are subject to change at TurkGateway's discretion.
        </p>
      </main>

      <Footer />

      <AnimatePresence>
        {toast && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[200]">
            <motion.div
              initial={{ y: 50, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.8 }}
              className={`px-8 py-4 rounded-xl shadow-2xl flex items-center gap-4 border ${
                toast.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-500'
                  : 'bg-red-500/10 border-red-500/50 text-red-500'
              }`}
            >
              <span className="font-medium text-sm">{toast.message}</span>
              <button onClick={() => setToast(null)} className="ml-4 opacity-50 hover:opacity-100 transition-opacity">
                <X size={16} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
