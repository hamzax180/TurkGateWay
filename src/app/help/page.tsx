'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, MessageCircle, FileText, Mail, ChevronDown, ArrowLeft, ExternalLink, LifeBuoy, Book, Users, GraduationCap, Scale } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

export default function HelpPage() {
  const { t, isRTL } = useLanguage();
  const { token } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const faqs = [
    {
      q: "What documents do I need for a business permit?",
      a: "Requirements vary by municipality (district) and business type. Generally, you need a Tax Plate (Vergi Levhası), Fire Safety Report, and Chamber of Commerce registration. Use the Permit assistant in the chat for a specific list for your district."
    },
    {
      q: "How long does the fire safety inspection take?",
      a: "In Istanbul, it usually takes between 7 to 15 working days after the application is submitted. Our platform tracks these estimated timelines for each of the 39 municipalities."
    },
    {
      q: "Can I renew my student residence permit here?",
      a: "The Student Agent helps you prepare the roadmap, checklists, and document templates for e-Devlet and Göç İدايرة submissions. We automate the verification but you must still attend your assigned appointment."
    },
    {
      q: "Is PermitOps AI officially affiliated with the government?",
      a: "No, PermitOps AI is an independent platform that helps navigate bureaucratic protocols. We use AI to simplify local laws and municipal guidelines for your convenience."
    }
  ];


  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden">
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
        onDeleteSession={() => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 transition-colors duration-300 relative overflow-y-auto slim-scroll">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />

        <div className="w-full px-6 md:px-12 py-8 md:py-16">
          {/* Search Hero */}
          <div className="text-left mb-16">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center justify-center p-3 rounded-2xl bg-indigo-500/10 text-indigo-500 mb-6"
            >
              <LifeBuoy size={32} />
            </motion.div>
            <h2 className="text-3xl md:text-5xl font-black mb-6 tracking-tight">How can we help you?</h2>
          </div>

          {/* Quick Links Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {[
              { icon: Book, title: "Documentation", desc: "Detailed guides for business permits & protocols", color: "mesh-indigo", href: "/docs#permit" },
              { icon: GraduationCap, title: "Student Guide", desc: "How to handle residence permits & university docs", color: "mesh-purple", href: "/docs#student" },
              { icon: Scale, title: "Lawyer Portal", desc: "Legal frameworks and municipal compliance logs", color: "mesh-blue", href: "/docs#lawyer" },
              { icon: Users, title: "Community", desc: "Join 10k+ businesses and students in Istanbul", color: "mesh-emerald", href: "/docs#community" },
              { icon: FileText, title: "Resource Center", desc: "Checklists, laws and PDF templates", color: "mesh-indigo", href: "/docs#resources" }
            ].map((cat, i) => (
              <Link href={cat.href} key={i}>
                <motion.div
                  whileHover={{ y: -8, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className={`glass-mesh ${cat.color || 'mesh-indigo'} p-8 rounded-[40px] border border-[var(--border)] shadow-xl cursor-pointer h-full flex flex-col`}
                >
                  <div className="mb-6 p-3 rounded-2xl bg-white/5 w-fit border border-white/10">
                    <cat.icon className="opacity-90" size={32} />
                  </div>
                  <h3 className="text-xl md:text-2xl font-black mb-3 tracking-tight">{cat.title}</h3>
                  <p className="text-sm text-[var(--muted)] leading-relaxed mb-8 flex-1">{cat.desc}</p>
                  <div className="mt-auto flex items-center gap-2 text-indigo-400 font-bold text-sm group-hover:text-indigo-300 transition-colors uppercase tracking-widest">
                    Explore <ExternalLink size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                  </div>
                </motion.div>
              </Link>
            ))}
          </div>

          {/* FAQ Section */}
          <div className="max-w-6xl w-full mx-auto">
            <h3 className="text-2xl md:text-3xl font-black mb-12 tracking-tight flex items-center justify-center gap-3">
              <HelpCircle className="text-indigo-500" size={28} />
              {t('help_faq')}
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {faqs.map((faq, i) => (
                <div 
                  key={i}
                  className="rounded-[24px] bg-[var(--surface-2)]/10 backdrop-blur-md border border-[var(--border)] overflow-hidden h-fit"
                >
                  <button 
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full text-left px-8 py-6 flex items-center justify-between hover:bg-[var(--surface-2)]/50 transition-all min-h-[96px]"
                  >
                    <span className="font-bold text-lg pr-4">{faq.q}</span>
                    <ChevronDown className={`shrink-0 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[var(--border)]"
                      >
                        <div className="px-8 py-6 text-[var(--muted)] leading-relaxed bg-[var(--surface-1)]/30">
                          {faq.a}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </div>

          {/* Support CTA */}
          <div className="mt-24 p-12 rounded-[48px] bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-center shadow-2xl shadow-indigo-500/30 relative overflow-hidden group mb-20 max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10" />
            <h3 className="text-3xl font-black mb-4 relative z-10">Still have questions?</h3>
            <p className="opacity-90 mb-10 text-lg relative z-10 max-w-xl mx-auto">Our support team is available 24/7 to help you with municipal complexities.</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
              <button className="px-10 py-4 rounded-full bg-white text-indigo-600 font-black shadow-xl hover:scale-105 transition-all flex items-center justify-center gap-2">
                <Mail size={20} />
                Email Support
              </button>
              <button className="px-10 py-4 rounded-full bg-indigo-400/20 backdrop-blur-md border border-white/20 text-white font-black hover:bg-white/10 transition-all">
                Open Support Ticket
              </button>
            </div>
          </div>
        </div>

        <footer className="py-16 text-center text-[var(--muted)] text-sm mt-auto opacity-50">
          <p>© 2026 PermitOps AI • {t('footer_version')}</p>
        </footer>
      </main>
    </div>
  );
}
