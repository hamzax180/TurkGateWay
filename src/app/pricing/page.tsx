'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ArrowLeft, RefreshCw, X, Building, GraduationCap, Scale, Cpu, Users, Building2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/AuthContext';

export default function PricingPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [checkoutPlan, setCheckoutPlan] = useState<'premium' | 'max' | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [billingPlan, setBillingPlan] = useState<'individual' | 'team'>('individual');
  
  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Close iyzico form if user navigates back
  useEffect(() => {
    if (!checkoutPlan) setIyzicoFormHtml(null);
  }, [checkoutPlan]);

  const handleSubscribeClick = async () => {
    try {
      setIsSubscribing(true);
      const token = localStorage.getItem('permitops_token');
      if (!token) {
        setToast({ message: 'Please log in to checkout', type: 'error' });
        router.push('/login');
        return;
      }
      
      const planCode = checkoutPlan === 'premium' 
        ? (billingCycle === 'yearly' ? 'P66275815_YEARLY' : 'P66275815_MONTHLY')
        : (billingCycle === 'yearly' ? 'MAX_YEARLY' : 'MAX_MONTHLY');

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

  const premiumMonthly = 300;
  const premiumYearly = 1000;
  const maxMonthly = 400;
  const maxYearly = 1500;

  const subtotal = checkoutPlan === 'premium' ? (billingCycle === 'yearly' ? premiumYearly : premiumMonthly) : (billingCycle === 'yearly' ? maxYearly : maxMonthly);
  const tax = Math.round(subtotal * 0.20); // 20% VAT
  const total = subtotal + tax;

  const renderCheckmark = () => <Check size={14} className="text-gray-400 mt-0.5 shrink-0" />;

  // ────────────────────────────────────────────────────────────
  // CHECKOUT SCREEN (Image 2 Match)
  // ────────────────────────────────────────────────────────────
  if (checkoutPlan) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-blue-500/30 pt-20 pb-24">
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 pt-12">
          <button 
            onClick={() => setCheckoutPlan(null)}
            className="mb-8 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            <ArrowLeft size={24} />
          </button>

          <h1 className="text-2xl font-semibold text-[var(--text)] mb-8 capitalize">{checkoutPlan} plan</h1>

          {/* Cycle Toggles */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`p-4 rounded-xl border text-left transition-all ${billingCycle === 'monthly' ? 'bg-[var(--surface-2)] border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,1)]' : 'bg-[var(--surface-1)] border-[var(--border)] hover:border-gray-500'}`}
            >
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${billingCycle === 'monthly' ? 'border-blue-500' : 'border-gray-500'}`}>
                  {billingCycle === 'monthly' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                </div>
                <span className="font-semibold text-[var(--text)]">Monthly</span>
              </div>
              <div className="pl-7 text-sm text-[var(--muted)]">
                TL {checkoutPlan === 'premium' ? premiumMonthly : maxMonthly}.00/month + tax
              </div>
            </button>

            <button
              onClick={() => setBillingCycle('yearly')}
              className={`relative p-4 rounded-xl border text-left transition-all ${billingCycle === 'yearly' ? 'bg-blue-500/5 border-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,1)]' : 'bg-[var(--surface-1)] border-[var(--border)] hover:border-gray-500'}`}
            >
              <div className="absolute top-3 right-3 text-[10px] font-bold bg-blue-600/30 text-blue-500 px-2 py-0.5 rounded-sm">Save 12%</div>
              <div className="flex items-center gap-3 mb-2">
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${billingCycle === 'yearly' ? 'border-blue-500' : 'border-gray-500'}`}>
                  {billingCycle === 'yearly' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                </div>
                <span className="font-semibold text-[var(--text)]">Yearly</span>
              </div>
              <div className="pl-7 text-sm text-[var(--muted)]">
                TL {checkoutPlan === 'premium' ? premiumYearly : maxYearly}.00/year + tax
              </div>
            </button>
          </div>

          {/* Order details */}
          <div className="border border-[var(--border)] rounded-xl p-6 mb-6 bg-[var(--surface-1)]">
            <h2 className="font-semibold text-[var(--text)] mb-6">Order details</h2>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between text-[var(--muted)]">
                <span><span className="capitalize">{checkoutPlan}</span> plan<br/><span className="text-[var(--text)]/50">{billingCycle === 'yearly' ? 'Annually' : 'Monthly'}</span></span>
                <span>TL {subtotal}</span>
              </div>
              <div className="h-px w-full bg-[var(--border)] my-2" />
              <div className="flex justify-between text-[var(--muted)]">
                <span>Subtotal</span>
                <span>TL {subtotal}</span>
              </div>
              <div className="flex justify-between text-[var(--muted)]">
                <span>Tax (VAT 20%)</span>
                <span>TL {tax}</span>
              </div>
              <div className="h-px w-full bg-[var(--border)] my-2" />
              <div className="flex justify-between font-semibold text-[var(--text)]">
                <span>Total due today</span>
                <span>TL {total}</span>
              </div>
            </div>
            
            <div className="mt-6 p-4 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--muted)] flex gap-3 leading-relaxed">
              <span className="shrink-0 w-4 h-4 rounded-full border border-gray-500 flex items-center justify-center font-serif italic text-[10px]">i</span>
              <span>Your subscription will auto renew on {new Date(Date.now() + (billingCycle === 'yearly' ? 365 : 30) * 24 * 60 * 60 * 1000).toLocaleDateString()}. You will be charged TL {subtotal}.00/{billingCycle === 'yearly' ? 'year' : 'month'} + tax.</span>
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
                  onClick={handleSubscribeClick}
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
  // PRICING SCREEN (Image 1 Match)
  // ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans selection:bg-blue-500/30">
      <Navbar />

      <main className="pt-32 pb-24 relative z-10 px-6 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none -z-10" />
        <div className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none -z-10" />
        
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl text-[var(--text)] mb-8 font-serif tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
            Plan prices
          </h1>
          
          <div className="inline-flex items-center p-1 bg-[var(--surface-1)] rounded-xl border border-[var(--border)] shadow-inner">
            <button 
              onClick={() => setBillingPlan('individual')}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-colors ${billingPlan === 'individual' ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-sm border border-[var(--border)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
            >
              Individual
            </button>
            <button 
              onClick={() => setBillingPlan('team')}
              className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${billingPlan === 'team' ? 'bg-[var(--surface-3)] text-[var(--text)] shadow-sm border border-[var(--border)]' : 'text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
            >
              Team and Enterprise
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        {billingPlan === 'individual' ? (
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Free Card */}
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-8 flex flex-col">
            <div className="mb-6 h-16 flex items-start">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.5)]">
                  <Cpu size={32} className="text-white animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-[var(--text)]">Monthly</span>
                  <span className="text-xs text-[var(--muted)]">Standard plan</span>
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-[var(--text)] mb-1">Free</h2>
            <p className="text-sm text-[var(--muted)] mb-6">Meet TurkGateway</p>
            
            <div className="text-3xl font-semibold text-[var(--text)] mb-8">₺0</div>
            
            <button disabled className="w-full py-2.5 rounded-lg border border-[var(--border)] text-[var(--muted)] font-medium text-sm mb-8 bg-[var(--surface-2)]">
              Use TurkGateway for free
            </button>

            <div className="space-y-4 text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-6">
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Chat on web, iOS, and Android</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Basic access to all 3 AI Agents</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Standard residency & permit roadmaps</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Multi-language support (EN, TR, AR)</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Built-in web search for legal updates</span></div>
            </div>
          </div>

          {/* Pro Card */}
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-8 flex flex-col relative">
            <div className="mb-6 h-16 flex justify-between items-start">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center bg-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.5)]">
                  <Cpu size={32} className="text-white animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-[var(--text)]">Monthly</span>
                  <span className="text-xs text-[var(--muted)]">Best value</span>
                </div>
              </div>
            </div>
            
            <h2 className="text-2xl font-semibold text-[var(--text)] mb-1">Premium</h2>
            <p className="text-sm text-[var(--muted)] mb-6">Advanced AI guidance for Turkish procedures</p>
            
            <div className="flex items-baseline gap-2 mb-8">
              <div className="text-3xl font-semibold text-[var(--text)]">₺{premiumMonthly}</div>
              <div className="text-[10px] text-[var(--muted)] flex flex-col">
                <span>TL / month</span>
                <span>billed monthly</span>
              </div>
            </div>
            
            <button onClick={() => setCheckoutPlan('premium')} className="w-full py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] font-semibold text-sm mb-2 hover:opacity-90 transition-opacity">
              Get Premium plan
            </button>
            <p className="text-[9px] text-[var(--muted)] text-center mb-5 font-medium">No commitment · Cancel anytime</p>

            <div className="space-y-4 text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-6">
              <p className="font-semibold text-[var(--text)] text-xs mb-2">Everything in Free and:</p>
              <div className="flex items-start gap-3">{renderCheckmark()} <span className="font-medium text-[var(--text)]">Desktop App (Zero latency & Voice mode)</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Unlimited tokens</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Automated document review & translation</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>AI Agent filling & generating official docs</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Advanced legal deep-dives</span></div>
            </div>
          </div>

          {/* Max Card */}
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-8 flex flex-col">
            <div className="mb-6 h-16 flex items-start">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center bg-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.5)]">
                  <Cpu size={32} className="text-white animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-[var(--text)]">Yearly</span>
                  <span className="text-xs text-[var(--muted)]">Maximum power</span>
                </div>
              </div>
            </div>
            
            <h2 className="text-2xl font-semibold text-[var(--text)] mb-1">Max</h2>
            <p className="text-sm text-[var(--muted)] mb-6">Unlimited tokens forever</p>
            
            <div className="flex items-baseline gap-2 mb-8">
              <div className="text-3xl font-semibold text-[var(--text)]">₺{maxYearly}</div>
              <div className="text-[10px] text-[var(--muted)] flex flex-col">
                <span>TL / year</span>
                <span>billed annually</span>
              </div>
            </div>

            <button onClick={() => setCheckoutPlan('max')} className="w-full py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] font-semibold text-sm mb-2 hover:opacity-90 transition-opacity">
              Get Max plan
            </button>
            <p className="text-[9px] text-[var(--muted)] text-center mb-5 font-medium">No commitment · Cancel anytime</p>

            <div className="space-y-4 text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-6">
              <p className="font-semibold text-[var(--text)] text-xs mb-2">Everything in Premium, plus:</p>
              <div className="flex items-start gap-3">{renderCheckmark()} <span className="font-medium text-[var(--text)] text-blue-400">Unlimited tokens forever</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Full application management & submission</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Unlimited AI Agent consultations</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Dedicated account manager</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>VIP priority processing</span></div>
            </div>
          </div>

        </div>
        ) : (
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Team Card */}
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-8 flex flex-col relative">
            <div className="mb-6 h-16 flex items-start">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center bg-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.5)]">
                  <Users size={32} className="text-white animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-[var(--text)]">Team</span>
                  <span className="text-xs text-[var(--muted)]">Shared workspace</span>
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-[var(--text)] mb-1">Business</h2>
            <p className="text-sm text-[var(--muted)] mb-6">For growing teams & agencies</p>
            
            <div className="flex items-baseline gap-2 mb-8">
              <div className="text-3xl font-semibold text-[var(--text)]">₺4990</div>
              <div className="text-[10px] text-[var(--muted)] flex flex-col">
                <span>TL / month</span>
                <span>billed annually</span>
              </div>
            </div>
            
            <button className="w-full py-2.5 rounded-lg bg-[var(--text)] text-[var(--bg)] font-semibold text-sm mb-8 hover:opacity-90 transition-opacity">
              Start Team Trial
            </button>

            <div className="space-y-4 text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-6">
              <p className="font-semibold text-[var(--text)] text-xs mb-2">Everything in Premium, plus:</p>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Centralized admin dashboard</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Shared team document storage</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Unlimited sub-accounts (up to 5)</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Consolidated monthly billing</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>API access (10k requests)</span></div>
            </div>
          </div>

          {/* Enterprise Card */}
          <div className="bg-[var(--surface-1)] border border-[var(--border)] rounded-2xl p-8 flex flex-col">
            <div className="mb-6 h-16 flex items-start">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0 h-16 w-16 rounded-2xl flex items-center justify-center bg-gray-800 shadow-[0_0_30px_rgba(31,41,55,0.5)]">
                  <Building2 size={32} className="text-white animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-base font-bold text-[var(--text)]">Enterprise</span>
                  <span className="text-xs text-[var(--muted)]">Custom solutions</span>
                </div>
              </div>
            </div>
            <h2 className="text-2xl font-semibold text-[var(--text)] mb-1">Custom</h2>
            <p className="text-sm text-[var(--muted)] mb-6">Scale without limits</p>
            
            <div className="text-3xl font-semibold text-[var(--text)] mb-8">Let's talk</div>
            
            <button className="w-full py-2.5 rounded-lg border border-[var(--border)] text-[var(--text)] font-semibold text-sm mb-8 hover:bg-[var(--surface-2)] transition-colors">
              Contact Sales
            </button>

            <div className="space-y-4 text-[13px] text-[var(--muted)] flex-1 border-t border-[var(--border)] pt-6">
              <p className="font-semibold text-[var(--text)] text-xs mb-2">Everything in Team, plus:</p>
              <div className="flex items-start gap-3">{renderCheckmark()} <span className="font-medium text-[var(--text)]">Custom AI Model fine-tuning</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>White-label platform integration</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Dedicated Slack/Teams channel</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>On-premise deployment options</span></div>
              <div className="flex items-start gap-3">{renderCheckmark()} <span>Custom compliance reporting</span></div>
            </div>
          </div>
        </div>
        )}

        <p className="text-center text-[11px] text-[var(--muted)] mt-12 max-w-2xl mx-auto">
          *Usage limits apply. Prices shown don't include applicable tax. Prices and plans are subject to change at TurkGateway's discretion.
        </p>

      </main>
      
      <Footer />

      {/* Custom Toast */}
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
