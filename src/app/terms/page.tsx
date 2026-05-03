'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Gavel, FileText, Scale, Lock, Info, Shield,
  AlertTriangle, CreditCard, XCircle, Globe, ChevronRight, Check
} from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const sections = [
  { id: 'acceptance',      label: 'Acceptance of Terms',     icon: FileText,      color: 'blue'    },
  { id: 'ai-disclaimer',  label: 'AI Disclaimer',           icon: AlertTriangle, color: 'amber'   },
  { id: 'responsibilities',label: 'User Responsibilities',  icon: Shield,        color: 'emerald' },
  { id: 'payments',        label: 'Subscriptions & Payments', icon: CreditCard,  color: 'purple'  },
  { id: 'liability',       label: 'Limitation of Liability', icon: Scale,        color: 'orange'  },
  { id: 'ip',              label: 'Intellectual Property',   icon: Lock,         color: 'cyan'    },
  { id: 'termination',     label: 'Termination',             icon: XCircle,      color: 'rose'    },
  { id: 'governing',       label: 'Governing Law',           icon: Gavel,        color: 'indigo'  },
];

const C: Record<string, { bg: string; border: string; text: string; dot: string; light: string }> = {
  blue:    { bg:'bg-blue-500/10',    border:'border-blue-500/20',    text:'text-blue-600 dark:text-blue-400',       dot:'bg-blue-500',    light:'bg-blue-50 dark:bg-blue-500/10'       },
  amber:   { bg:'bg-amber-500/10',   border:'border-amber-500/20',   text:'text-amber-600 dark:text-amber-400',     dot:'bg-amber-500',   light:'bg-amber-50 dark:bg-amber-500/10'     },
  emerald: { bg:'bg-emerald-500/10', border:'border-emerald-500/20', text:'text-emerald-600 dark:text-emerald-400', dot:'bg-emerald-500', light:'bg-emerald-50 dark:bg-emerald-500/10' },
  purple:  { bg:'bg-purple-500/10',  border:'border-purple-500/20',  text:'text-purple-600 dark:text-purple-400',   dot:'bg-purple-500',  light:'bg-purple-50 dark:bg-purple-500/10'   },
  orange:  { bg:'bg-orange-500/10',  border:'border-orange-500/20',  text:'text-orange-600 dark:text-orange-400',   dot:'bg-orange-500',  light:'bg-orange-50 dark:bg-orange-500/10'   },
  cyan:    { bg:'bg-cyan-500/10',    border:'border-cyan-500/20',    text:'text-cyan-600 dark:text-cyan-400',       dot:'bg-cyan-500',    light:'bg-cyan-50 dark:bg-cyan-500/10'       },
  rose:    { bg:'bg-rose-500/10',    border:'border-rose-500/20',    text:'text-rose-600 dark:text-rose-400',       dot:'bg-rose-500',    light:'bg-rose-50 dark:bg-rose-500/10'       },
  indigo:  { bg:'bg-indigo-500/10',  border:'border-indigo-500/20',  text:'text-indigo-600 dark:text-indigo-400',   dot:'bg-indigo-500',  light:'bg-indigo-50 dark:bg-indigo-500/10'   },
};

export default function TermsPage() {
  const [activeSection, setActiveSection] = useState('acceptance');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActiveSection(e.target.id); }),
      { rootMargin: '-20% 0px -40% 0px' }
    );
    sections.forEach(({ id }) => { const el = document.getElementById(id); if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-blue-500/30">
      <Navbar />

      <div className="fixed inset-0 pointer-events-none z-0 hidden dark:block">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-blue-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 left-1/4 w-[400px] h-[400px] bg-indigo-600/5 rounded-full blur-[100px]" />
      </div>

      {/* Hero */}
      <div className="relative z-10 border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-28">
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 text-[var(--text)] leading-none">
              Terms of<br />Service
            </h1>
            <p className="text-lg text-[var(--muted)] leading-relaxed max-w-2xl mb-10">
              Please read these terms carefully before using the TurkGateway Agentic AI Platform. By accessing our services, you agree to be bound by these conditions.
            </p>

            <div className="mt-8 flex items-center gap-3 text-xs text-[var(--muted)] opacity-60">
              <Info size={12} />
              Last Updated: May 2026 · Effective immediately
            </div>
          </motion.div>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16 flex gap-12">

        {/* Sticky TOC */}
        <aside className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-28 space-y-1">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-[var(--muted)] opacity-60 mb-4">Contents</p>
            {sections.map(({ id, label, color }) => {
              const c = C[color];
              const isActive = activeSection === id;
              return (
                <button key={id} onClick={() => scrollTo(id)}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    isActive ? `${c.light} ${c.text} border ${c.border}` : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? c.dot : 'bg-[var(--muted)] opacity-40'}`} />
                  {label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 space-y-20 min-w-0 pb-96">

          <Section id="acceptance" color="blue" icon={FileText} title="1. Acceptance of Terms">
            <p className="text-[var(--muted)] leading-relaxed mb-4">
              TurkGateway (&quot;the Service&quot;) provides AI-driven administrative assistance for Turkish bureaucracy. By creating an account or using the platform, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy.
            </p>
            <p className="text-[var(--muted)] leading-relaxed mb-6">
              If you are using the Service on behalf of a company or legal entity, you represent that you have the authority to bind such entity to these terms. Minors under 18 may not use the Service without verifiable parental consent.
            </p>
            <div className={`p-4 rounded-xl ${C.blue.light} border ${C.blue.border}`}>
              <p className={`${C.blue.text} text-sm`}>
                <strong>Continued use</strong> of the platform after any Terms update constitutes acceptance of the revised terms. We recommend reviewing this page periodically.
              </p>
            </div>
          </Section>

          <Section id="ai-disclaimer" color="amber" icon={AlertTriangle} title="2. Nature of AI Advice">
            <div className={`p-5 rounded-2xl ${C.amber.light} border ${C.amber.border} mb-6`}>
              <p className={`${C.amber.text} font-bold text-sm mb-3 flex items-center gap-2`}>
                <AlertTriangle size={16} />
                IMPORTANT LEGAL DISCLAIMER
              </p>
              <p className="text-[var(--muted)] text-sm leading-relaxed mb-3">
                TurkGateway utilizes advanced Large Language Models (LLMs) and Retrieval-Augmented Generation (RAG) to provide information regarding Turkish laws, municipal protocols, and academic regulations.
              </p>
              <p className="text-[var(--muted)] text-sm leading-relaxed italic border-l-2 border-amber-400/40 pl-4">
                The information provided by our AI Agents (Permit, Student, Legal) does <strong>NOT</strong> constitute professional legal advice, financial advice, or official government determination.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: 'AI Accuracy Target', value: '~95%',        note: 'Not guaranteed' },
                { label: 'Regulatory Updates', value: 'Monthly',     note: 'Via compliance sync' },
                { label: 'Human Review',        value: 'Recommended', note: 'For binding decisions' },
              ].map(({ label, value, note }) => (
                <div key={label} className="p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)] text-center">
                  <p className={`text-xl font-black ${C.amber.text} mb-1`}>{value}</p>
                  <p className="text-[var(--text)] text-xs font-semibold">{label}</p>
                  <p className="text-[var(--muted)] text-[10px] mt-0.5">{note}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="responsibilities" color="emerald" icon={Shield} title="3. User Responsibilities">
            <p className="text-[var(--muted)] leading-relaxed mb-6">
              Users must provide accurate, up-to-date information when interacting with AI Agents. Misleading inputs may result in incorrect roadmap generation for which TurkGateway holds no liability.
            </p>
            <div className="space-y-3">
              {[
                { label: 'Lawful use only',       desc: 'You may not use the service for activities illegal under the laws of the Republic of Turkey.' },
                { label: 'No reverse engineering', desc: 'You may not attempt to reverse-engineer our Agentic workflows, Smart Router logic, or proprietary AI models.' },
                { label: 'Account security',       desc: 'You are responsible for maintaining the confidentiality of your account credentials and all activity under your account.' },
                { label: 'Accurate information',   desc: 'You must provide truthful information. Knowingly false inputs that trigger automated actions are your sole responsibility.' },
                { label: 'No automation abuse',    desc: 'You may not script or automate interactions with our platform beyond the provided RPA features.' },
              ].map(({ label, desc }) => (
                <div key={label} className="flex items-start gap-3 p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)]">
                  <div className={`w-5 h-5 rounded-full ${C.emerald.light} flex items-center justify-center shrink-0 mt-0.5`}>
                    <Check size={11} className={C.emerald.text} />
                  </div>
                  <div>
                    <p className="text-[var(--text)] font-semibold text-sm">{label}</p>
                    <p className="text-[var(--muted)] text-xs mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="payments" color="purple" icon={CreditCard} title="4. Subscriptions & Payments">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {[
                { plan: 'Free Plan',     features: ['5 AI queries/day', 'Basic roadmap', 'No RPA bot access'] },
                { plan: 'Premium Plan',  features: ['Unlimited AI queries', 'Full roadmap export', 'RPA bot automation', 'Priority support'] },
              ].map(({ plan, features }) => (
                <div key={plan} className="p-5 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)]">
                  <p className="text-[var(--text)] font-bold mb-3">{plan}</p>
                  <ul className="space-y-2">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-[var(--muted)]">
                        <Check size={11} className={C.purple.text} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
              Premium features are subject to subscription fees processed via <strong className="text-[var(--text)]">iyzico</strong> (PCI-DSS Level 1 certified). Subscriptions auto-renew monthly unless cancelled before the renewal date.
            </p>
            <div className={`p-4 rounded-xl ${C.purple.light} border ${C.purple.border}`}>
              <p className={`${C.purple.text} text-sm`}>
                <strong>Refund Policy:</strong> Fees are non-refundable except as required by Turkish Consumer Protection Law (Tüketici Kanunu No. 6502). Contact support within 14 days for eligibility review.
              </p>
            </div>
          </Section>

          <Section id="liability" color="orange" icon={Scale} title="5. Limitation of Liability">
            <div className={`p-5 rounded-2xl ${C.orange.light} border ${C.orange.border} mb-6`}>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                To the maximum extent permitted by applicable law, TurkGateway and its affiliates shall not be liable for any <strong className="text-[var(--text)]">indirect, incidental, special, or consequential damages</strong> resulting from:
              </p>
            </div>
            <ul className="space-y-3 mb-6">
              {[
                'Administrative delays, visa rejections, or municipal permit denials based on AI roadmap guidance.',
                'Government portal downtime preventing RPA bot completion.',
                'Changes in Turkish law or municipal regulations that render a roadmap outdated.',
                'Loss of business opportunity arising from reliance on AI-generated advice.',
                'Unauthorized access to your account due to your failure to maintain credential security.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-[var(--muted)]">
                  <ChevronRight size={14} className={`${C.orange.text} mt-0.5 shrink-0`} />
                  {item}
                </li>
              ))}
            </ul>
            <p className="text-[var(--muted)] text-xs opacity-70">
              Our total cumulative liability shall not exceed the amount you paid to TurkGateway in the 3 months preceding the claim.
            </p>
          </Section>

          <Section id="ip" color="cyan" icon={Lock} title="6. Intellectual Property">
            <p className="text-[var(--muted)] leading-relaxed mb-4">
              All content on the TurkGateway platform — including AI model weights, Smart Router logic, workflow schemas, UI design, and documentation — is the exclusive intellectual property of TurkGateway and protected under Turkish and international copyright law.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { own: 'You own',  items: ['Your personal data', 'Your uploaded documents', 'Roadmaps you export', 'Conversation history'] },
                { own: 'We own',   items: ['AI model logic', 'Platform code & design', 'Proprietary workflows', 'TurkGateway brand assets'] },
              ].map(({ own, items }) => (
                <div key={own} className="p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)]">
                  <p className="text-[var(--text)] font-bold text-sm mb-3">{own}</p>
                  <ul className="space-y-1.5">
                    {items.map((i) => (
                      <li key={i} className="text-xs text-[var(--muted)] flex items-center gap-2">
                        <span className={`w-1 h-1 rounded-full ${C.cyan.dot}`} />
                        {i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section id="termination" color="rose" icon={XCircle} title="7. Termination">
            <p className="text-[var(--muted)] leading-relaxed mb-6">
              You may terminate your account at any time via <strong className="text-[var(--text)]">Settings → Account → Delete Account</strong>. Upon termination, your personal data will be deleted within 60 days per our retention policy.
            </p>
            <p className="text-[var(--muted)] leading-relaxed mb-4">TurkGateway reserves the right to suspend or terminate accounts that:</p>
            <ul className="space-y-3">
              {[
                'Violate these Terms or applicable Turkish law.',
                'Engage in abusive, fraudulent, or harmful behavior toward other users or our systems.',
                'Attempt to circumvent payment obligations or abuse free tier limits.',
                'Provide materially false information during registration or AI interactions.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-[var(--muted)]">
                  <div className={`w-5 h-5 rounded-full ${C.rose.light} flex items-center justify-center shrink-0 mt-0.5`}>
                    <XCircle size={11} className={C.rose.text} />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="governing" color="indigo" icon={Gavel} title="8. Governing Law & Disputes">
            <div className={`flex items-start gap-4 p-5 rounded-2xl ${C.indigo.light} border ${C.indigo.border} mb-6`}>
              <Globe size={20} className={`${C.indigo.text} shrink-0 mt-0.5`} />
              <div>
                <p className="text-[var(--text)] font-semibold mb-2">Jurisdiction</p>
                <p className="text-[var(--muted)] text-sm leading-relaxed">
                  These Terms are governed exclusively by the laws of the <strong className="text-[var(--text)]">Republic of Turkey</strong>. Any disputes shall be subject to the exclusive jurisdiction of the <strong className="text-[var(--text)]">Istanbul Courts and Enforcement Offices</strong>.
                </p>
              </div>
            </div>
            <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
              Before initiating legal proceedings, you agree to first attempt resolution via our support team at <strong className="text-[var(--text)]">support@turkgateway.ai</strong>. We commit to responding to formal disputes within 10 business days.
            </p>
            <div className="p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)]">
              <p className="text-[var(--muted)] text-xs leading-relaxed">
                If any provision of these Terms is found to be unenforceable, the remaining provisions will continue in full force. These Terms constitute the entire agreement between you and TurkGateway regarding the Service.
              </p>
            </div>
          </Section>

        </div>
      </div>

      <Footer />
    </div>
  );
}

function Section({ id, color, icon: Icon, title, children }: { id: string; color: string; icon: any; title: string; children: React.ReactNode }) {
  const c = C[color];
  return (
    <motion.section id={id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.5 }} className="scroll-mt-28">
      <div className="flex items-center gap-4 mb-8">
        <div className={`w-10 h-10 rounded-xl ${c.light} border ${c.border} flex items-center justify-center`}>
          <Icon size={20} className={c.text} />
        </div>
        <h2 className="text-2xl font-bold text-[var(--text)]">{title}</h2>
      </div>
      {children}
    </motion.section>
  );
}
