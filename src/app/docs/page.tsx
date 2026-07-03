'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Terminal, Server, ShieldCheck, Database, Network, Cpu, Code2,
  ChevronRight, BookOpen, Layers, Fingerprint, Lock, ChevronLeft, Github,
  Scale, Globe, GraduationCap, Building2, FileText, ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import MobileToc from '../components/MobileToc';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Footer from '../components/Footer';

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

export default function DocumentationPage() {
  const { t, isRTL } = useLanguage();
  const { token } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('architecture');

  const sections = [
    { id: 'architecture', title: t('docs_sec_architecture'), icon: Network,       color: 'blue'    },
    { id: 'smart-router', title: t('docs_sec_router'),       icon: Cpu,           color: 'amber'   },
    { id: 'permit-api',   title: t('docs_sec_permit'),       icon: Building2,     color: 'emerald' },
    { id: 'student',      title: t('docs_sec_student'),      icon: GraduationCap, color: 'purple'  },
    { id: 'legal-engine', title: t('docs_sec_legal'),        icon: Scale,         color: 'orange'  },
    { id: 'terms',        title: t('docs_sec_terms'),        icon: FileText,      color: 'rose'    },
    { id: 'privacy',      title: t('docs_sec_privacy'),      icon: Lock,          color: 'indigo'  },
    { id: 'resources',    title: t('docs_sec_resources'),    icon: Globe,         color: 'emerald' },
  ];

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        // Find the first intersecting entry and set it as active
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveSection(e.target.id);
        });
      },
      { rootMargin: '-20% 0px -40% 0px' }
    );

    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-blue-500/30 font-sans overflow-hidden transition-colors duration-500" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Background Decor */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/5 blur-[120px] rounded-full" />
      </div>

      <Sidebar
        currentSessionId={null}
        assistantType="permit"
        onSessionSelect={(id) => {
          localStorage.setItem('permitops_active_session_id', id);
          window.location.href = '/chat';
        }}
        onNewChat={() => {
          window.location.href = '/chat?new=true';
        }}
        onDeleteSession={() => { }}
        onToggleFavorite={() => { }}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main id="docs-scroll" className="flex-1 flex flex-col min-w-0 relative overflow-y-auto slim-scroll z-10">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />

        {/* Mobile floating Contents bar — pins under navbar on scroll (matches Terms/Privacy) */}
        <MobileToc
          sections={sections.map(s => ({ id: s.id, label: s.title, color: s.color }))}
          activeSection={activeSection}
          onSelect={scrollTo}
          C={C}
          scrollContainerId="docs-scroll"
        />

        {/* Page Header — full width, above Contents + content (matches Terms/Privacy) */}
        <div className="w-full relative px-6 md:px-16 pt-16 max-w-[1400px] mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <Link href="/help" className="inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] hover:text-[var(--text)] transition-colors mb-6 group">
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> {t('docs_back')}
            </Link>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-8 bg-gradient-to-br from-[var(--text)] to-[var(--text)]/60 bg-clip-text text-transparent">
              {t('docs_title')}
            </h1>
            <p className="text-xl text-[var(--muted)] leading-relaxed max-w-2xl font-medium">
              {t('docs_subtitle')}
            </p>
          </motion.div>
        </div>

        <div className="w-full relative px-6 md:px-16 pt-10 pb-16 flex flex-col lg:flex-row gap-12 max-w-[1400px] mx-auto">

          {/* Contents Nav — stacked at top on mobile, sticky sidebar on desktop */}
          <aside id="toc-full" className="w-full lg:w-56 lg:shrink-0 h-fit lg:sticky lg:top-16">
            <div className="space-y-1 border-b border-[var(--border)] pb-6 mb-2 lg:border-0 lg:pb-0 lg:mb-0">
              <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-[var(--muted)] opacity-60 mb-4">{isRTL ? 'المحتويات' : t('docs_sec_architecture') === 'بنية النظام' ? 'المحتويات' : 'Contents'}</p>
              {sections.map(section => {
                const c = C[section.color];
                const isActive = activeSection === section.id;

                return (
                  <button
                    key={section.id}
                    onClick={() => scrollTo(section.id)}
                    className={`w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? `${c.light} ${c.text} border ${c.border}`
                        : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-all ${
                      isActive ? c.dot : 'bg-[var(--muted)] opacity-40 group-hover:opacity-100'
                    }`} />
                    {section.title}
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Main Content */}
          <article className="flex-1 max-w-4xl space-y-32 pb-32">

            {/* Architecture Section */}
            <section id="architecture" className="scroll-mt-24">
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-[var(--border)] pb-6">
                <Network className="text-[var(--accent)]" size={28} /> System Architecture
              </h2>
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium">
                TurkGateway operates on a specialized multi-agent architecture. Instead of relying on a single monolithic LLM, user requests are intercepted and routed to strictly scoped agents.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div id="architecture-micro" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:shadow-xl transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 mb-6 group-hover:scale-110 transition-transform">
                    <Server size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-4">Micro-Agent Deployment</h3>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    Three distinct agents (Permit, Student, Legal) operate independently. Each is initialized with a specific system prompt containing distinct operational schemas and state management rules.
                  </p>
                </div>
                <div id="architecture-state" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:shadow-xl transition-all duration-300 group">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 mb-6 group-hover:scale-110 transition-transform">
                    <Layers size={24} />
                  </div>
                  <h3 className="text-xl font-bold mb-4">Stateful Workflows</h3>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    Conversations are not stateless. The backend maintains a `PermitState` and `ConversationState` object, tracking entities like `city`, `business_type`, and `nace_code` across turns.
                  </p>
                </div>
              </div>
            </section>

            {/* Smart Router Section */}
            <section id="smart-router" className="scroll-mt-24">
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-[var(--border)] pb-6">
                <Cpu className="text-[var(--accent)]" size={28} /> Smart Router & Context Engine
              </h2>
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium">
                The Smart Router is the core orchestrator. It intercepts all user input before it reaches the LLM, applying zero-latency local intent classification and context augmentation.
              </p>

              <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-1)] overflow-hidden shadow-sm hover:shadow-lg transition-all">
                <div className="bg-[var(--surface-2)] px-8 py-4 border-b border-[var(--border)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Code2 size={18} className="text-[var(--muted)]" />
                    <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">Routing Pipeline</span>
                  </div>
                  <div className="flex gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/20" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-400/20" />
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/20" />
                  </div>
                </div>
                <div className="p-8 space-y-10">
                  <div id="smart-router-heuristics" className="scroll-mt-24 flex gap-6 items-start group">
                    <div className="w-8 h-8 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] text-xs font-black shrink-0">1</div>
                    <div>
                      <h4 className="font-bold text-lg mb-2">Keyword Heuristics</h4>
                      <p className="text-[var(--muted)] font-medium">Fuzzy regex matching determines if the query is a greeting, smalltalk, or a domain-specific intent (e.g., `permit.restaurant`).</p>
                    </div>
                  </div>
                  <div id="smart-router-context" className="scroll-mt-24 flex gap-6 items-start group">
                    <div className="w-8 h-8 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] text-xs font-black shrink-0">2</div>
                    <div>
                      <h4 className="font-bold text-lg mb-2">Contextual Augmentation</h4>
                      <p className="text-[var(--muted)] font-medium">If the query is a short follow-up (e.g., "yes", "Dubai"), the Context Engine injects state variables (`visa`, `consulate`) to resolve ambiguity locally without an LLM call.</p>
                    </div>
                  </div>
                  <div id="smart-router-caching" className="scroll-mt-24 flex gap-6 items-start group">
                    <div className="w-8 h-8 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-[var(--accent)] text-xs font-black shrink-0">3</div>
                    <div>
                      <h4 className="font-bold text-lg mb-2">Localized Prompt Caching</h4>
                      <p className="text-[var(--muted)] font-medium">For standard procedures, the Router retrieves localized JSON payloads (English, Turkish, Arabic) to ensure structural consistency in roadmaps.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Business Agent */}
            <section id="permit-api" className="scroll-mt-24">
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-[var(--border)] pb-6">
                <Building2 className="text-[var(--accent)]" size={28} /> Business Agent Architecture
              </h2>
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium">
                The Business Agent is a high-precision system specialized in commercial real estate, business formation, and municipal licensing. It handles the complex licensing process across Istanbul's 39 districts.
              </p>

              <div className="grid grid-cols-1 gap-8">
                <div id="permit-api-nace" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm flex flex-col md:flex-row gap-8 items-start group">
                  <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
                    <Database size={28} />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xl font-bold mb-3">NACE Sector Intelligence</h4>
                    <p className="text-[var(--muted)] leading-relaxed mb-6 font-medium">
                      The agent utilizes a semantic mapping engine to translate natural language business descriptions into official NACE codes. This inference is critical because the required permit type is directly derived from the NACE classification.
                    </p>
                    <div className="bg-[var(--surface-2)] p-6 rounded-2xl border border-[var(--border)] font-mono text-xs overflow-x-auto">
                      <div className="flex justify-between mb-4 border-b border-[var(--border)] pb-2">
                        <span className="text-[var(--accent)] font-bold">INPUT: "Boutique coffee shop with seating"</span>
                        <span className="text-[var(--muted)] text-[10px] font-bold">AGENT_LOG</span>
                      </div>
                      <div className="space-y-1 text-[var(--text)]/70">
                        <div>INFERRED_NACE: <span className="text-rose-500">56.30.02</span></div>
                        <div>PERMIT_CATEGORY: <span className="text-emerald-500">Sıhhi Müessese</span></div>
                        <div>ZONE_VALIDATION: <span className="text-blue-500">Commercial/Mixed Use</span></div>
                        <div>MANDATORY_CHECKS: <span className="text-amber-500">["Fire Safety", "ITO Registration"]</span></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div id="permit-api-workflow" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm group">
                  <h4 className="text-xl font-bold mb-8 flex items-center gap-3">
                    <Layers size={22} className="text-orange-500" /> Licensing Workflow Pipeline
                  </h4>
                  <div className="relative space-y-10 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[var(--border)]">
                    <div className="relative pl-12">
                      <div className="absolute left-0 top-1 w-8 h-8 rounded-xl bg-[var(--surface-2)] border border-orange-500/30 flex items-center justify-center text-xs text-orange-500 font-black shadow-sm">1</div>
                      <h5 className="font-bold text-base mb-2">Physical Infrastructure Check</h5>
                      <p className="text-sm text-[var(--muted)] font-medium">Validation of ceiling heights, emergency exits, and handicap access according to 2026 Istanbul Building Codes. The agent scans uploaded floor plans for compliance.</p>
                    </div>
                    <div className="relative pl-12">
                      <div className="absolute left-0 top-1 w-8 h-8 rounded-xl bg-[var(--surface-2)] border border-orange-500/30 flex items-center justify-center text-xs text-orange-500 font-black shadow-sm">2</div>
                      <h5 className="font-bold text-base mb-2">İtfaiye (Fire) Safety Protocol</h5>
                      <p className="text-sm text-[var(--muted)] font-medium">Automatic generation of the Fire Department application roadmap based on floor area and fuel types used. Includes direct links to municipal payment portals.</p>
                    </div>
                    <div className="relative pl-12">
                      <div className="absolute left-0 top-1 w-8 h-8 rounded-xl bg-[var(--surface-2)] border border-orange-500/30 flex items-center justify-center text-xs text-orange-500 font-black shadow-sm">3</div>
                      <h5 className="font-bold text-base mb-2">Municipal Submission</h5>
                      <p className="text-sm text-[var(--muted)] font-medium">Compilation of the "Ruhsat Başvuru Dosyası" with district-specific forms injected via the Local API Engine. The agent verifies signature requirements for each form.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Student Agent */}
            <section id="student" className="scroll-mt-24">
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-[var(--border)] pb-6">
                <GraduationCap className="text-[var(--accent)]" size={28} /> Student Agent Architecture
              </h2>
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium">
                The Student Agent is architected for international scholars navigating the Turkish Higher Education system. It provides end-to-end support for university registration and residency.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div id="student-residency" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm relative overflow-hidden group">
                  <div className="absolute top-[-20px] right-[-20px] p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Globe size={160} className="text-blue-500" />
                  </div>
                  <h4 className="text-lg font-bold mb-6 flex items-center gap-3">
                    <Globe size={20} className="text-blue-500" /> Residency Automation
                  </h4>
                  <p className="text-[var(--muted)] font-medium leading-relaxed mb-6">
                    The agent simulates connectivity with the "e-İkamet" system to generate precise document bundles. It differentiates between First Application, Extension, and Transfer.
                  </p>
                  <ul className="space-y-3">
                    <li className="flex items-center gap-3 text-xs font-bold text-[var(--muted)]">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div> Biometric Photo Specs Validation
                    </li>
                    <li className="flex items-center gap-3 text-xs font-bold text-[var(--muted)]">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div> Student Certificate QR Check
                    </li>
                  </ul>
                </div>

                <div id="student-insurance" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm flex flex-col justify-between group">
                  <div>
                    <h4 className="text-lg font-bold mb-6 flex items-center gap-3">
                      <ShieldCheck size={20} className="text-emerald-500" /> Insurance & GSS Engine
                    </h4>
                    <p className="text-[var(--muted)] font-medium leading-relaxed">
                      International students must maintain valid health insurance. The agent cross-references policy dates with residency appointment windows to ensure zero coverage gaps.
                    </p>
                  </div>
                  <div className="mt-10 pt-6 border-t border-[var(--border)] flex items-center justify-between">
                    <span className="text-[10px] text-[var(--muted)] uppercase tracking-widest font-black">API Status</span>
                    <div className="flex items-center gap-2">
                      <div className="live-dot" />
                      <span className="text-emerald-500 text-[10px] font-black uppercase tracking-widest">Active Sync</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Legal Agent */}
            <section id="legal-engine" className="scroll-mt-24">
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-emerald-500/20 pb-6">
                <Scale className="text-emerald-500" size={28} /> Legal Agent & RAG Engine
              </h2>
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium">
                The Legal Agent serves as an enterprise-grade compliance monitor. It utilizes a Retrieval-Augmented Generation (RAG) pipeline to query a high-density vector database.
              </p>

              <div className="space-y-8">
                <div id="legal-engine-rag" className="scroll-mt-24 p-10 rounded-[40px] bg-gradient-to-br from-[var(--surface-1)] to-[var(--surface-2)] border border-emerald-500/10 shadow-xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[80px] rounded-full" />

                  <div className="flex flex-col md:flex-row gap-12 relative z-10">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-8">
                        <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
                          <Database size={28} />
                        </div>
                        <h4 className="text-2xl font-bold">Vector-Indexed Law Repository</h4>
                      </div>
                      <p className="text-[var(--muted)] font-medium leading-relaxed mb-8">
                        When a complex legal query is processed, the system performs a multi-stage retrieval. It embeds the query using a customized encoder and searches through thousands of chunks from the "Resmi Gazete" (Official Gazette).
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {['TTK §6102', 'KVKK §6698', 'IK §4857', 'UK §6098'].map(code => (
                          <div key={code} className="px-4 py-2.5 rounded-2xl bg-[var(--surface-1)] border border-[var(--border)] text-center shadow-sm">
                            <span className="text-[11px] text-emerald-500 font-black tracking-tighter">{code}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="w-full md:w-64 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-lg flex flex-col justify-center items-center text-center hover:scale-105 transition-transform duration-500">
                      <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6">
                        <Cpu size={40} className="text-emerald-500" />
                      </div>
                      <span className="text-xs font-bold text-[var(--muted)] mb-1 uppercase tracking-widest">RAG Latency</span>
                      <span className="text-3xl text-emerald-500 font-mono font-black">&lt; 450ms</span>
                      <div className="mt-4 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        <span className="text-[10px] text-emerald-500/60 font-black uppercase tracking-tighter">Real-time Inference</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div id="legal-engine-ocr" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm group hover:border-emerald-500/30 transition-all">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-3">
                      <FileText size={20} className="text-emerald-500" /> Contract Analysis (OCR)
                    </h4>
                    <p className="text-[var(--muted)] font-medium leading-relaxed">
                      Proprietary OCR layers extract key entities (Parties, Dates, Penal Clauses) and flag non-compliant terms against standard Turkish Commercial Law.
                    </p>
                  </div>
                  <div id="legal-engine-kvkk" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm group hover:border-emerald-500/30 transition-all">
                    <h4 className="text-lg font-bold mb-4 flex items-center gap-3">
                      <Fingerprint size={20} className="text-emerald-500" /> KVKK Compliance
                    </h4>
                    <p className="text-[var(--muted)] font-medium leading-relaxed">
                      The agent monitors the Personal Data Protection Authority (KVKK) board decisions, ensuring your data registries are correctly mapped to localization laws.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-12 flex justify-end">
                <button onClick={() => scrollTo('terms')} className="group flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 text-sm font-bold hover:bg-emerald-500/10 transition-all shadow-sm">
                  Next: Terms of Service <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </section>

            {/* Terms of Service Section */}
            <section id="terms" className="scroll-mt-24 relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-rose-500/5 blur-[100px] rounded-full pointer-events-none" />
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-rose-500/20 pb-6">
                <FileText className="text-rose-500" size={28} /> Terms of Service
              </h2>
              <div className="space-y-16 text-[var(--text)]/80 leading-relaxed font-medium relative z-10">
                <div id="terms-acceptance" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">1. Acceptance of Terms</h3>
                  <p className="mb-4 text-[var(--muted)] text-sm leading-relaxed">
                    By creating an account or using TurkGateway AI, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service and our Privacy Policy.
                  </p>
                  <ul className="list-disc pl-6 space-y-2 text-sm text-[var(--muted)]">
                    <li>If using the Service on behalf of a company, you represent the authority to bind such entity.</li>
                    <li>Minors under 18 may not use the Service without verifiable parental consent.</li>
                    <li>Continued use after any Terms update constitutes acceptance of the revised terms.</li>
                  </ul>
                </div>
                <div id="terms-ai-disclaimer" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">2. AI Disclaimer</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    TurkGateway utilizes advanced LLMs and RAG pipelines to provide information about Turkish laws and municipal protocols. This does <strong className="text-[var(--text)]">NOT</strong> constitute professional legal advice, financial advice, or an official government determination.
                  </p>
                </div>
                <div id="terms-responsibilities" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">3. User Responsibilities</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    Users must provide accurate, up-to-date information. You may not use the service for activities illegal under Turkish law, reverse-engineer our Agentic workflows, or automate interactions beyond our provided RPA features.
                  </p>
                </div>
                <div id="terms-payments" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">4. Subscriptions &amp; Payments</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    Premium features are billed via <strong className="text-[var(--text)]">iyzico</strong> (PCI-DSS Level 1). Subscriptions auto-renew monthly unless cancelled before the renewal date. Fees are non-refundable except as required by Turkish Consumer Protection Law (No. 6502).
                  </p>
                </div>
                <div id="terms-liability" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">5. Limitation of Liability</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    TurkGateway shall not be liable for any indirect, incidental, or consequential damages from administrative delays, visa rejections, permit denials, government portal downtime, or regulatory changes. Our total liability shall not exceed fees paid in the preceding 3 months.
                  </p>
                </div>
                <div id="terms-ip" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">6. Intellectual Property</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    All platform content — including AI model logic, Smart Router, workflow schemas, UI design, and documentation — is the exclusive intellectual property of TurkGateway. You retain ownership of your personal data, uploaded documents, and exported roadmaps.
                  </p>
                </div>
                <div id="terms-termination" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">7. Termination</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    You may terminate your account via <strong className="text-[var(--text)]">Settings → Account → Delete Account</strong>. TurkGateway reserves the right to suspend accounts that violate these Terms, engage in fraudulent behavior, or attempt to circumvent payment obligations.
                  </p>
                </div>
                <div id="terms-governing" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-rose-500/30 hover:bg-rose-500/[0.02] transition-all group">
                  <h3 className="text-xl font-bold text-[var(--text)] mb-4 group-hover:text-rose-400 transition-colors">8. Governing Law</h3>
                  <p className="text-[var(--muted)] text-sm leading-relaxed">
                    These Terms are governed by the laws of the <strong className="text-[var(--text)]">Republic of Turkey</strong>. Any disputes fall under the exclusive jurisdiction of the <strong className="text-[var(--text)]">Istanbul Courts</strong>. Before legal proceedings, please contact <strong className="text-[var(--text)]">support@turkgateway.ai</strong>.
                  </p>
                </div>
              </div>
              <div className="mt-12 flex justify-end">
                <button onClick={() => scrollTo('privacy')} className="group flex items-center gap-2 px-6 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20 text-rose-500 text-sm font-bold hover:bg-rose-500/10 transition-all shadow-sm">
                  Next: Privacy Policy <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </section>

            {/* Privacy Policy Section */}
            <section id="privacy" className="scroll-mt-24 relative">
              <div className="absolute top-0 left-0 w-64 h-64 bg-indigo-500/5 blur-[100px] rounded-full pointer-events-none" />
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-indigo-500/20 pb-6">
                <Lock className="text-indigo-500" size={28} /> Privacy Policy
              </h2>
              
              <div className="space-y-24 relative z-10">
                <div id="privacy-kvkk" className="scroll-mt-24 group">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                      <ShieldCheck size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">KVKK Compliance</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    TurkGateway AI is fully compliant with the Personal Data Protection Law (KVKK) No. 6698. We act as a data processor for administrative queries and implement strict technical measures to prevent unauthorized access.
                  </p>
                </div>

                <div id="privacy-collection" className="scroll-mt-24 group">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                      <Database size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">Data Collection</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    We collect only the minimum data required to facilitate your bureaucratic applications. This includes account information and the specific entities provided during chat sessions (e.g., location, business type).
                  </p>
                </div>

                <div id="privacy-documents" className="scroll-mt-24 group">
                   <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                      <FileText size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">Document Data</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    Any documents uploaded for review (e.g., floor plans, certificates) are processed in real-time and are not used for model training or permanent storage without explicit user consent.
                  </p>
                </div>

                <div id="privacy-sharing" className="scroll-mt-24 group">
                   <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:bg-amber-500 group-hover:text-white transition-all">
                      <Network size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">Third-Party Sharing</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    We do not sell your personal data. We only share anonymized analytical data with infrastructure providers to maintain platform uptime and performance.
                  </p>
                </div>

                <div id="privacy-storage" className="scroll-mt-24 group">
                   <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                      <Lock size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">Data Storage</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    Data is stored on encrypted servers within the European Economic Area (EEA) and Türkiye, ensuring high compliance with both local and international privacy standards.
                  </p>
                </div>

                <div id="privacy-rights" className="scroll-mt-24 group">
                   <div className="flex items-center gap-4 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 group-hover:bg-rose-500 group-hover:text-white transition-all">
                      <Fingerprint size={20} />
                    </div>
                    <h3 className="text-2xl font-bold">Your Rights</h3>
                  </div>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    Under KVKK, you have the right to access, correct, or request the deletion of your personal data at any time. You can exercise these rights via your account settings or by contacting our support team.
                  </p>
                </div>

                <div id="privacy-retention" className="scroll-mt-24 group">
                  <h3 className="text-2xl font-bold mb-6">Data Retention</h3>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    We retain data only as long as necessary to provide our services or as required by law. Inactive accounts and associated session data are purged after 24 months of inactivity.
                  </p>
                </div>

                <div id="privacy-updates" className="scroll-mt-24 group">
                  <h3 className="text-2xl font-bold mb-6">Policy Updates</h3>
                  <p className="text-[var(--muted)] leading-relaxed font-medium">
                    This policy may be updated to reflect changes in legal requirements or platform features. Users will be notified of significant changes via email or dashboard alerts.
                  </p>
                </div>
              </div>

              <div className="mt-16 p-6 rounded-2xl bg-indigo-500/5 border border-indigo-500/20 text-xs text-indigo-400/80 font-mono text-center shadow-inner">
                Last Updated: May 1, 2026 • KVKK Compliance Version 2.4.1
              </div>
              <div className="mt-12 flex justify-end">
                <button onClick={() => scrollTo('resources')} className="group flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 text-sm font-bold hover:bg-emerald-500/10 transition-all shadow-sm">
                  Next: Resource Center <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </section>

            {/* Resource Center Section */}
            <section id="resources" className="scroll-mt-24 relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 blur-[100px] rounded-full pointer-events-none" />
              <h2 className="text-3xl font-bold mb-10 flex items-center gap-4 border-b border-emerald-500/20 pb-6">
                <Globe className="text-emerald-500" size={28} /> Resource Center
              </h2>
              
              <p className="text-[var(--text)]/80 text-lg leading-relaxed mb-10 font-medium relative z-10">
                A curated list of official Turkish government portals, databases, and application systems. These are the primary sources our Agents use to verify requirements and roadmaps.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                <a id="resources-edevlet" href="https://www.turkiye.gov.tr" target="_blank" rel="noopener noreferrer" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-emerald-500/30 hover:shadow-lg transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <Database size={24} />
                    </div>
                    <h3 className="text-xl font-bold group-hover:text-emerald-500 transition-colors">e-Devlet Gateway</h3>
                  </div>
                  <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
                    The central digital platform for all Turkish government services. Used for downloading criminal records, residency proofs, SGK details, and tax debt status.
                  </p>
                  <div className="text-emerald-500 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                    turkiye.gov.tr <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </a>

                <a id="resources-goc" href="https://e-ikamet.goc.gov.tr/" target="_blank" rel="noopener noreferrer" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-emerald-500/30 hover:shadow-lg transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <ShieldCheck size={24} />
                    </div>
                    <h3 className="text-xl font-bold group-hover:text-emerald-500 transition-colors">Göç İdaresi (e-Ikamet)</h3>
                  </div>
                  <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
                    The official portal of the Presidency of Migration Management for foreigners. Used for applying for new residence permits, renewals, and extensions.
                  </p>
                  <div className="text-emerald-500 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                    e-ikamet.goc.gov.tr <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </a>

                <a id="resources-gazete" href="https://www.resmigazete.gov.tr" target="_blank" rel="noopener noreferrer" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-emerald-500/30 hover:shadow-lg transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <FileText size={24} />
                    </div>
                    <h3 className="text-xl font-bold group-hover:text-emerald-500 transition-colors">T.C. Resmî Gazete</h3>
                  </div>
                  <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
                    The Official Gazette of the Republic of Turkey. The absolute source of truth for new laws, presidential decrees, regulations, and public appointments.
                  </p>
                  <div className="text-emerald-500 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                    resmigazete.gov.tr <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </a>

                <a id="resources-mersis" href="https://mersis.gtb.gov.tr/" target="_blank" rel="noopener noreferrer" className="scroll-mt-24 p-8 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] shadow-sm hover:border-emerald-500/30 hover:shadow-lg transition-all group">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <Building2 size={24} />
                    </div>
                    <h3 className="text-xl font-bold group-hover:text-emerald-500 transition-colors">MERSİS (Ministry of Trade)</h3>
                  </div>
                  <p className="text-[var(--muted)] text-sm leading-relaxed mb-4">
                    Central Registration System for businesses. Required for establishing new companies (LLC, Joint Stock), managing trade registries, and updating company bylaws.
                  </p>
                  <div className="text-emerald-500 text-xs font-bold uppercase tracking-widest flex items-center gap-1">
                    mersis.gtb.gov.tr <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
                  </div>
                </a>
              </div>

              <div className="mt-12 flex justify-end">
                <button onClick={() => scrollTo('architecture')} className="group flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-[var(--muted)] text-sm font-bold hover:text-[var(--text)] transition-all">
                  Back to Start <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                </button>
              </div>
            </section>

          </article>
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
