'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Shield, Lock, Eye, Fingerprint, Database, Info,
  Server, Trash2, Bell, Globe, ChevronRight, Check
} from 'lucide-react';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import BackButton from '../components/BackButton';
import Footer from '../components/Footer';
import MobileToc from '../components/MobileToc';

const sections = [
  { id: 'kvkk',      label: 'KVKK Compliance',     icon: Shield,      color: 'emerald' },
  { id: 'collection',label: 'Data Collection',      icon: Database,    color: 'blue'    },
  { id: 'biometric', label: 'Document Data',        icon: Fingerprint, color: 'purple'  },
  { id: 'sharing',   label: 'Third-Party Sharing',  icon: Eye,         color: 'orange'  },
  { id: 'storage',   label: 'Data Storage',         icon: Server,      color: 'cyan'    },
  { id: 'rights',    label: 'Your Rights',          icon: Shield,      color: 'rose'    },
  { id: 'retention', label: 'Data Retention',       icon: Trash2,      color: 'amber'   },
  { id: 'updates',   label: 'Policy Updates',       icon: Bell,        color: 'indigo'  },
];

// Tailwind-safe color map
const C: Record<string, { bg: string; border: string; text: string; dot: string; light: string }> = {
  emerald: { bg:'bg-emerald-500/10', border:'border-emerald-500/20', text:'text-emerald-600 dark:text-emerald-400', dot:'bg-emerald-500', light:'bg-emerald-50 dark:bg-emerald-500/10' },
  blue:    { bg:'bg-blue-500/10',    border:'border-blue-500/20',    text:'text-blue-600 dark:text-blue-400',       dot:'bg-blue-500',    light:'bg-blue-50 dark:bg-blue-500/10'       },
  purple:  { bg:'bg-purple-500/10',  border:'border-purple-500/20',  text:'text-purple-600 dark:text-purple-400',   dot:'bg-purple-500',  light:'bg-purple-50 dark:bg-purple-500/10'   },
  orange:  { bg:'bg-orange-500/10',  border:'border-orange-500/20',  text:'text-orange-600 dark:text-orange-400',   dot:'bg-orange-500',  light:'bg-orange-50 dark:bg-orange-500/10'   },
  cyan:    { bg:'bg-cyan-500/10',    border:'border-cyan-500/20',    text:'text-cyan-600 dark:text-cyan-400',       dot:'bg-cyan-500',    light:'bg-cyan-50 dark:bg-cyan-500/10'       },
  rose:    { bg:'bg-rose-500/10',    border:'border-rose-500/20',    text:'text-rose-600 dark:text-rose-400',       dot:'bg-rose-500',    light:'bg-rose-50 dark:bg-rose-500/10'       },
  amber:   { bg:'bg-amber-500/10',   border:'border-amber-500/20',   text:'text-amber-600 dark:text-amber-400',     dot:'bg-amber-500',   light:'bg-amber-50 dark:bg-amber-500/10'     },
  indigo:  { bg:'bg-indigo-500/10',  border:'border-indigo-500/20',  text:'text-indigo-600 dark:text-indigo-400',   dot:'bg-indigo-500',  light:'bg-indigo-50 dark:bg-indigo-500/10'   },
};

export default function PrivacyPage() {
  const [activeSection, setActiveSection] = useState('kvkk');

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
    <div className="flex flex-col h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] selection:bg-emerald-500/30">
    <main id="privacy-scroll" className="flex-1 flex flex-col min-w-0 relative overflow-y-auto slim-scroll">
      <Navbar isAppPage />
      <MobileMenuButton />
      <MobileToc sections={sections} activeSection={activeSection} onSelect={scrollTo} C={C} scrollContainerId="privacy-scroll" />

      {/* Ambient glow — only visible in dark */}
      <div className="fixed inset-0 pointer-events-none z-0 hidden dark:block">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px]" />
      </div>

      {/* Hero */}
      <div className="relative z-10 border-b border-[var(--border)]">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-28">
          <BackButton className="mb-8" />
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 text-[var(--text)] leading-none">
              Privacy<br />Policy
            </h1>
            <p className="text-lg text-[var(--muted)] leading-relaxed max-w-2xl mb-10">
              At TurkGateway, your administrative data is treated as a matter of personal sovereignty. Our agency is built on data ephemerality, local-first storage, and zero-knowledge principles.
            </p>
            <div className="flex flex-wrap items-center gap-6">
              {['KVKK No. 6698 Compliant', 'AES-256 Encryption', 'Zero credential storage'].map((label) => (
                <div key={label} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                  <div className={`w-5 h-5 rounded-full ${C.emerald.light} flex items-center justify-center`}>
                    <Check size={11} className={C.emerald.text} />
                  </div>
                  {label}
                </div>
              ))}
            </div>
            <div className="mt-8 flex items-center gap-3 text-xs text-[var(--muted)] opacity-60">
              <Info size={12} />
              Last Updated: May 2026 · Version 3.0
            </div>
          </motion.div>
        </div>
      </div>

      {/* Body */}
      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16 flex flex-col lg:flex-row gap-8 lg:gap-12">

        {/* TOC — sticky sidebar on desktop, stacked + animated on mobile */}
        <motion.aside
          id="toc-full"
          className="w-full lg:w-56 lg:shrink-0"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } } }}
        >
          <div className="lg:sticky lg:top-28 space-y-1 border-b border-[var(--border)] pb-6 mb-2 lg:border-0 lg:pb-0 lg:mb-0">
            <motion.p
              variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
              className="text-[10px] font-bold tracking-[0.25em] uppercase text-[var(--muted)] opacity-60 mb-4"
            >Contents</motion.p>
            {sections.map(({ id, label, color }) => {
              const c = C[color];
              const isActive = activeSection === id;
              return (
                <motion.button key={id} onClick={() => scrollTo(id)}
                  variants={{ hidden: { opacity: 0, x: -16 }, show: { opacity: 1, x: 0 } }}
                  className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-200 ${
                    isActive ? `${c.light} ${c.text} border ${c.border}` : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
                  }`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? c.dot : 'bg-[var(--muted)] opacity-40'}`} />
                  {label}
                </motion.button>
              );
            })}
          </div>
        </motion.aside>

        {/* Content */}
        <div className="flex-1 space-y-20 min-w-0 pb-96">

          <Section id="kvkk" color="emerald" icon={Shield} title="KVKK Compliance">
            <p className="text-[var(--muted)] leading-relaxed mb-6">
              In accordance with the Turkish Personal Data Protection Law (<strong className="text-[var(--text)]">KVKK No. 6698</strong>), TurkGateway acts as a data processor for the information you provide during AI consultations. We implement rigorous technical and administrative measures to protect your sensitive data.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { title: 'Data Controller',       body: 'TurkGateway, registered under Turkish commercial law.' },
                { title: 'Legal Basis',            body: 'Explicit consent obtained at registration and renewed on material change.' },
                { title: 'DPO Contact',            body: 'privacy@turkgateway.ai — respond within 30 days per KVKK.' },
                { title: 'Supervisory Authority',  body: 'Kişisel Verileri Koruma Kurumu (KVKK Board), Ankara, Turkey.' },
              ].map(({ title, body }) => (
                <div key={title} className="p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)]">
                  <p className="text-[var(--text)] font-semibold text-sm mb-1">{title}</p>
                  <p className="text-[var(--muted)] text-sm">{body}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="collection" color="blue" icon={Database} title="Data Collection & Usage">
            <p className="text-[var(--muted)] leading-relaxed mb-6">We collect only the minimum data necessary to deliver your roadmap and automation services.</p>
            <div className="space-y-4">
              {[
                { num: '01', title: 'Conversational Data', body: 'Chat logs are stored primarily in your local browser (localStorage). When sent to our AI Agents, data is encrypted in transit and used strictly to generate your roadmap — not for training, profiling, or advertising.' },
                { num: '02', title: 'Identity Credentials (RPA)', body: 'When using our bot for e-Devlet or MERSİS synchronization, your T.C. Kimlik and password are held only in secure, stateless volatile memory for the duration of the automation task. We NEVER persist these credentials in any database.' },
                { num: '03', title: 'Account Data', body: 'Name, email address, and hashed password stored in our secure database (bcrypt, salted). Payment data is never stored — processed exclusively via iyzico PCI-DSS Level 1.' },
                { num: '04', title: 'Usage Analytics', body: 'Anonymous, aggregated session data (page views, feature usage) to improve the product. No personally identifiable information is included.' },
              ].map(({ num, title, body }) => (
                <div key={num} className={`flex gap-4 p-5 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] hover:${C.blue.border} transition-colors`}>
                  <span className={`text-2xl font-black ${C.blue.text} opacity-30 shrink-0 w-8`}>{num}</span>
                  <div>
                    <p className="text-[var(--text)] font-semibold mb-1.5">{title}</p>
                    <p className="text-[var(--muted)] text-sm leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="biometric" color="purple" icon={Fingerprint} title="Document & Biometric Data">
            <div className={`p-5 rounded-2xl ${C.purple.light} border ${C.purple.border} mb-6`}>
              <p className={`${C.purple.text} text-sm font-semibold mb-2`}>Security Standard</p>
              <p className="text-[var(--muted)] text-sm leading-relaxed">
                Documents you upload — such as a university acceptance letter — are stored in our managed PostgreSQL database, encrypted at rest by the database provider and sent over TLS in transit. They are readable only by the staff account that processes your application. We keep them for <strong className="text-[var(--text)]">no more than 30 days</strong>, and they are deleted as soon as your appointment is booked. You can ask us to delete them sooner at any time.
              </p>
            </div>
            <ul className="space-y-3">
              {[
                'Documents are auto-deleted 30 days after your session closes unless you request extended storage.',
                'Passport scans are never used for identity verification beyond the declared automation task.',
                'Face photos (if any) are processed locally and never sent to third-party facial recognition services.',
                'You may request immediate deletion of all uploaded documents at any time via Settings → Data.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-[var(--muted)]">
                  <Check size={14} className={`${C.purple.text} mt-0.5 shrink-0`} />
                  {item}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="sharing" color="orange" icon={Eye} title="Third-Party Data Sharing">
            <p className="text-[var(--muted)] leading-relaxed mb-6">TurkGateway does <strong className="text-[var(--text)]">NOT sell your data</strong> to marketers or data brokers. Data is only shared with:</p>
            <div className="space-y-3">
              {[
                { party: 'Turkish Government Portals', reason: 'Upon your explicit RPA command only (e-Devlet, MERSİS, e-İkamet).', safe: true },
                { party: 'iyzico Payment',             reason: 'Billing name and amount for subscription processing. PCI-DSS Level 1 certified.', safe: true },
                { party: 'Google Gemini AI',           reason: 'Anonymized query text via encrypted API. No PII sent. Data not used for training.', safe: true },
                { party: 'Cloud Infrastructure',       reason: 'AWS (Frankfurt EU region) for document storage. GDPR & KVKK compliant.', safe: true },
                { party: 'Third-party advertisers',    reason: 'Never. We do not have advertising partnerships.', safe: false },
              ].map(({ party, reason, safe }) => (
                <div key={party} className={`flex items-start gap-4 p-4 rounded-xl border ${safe ? 'bg-[var(--surface-1)] border-[var(--border)]' : 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20'}`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${safe ? 'bg-emerald-100 dark:bg-emerald-500/15' : 'bg-red-100 dark:bg-red-500/15'}`}>
                    {safe ? <Check size={12} className="text-emerald-600 dark:text-emerald-400" /> : <span className="text-red-500 text-xs font-black">x</span>}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold mb-0.5 ${safe ? 'text-[var(--text)]' : 'text-red-500'}`}>{party}</p>
                    <p className="text-[var(--muted)] text-xs">{reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section id="storage" color="cyan" icon={Server} title="Data Storage & Security">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              {[
                { stat: 'AES-256', label: 'Encryption at rest' },
                { stat: 'TLS 1.3', label: 'Encryption in transit' },
                { stat: 'EU-West', label: 'Data residency (Frankfurt)' },
              ].map(({ stat, label }) => (
                <div key={stat} className={`p-4 rounded-xl ${C.cyan.light} border ${C.cyan.border} text-center`}>
                  <p className={`text-2xl font-black ${C.cyan.text} mb-1`}>{stat}</p>
                  <p className="text-[var(--muted)] text-xs">{label}</p>
                </div>
              ))}
            </div>
            <p className="text-[var(--muted)] text-sm leading-relaxed">
              Our infrastructure is hosted on AWS EU-West (Frankfurt), ensuring data stays within the European Economic Area. We undergo annual penetration testing and maintain SOC 2 Type II compliance. All access to production databases is logged, audited, and requires multi-factor authentication.
            </p>
          </Section>

          <Section id="rights" color="rose" icon={Shield} title="Your Rights Under KVKK">
            <p className="text-[var(--muted)] leading-relaxed mb-6">Under KVKK Article 11, you have the following rights which you can exercise at any time:</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { right: 'Right to Access',      desc: 'Request a copy of all personal data we hold about you.' },
                { right: 'Right to Rectification', desc: 'Correct any inaccurate or incomplete personal data.' },
                { right: 'Right to Erasure',     desc: 'Request deletion of all your data ("right to be forgotten").' },
                { right: 'Right to Portability', desc: 'Export your data in a structured, machine-readable format (JSON).' },
                { right: 'Right to Object',      desc: 'Object to processing of your data for automated decision-making.' },
                { right: 'Right to Restrict',    desc: 'Limit how we process your data while a dispute is resolved.' },
              ].map(({ right, desc }) => (
                <div key={right} className={`p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)] hover:${C.rose.border} transition-colors`}>
                  <p className="text-[var(--text)] font-semibold text-sm mb-1">{right}</p>
                  <p className="text-[var(--muted)] text-xs">{desc}</p>
                </div>
              ))}
            </div>
            <p className="text-[var(--muted)] text-xs mt-6 opacity-70">
              To exercise any right, go to <strong>Settings → Data & Privacy</strong> or email <strong>privacy@turkgateway.ai</strong>. We respond within 30 days as required by law.
            </p>
          </Section>

          <Section id="retention" color="amber" icon={Trash2} title="Data Retention">
            <div className="space-y-3">
              {[
                { type: 'Chat conversation history',       period: '90 days',                  note: 'Then permanently deleted unless you opt-in to extended storage.' },
                { type: 'Uploaded documents',              period: '30 days',                  note: 'Auto-deleted after session expiry. Delete instantly from Settings.' },
                { type: 'Account data',                    period: 'Account lifetime + 60 days', note: 'Deleted within 60 days of account closure.' },
                { type: 'Payment records',                 period: '10 years',                 note: 'Required by Turkish Tax Law (VUK). Stored by iyzico, not us.' },
                { type: 'RPA credentials (TCKN/password)', period: 'Session only',             note: 'Never written to disk. Zeroed from memory immediately after bot completes.' },
              ].map(({ type, period, note }) => (
                <div key={type} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-[var(--surface-1)] border border-[var(--border)]">
                  <div className="flex-1">
                    <p className="text-[var(--text)] text-sm font-medium">{type}</p>
                    <p className="text-[var(--muted)] text-xs mt-0.5">{note}</p>
                  </div>
                  <span className={`shrink-0 px-3 py-1 rounded-full ${C.amber.light} border ${C.amber.border} ${C.amber.text} text-xs font-bold`}>{period}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section id="updates" color="indigo" icon={Bell} title="Policy Updates">
            <p className="text-[var(--muted)] leading-relaxed mb-4">When we make material changes to this Privacy Policy, we will:</p>
            <ul className="space-y-3 mb-6">
              {[
                'Display a prominent in-app banner for 14 days before changes take effect.',
                'Send an email notification to your registered address.',
                'Maintain an archived version of all previous policies for transparency.',
                'Require re-consent for any new processing purpose not covered by your original consent.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-[var(--muted)]">
                  <ChevronRight size={14} className={`${C.indigo.text} mt-0.5 shrink-0`} />
                  {item}
                </li>
              ))}
            </ul>
            <div className={`p-4 rounded-xl ${C.indigo.light} border ${C.indigo.border} flex items-center gap-3`}>
              <Globe size={16} className={`${C.indigo.text} shrink-0`} />
              <p className="text-[var(--muted)] text-sm">This policy is governed by Turkish law. Disputes fall under the jurisdiction of Istanbul courts.</p>
            </div>
          </Section>

        </div>
      </div>

      <Footer />
    </main>

      <style jsx global>{`
        .slim-scroll::-webkit-scrollbar { width: 6px; }
        .slim-scroll::-webkit-scrollbar-track { background: transparent; }
        .slim-scroll::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
        .slim-scroll::-webkit-scrollbar-thumb:hover { background: var(--border-2); }
      `}</style>
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
