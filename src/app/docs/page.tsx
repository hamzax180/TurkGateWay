'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Book, Building2, GraduationCap, Scale, FileText, 
  ShieldCheck, Zap, Globe, MessageSquare, ArrowRight,
  ChevronRight, Library, Info, HelpCircle, ExternalLink
} from 'lucide-react';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Link from 'next/link';

export default function DocumentationPage() {
  const { t } = useLanguage();
  const { token } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('getting-started');

  const sections = [
    { id: 'getting-started', title: 'Getting Started', icon: Zap },
    { id: 'permit', title: 'Permit Agent', icon: Building2 },
    { id: 'student', title: 'Student Agent', icon: GraduationCap },
    { id: 'lawyer', title: 'Lawyer Agent', icon: Scale },
    { id: 'technical', title: 'Technical Details', icon: ShieldCheck },
  ];

  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;
      sections.forEach(section => {
        const element = document.getElementById(section.id);
        if (element && element.offsetTop <= scrollPosition && element.offsetTop + element.offsetHeight > scrollPosition) {
          setActiveSection(section.id);
        }
      });
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden">
      <Sidebar 
        currentSessionId={null}
        assistantType="permit"
        onSessionSelect={(id) => {
          localStorage.setItem('TurkGateway_active_session_id', id);
          window.location.href = '/chat';
        }}
        onNewChat={() => {
          window.location.href = '/chat?new=true';
        }}
        onDeleteSession={() => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 transition-colors duration-300 relative overflow-y-auto slim-scroll">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />

        <div className="w-full relative px-6 md:px-12 py-12 flex flex-col items-start lg:flex-row gap-12">
          
          {/* Internal Docs Sidebar */}
          <aside className="hidden lg:block w-64 sticky top-12 shrink-0">
            <div className="space-y-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--muted)] mb-4 px-4">Contents</p>
              {sections.map(section => (
                <button
                  key={section.id}
                  onClick={() => scrollTo(section.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${
                    activeSection === section.id 
                      ? 'bg-indigo-500/10 text-indigo-500 font-bold shadow-sm' 
                      : 'text-[var(--muted)] hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <section.icon size={18} />
                  <span className="text-sm">{section.title}</span>
                  {activeSection === section.id && <ChevronRight size={14} className="ml-auto" />}
                </button>
              ))}
            </div>
          </aside>

          {/* Docs Content */}
          <article className="flex-1 max-w-4xl space-y-24 pb-32">
            
            {/* Header */}
            <div id="getting-started">
              <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-500/10 text-indigo-500 mb-6">
                <Library size={32} />
              </div>
              <h1 className="text-4xl md:text-6xl font-black mb-6 tracking-tighter">Documentation</h1>
              <p className="text-xl text-[var(--muted)] leading-relaxed max-w-2xl">
                Welcome to the TurkGateway AI knowledge center. Here you can find detailed information on how our specialized agents work and how they can help you navigate local administrative protocols.
              </p>
              
              <div className="mt-12 p-8 rounded-[40px] bg-[var(--surface-2)]/30 border border-[var(--border)] relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Info size={120} />
                </div>
                <h3 className="text-xl font-bold mb-4">Core Philosophy</h3>
                <p className="text-[var(--muted)] leading-relaxed">
                  Every agent is trained on thousands of municipal documents, laws, and official guidelines. Unlike generic AI, our agents are region-specific and protocol-aware. They don't just "chat"—they build actionable roadmaps.
                </p>
              </div>
            </div>

            {/* Permit Agent */}
            <section id="permit" className="space-y-8 scroll-mt-12">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 flex items-center justify-center text-indigo-500 border border-indigo-500/20 shadow-lg">
                  <Building2 size={24} />
                </div>
                <h2 className="text-3xl font-black tracking-tight">Permit Agent</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[var(--muted)] leading-relaxed space-y-6">
                <p className="text-lg">The Permit Agent is designed for entrepreneurs and business owners looking to open or maintain physical establishments in Istanbul and beyond.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 not-prose">
                  <div className="p-6 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)]">
                    <h4 className="font-bold text-white mb-2">Business License (Ruhsat)</h4>
                    <p className="text-sm">Automated checklists for opening cafes, offices, or factories based on the specific municipality (Beşiktaş, Kadıköy, etc.).</p>
                  </div>
                  <div className="p-6 rounded-3xl bg-[var(--surface-1)] border border-[var(--border)]">
                    <h4 className="font-bold text-white mb-2">Fire & Health Protocols</h4>
                    <p className="text-sm">Guidance on how to apply for the Fire Safety Report (İtfaiye Raporu) and Health inspections before your final audit.</p>
                  </div>
                </div>

                <div className="p-6 rounded-3xl border border-indigo-500/20 bg-indigo-500/5">
                  <h4 className="font-black text-indigo-500 mb-2 uppercase text-xs tracking-widest">Key Feature</h4>
                  <p className="text-white font-medium">District-Specific Intelligence: Our agent knows that Beşiktaş has different "Zabıta" rules than Bakırköy. Simply mention your district to get relevant results.</p>
                </div>
              </div>
            </section>

            {/* Student Agent */}
            <section id="student" className="space-y-8 scroll-mt-12">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-600/10 flex items-center justify-center text-purple-500 border border-purple-500/20 shadow-lg">
                  <GraduationCap size={24} />
                </div>
                <h2 className="text-3xl font-black tracking-tight">Student Agent</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[var(--muted)] leading-relaxed space-y-6">
                <p className="text-lg">Created specifically for international students, this agent simplifies life in Turkey from enrollment to graduation.</p>
                
                <ul className="space-y-4 not-prose">
                  {[
                    { t: "Residence Permit (Ikamet)", d: "Detailed roadmap for First-time and Renewal applications, including insurance and appointment prep." },
                    { t: "University Equivalence (Denklik)", d: "Step-by-step guide on how to get your high school or previous degree recognized by YÖK." },
                    { t: "Student Benefits", d: "How to apply for the Istanbul Card (Student Metro card), health insurance (GSS), and bank accounts." }
                  ].map((item, i) => (
                    <li key={i} className="flex gap-4 items-start p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                      <div className="mt-1"><ShieldCheck size={18} className="text-purple-500" /></div>
                      <div>
                        <p className="font-bold text-white">{item.t}</p>
                        <p className="text-sm">{item.d}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            {/* Lawyer Agent */}
            <section id="lawyer" className="space-y-8 scroll-mt-12">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600/10 flex items-center justify-center text-blue-500 border border-blue-500/20 shadow-lg">
                  <Scale size={24} />
                </div>
                <h2 className="text-3xl font-black tracking-tight">Lawyer Agent</h2>
              </div>
              <div className="prose prose-invert max-w-none text-[var(--muted)] leading-relaxed space-y-6">
                <p className="text-lg">The Lawyer Agent acts as a compliance monitor and legal researcher for professional requirements.</p>
                
                <div className="p-8 rounded-[32px] glass-mesh mesh-blue border border-blue-500/20 text-white leading-relaxed">
                  <div className="flex items-center gap-3 mb-6">
                    <Zap size={20} className="text-yellow-400" fill="currentColor" />
                    <span className="font-black text-xs uppercase tracking-[0.2em]">Municipal Compliance Logs</span>
                  </div>
                  <h4 className="text-2xl font-black mb-4">Official Gazette Tracking</h4>
                  <p className="opacity-90 leading-relaxed mb-6">
                    Our Lawyer Agent cross-references the latest "Resmi Gazete" decisions with municipal bylaws to tell you if a new law affects your current operation.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {['Labor Law', 'Municipal Penalties', 'KVKK Compliance', 'Trade Registry'].map(t => (
                      <span key={t} className="px-3 py-1 rounded-full bg-white/10 text-[10px] font-bold uppercase tracking-wider border border-white/10">{t}</span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Technical Details */}
            <section id="technical" className="space-y-8 scroll-mt-12">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-600/10 flex items-center justify-center text-emerald-500 border border-emerald-500/20 shadow-lg">
                  <ShieldCheck size={24} />
                </div>
                <h2 className="text-3xl font-black tracking-tight">Technical & Privacy</h2>
              </div>
              <div className="bg-[var(--surface-2)]/30 rounded-[32px] border border-[var(--border)] overflow-hidden">
                <div className="p-8 border-b border-[var(--border)]">
                  <div className="flex items-center gap-2 mb-2 text-emerald-500">
                    <Globe size={16} />
                    <span className="text-[10px] font-black uppercase tracking-widest">Global Standards</span>
                  </div>
                  <h4 className="text-xl font-bold">Data Sovereignty</h4>
                  <p className="text-sm text-[var(--muted)] mt-2 italic">"Your data stays your data."</p>
                </div>
                <div className="p-8 space-y-6">
                  <div className="flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                      <MessageSquare size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Encryption</p>
                      <p className="text-xs text-[var(--muted)] leading-relaxed mt-1">All chats are encrypted using AES-256 standards. Our agents process data in a localized VPC to ensure zero leakage.</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                      <FileText size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-sm">Document Parsing</p>
                      <p className="text-xs text-[var(--muted)] leading-relaxed mt-1">When you upload a PDF, we use OCR and LLM-based layout analysis to extract terms without storing the raw image indefinitely.</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

          </article>
        </div>

        <footer className="py-20 bg-[var(--surface-1)] border-t border-[var(--border)] mt-auto px-12">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-black text-xs">P</div>
              <span className="font-black tracking-tighter text-xl">TurkGateway</span>
            </div>
            <div className="flex gap-8 text-[var(--muted)] text-sm font-medium">
              <a href="#" className="hover:text-indigo-500 transition-colors">Privacy</a>
              <a href="#" className="hover:text-indigo-500 transition-colors">Terms</a>
              <a href="#" className="hover:text-indigo-500 transition-colors">Security</a>
              <a href="#" className="hover:text-indigo-500 transition-colors">Changelog</a>
            </div>
          </div>
        </footer>
      </main>

      <style jsx global>{`
        .glass-mesh {
          background-size: 200% 200%;
          animation: mesh-flow 15s ease infinite;
        }
        @keyframes mesh-flow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
}
