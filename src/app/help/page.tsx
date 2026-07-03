'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HelpCircle, MessageCircle, FileText, Mail, ChevronDown, ExternalLink, LifeBuoy, Book, Users, GraduationCap, Scale } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function HelpPage() {
  const { t, isRTL } = useLanguage();
  const { token } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const faqs = [
    { q: t('help_faq_q1'), a: t('help_faq_a1') },
    { q: t('help_faq_q2'), a: t('help_faq_a2') },
    { q: t('help_faq_q3'), a: t('help_faq_a3') },
    { q: t('help_faq_q4'), a: t('help_faq_a4') },
    { q: t('help_faq_q5'), a: t('help_faq_a5') },
    { q: t('help_faq_q6'), a: t('help_faq_a6') },
  ];

  const categories = [
    {
      icons: [Book, GraduationCap, Scale],
      title: t('help_cat_docs_title'),
      desc: t('help_cat_docs_desc'),
      color: 'mesh-indigo',
      iconBg: 'bg-indigo-500/10',
      iconColor: 'text-indigo-500',
      href: '/docs',
    },
    {
      icons: [Users],
      title: t('help_cat_community_title'),
      desc: t('help_cat_community_desc'),
      color: 'mesh-purple',
      iconBg: 'bg-purple-500/10',
      iconColor: 'text-purple-500',
      href: '/docs#community',
    },
    {
      icons: [FileText],
      title: t('help_cat_resources_title'),
      desc: t('help_cat_resources_desc'),
      color: 'mesh-emerald',
      iconBg: 'bg-emerald-500/10',
      iconColor: 'text-emerald-500',
      href: '/docs#resources',
    },
  ];

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
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

        <div className="w-full px-6 md:px-12 py-8 md:py-16">
          {/* Search Hero */}
          <div className="text-center mb-8 md:mb-16 flex flex-col items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center justify-center p-2.5 md:p-3 rounded-2xl bg-indigo-500/10 text-indigo-500 mb-3 md:mb-6"
            >
              <LifeBuoy className="w-6 h-6 md:w-8 md:h-8" />
            </motion.div>
            <h2 className="text-2xl md:text-5xl font-bold mb-2 md:mb-6 tracking-tight">{t('help_hero')}</h2>
          </div>

          {/* Quick Links Category Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 mb-12 md:mb-20 animate-in fade-in slide-in-from-bottom-4 duration-1000">
            {categories.map((cat, i) => {
              const MainIcon = cat.icons[0];
              return (
                <Link href={cat.href} key={i}>
                  <motion.div
                    whileHover={{ y: -8, scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`glass-mesh ${cat.color} p-4 md:p-8 rounded-3xl md:rounded-[40px] border border-[var(--border)] shadow-xl cursor-pointer h-full flex flex-row md:flex-col items-center md:items-start gap-4 md:gap-0 group relative overflow-hidden`}
                  >
                    <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity pointer-events-none hidden md:block">
                      {MainIcon && <MainIcon size={120} />}
                    </div>

                    <div className="mb-0 md:mb-6 flex gap-2 relative z-10 shrink-0">
                      {cat.icons.map((Icon, idx) => (
                        <div key={idx} className={`p-2.5 md:p-4 rounded-xl md:rounded-2xl ${cat.iconBg} border border-white/10 shadow-sm backdrop-blur-md`}>
                          <Icon className={`${cat.iconColor} w-5 h-5 md:w-6 md:h-6`} />
                        </div>
                      ))}
                    </div>

                    <div className="relative z-10 min-w-0 flex-1">
                      <h3 className="text-base md:text-2xl font-black mb-1 md:mb-3 tracking-tight transition-colors">{cat.title}</h3>
                      <p className="text-xs md:text-sm text-[var(--muted)] leading-snug md:leading-relaxed mb-2 md:mb-8 flex-1 group-hover:text-[var(--text)] transition-colors opacity-80 line-clamp-2 md:line-clamp-none">{cat.desc}</p>
                      <div className="mt-auto flex items-center gap-2 text-indigo-400 font-bold text-[11px] md:text-sm uppercase tracking-widest group-hover:text-indigo-300 transition-colors">
                        {t('help_explore')} <ExternalLink size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                      </div>
                    </div>
                  </motion.div>
                </Link>
              );
            })}
          </div>

          {/* FAQ Section */}
          <div className="max-w-6xl w-full mx-auto">
            <h3 className="text-xl md:text-3xl font-bold mb-6 md:mb-12 tracking-tight flex items-center justify-center gap-2 md:gap-3">
              <HelpCircle className="text-indigo-500 w-6 h-6 md:w-7 md:h-7" />
              {t('help_faq')}
            </h3>

            <div className="grid grid-cols-2 gap-2 md:gap-4">
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="rounded-2xl md:rounded-[24px] bg-[var(--surface-2)]/10 backdrop-blur-md border border-[var(--border)] overflow-hidden h-fit"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full text-left px-3 py-3 md:px-8 md:py-6 flex items-start md:items-center justify-between gap-1.5 md:gap-2 hover:bg-[var(--surface-2)]/50 transition-all min-h-[76px] md:min-h-[96px]"
                  >
                    <span className="font-bold text-xs md:text-lg leading-snug">{faq.q}</span>
                    <ChevronDown className={`shrink-0 w-4 h-4 md:w-5 md:h-5 mt-0.5 md:mt-0 transition-transform duration-300 ${openFaq === i ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openFaq === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[var(--border)]"
                      >
                        <div className="px-3 py-3 md:px-8 md:py-6 text-xs md:text-base text-[var(--muted)] leading-relaxed bg-[var(--surface-1)]/30">
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
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="mt-16 md:mt-24 mb-12 md:mb-20 max-w-4xl mx-auto relative overflow-hidden rounded-3xl md:rounded-[40px] border border-white/10 bg-gradient-to-br from-indigo-500 via-indigo-500 to-purple-600 text-white text-center shadow-2xl shadow-indigo-500/20 px-6 py-10 md:px-12 md:py-16"
          >
            <div className="absolute -top-1/3 -left-10 w-72 h-72 bg-white/15 blur-[90px] rounded-full pointer-events-none" />
            <div className="absolute -bottom-1/3 -right-10 w-80 h-80 bg-fuchsia-400/25 blur-[100px] rounded-full pointer-events-none" />
            <div
              className="absolute inset-0 opacity-[0.12] pointer-events-none"
              style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
            />

            <div className="relative z-10 flex flex-col items-center">
              <div className="inline-flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-white/15 backdrop-blur-md border border-white/20 mb-5 md:mb-6 shadow-lg">
                <LifeBuoy className="w-7 h-7 md:w-8 md:h-8" />
              </div>
              <h3 className="text-2xl md:text-4xl font-bold tracking-tight mb-3 md:mb-4">{t('help_still_questions')}</h3>
              <p className="text-indigo-50/90 mb-8 md:mb-10 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
                {t('help_support_desc')}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center w-full sm:w-auto">
                <a
                  href="mailto:support@turkgateway.ai"
                  className="px-8 md:px-10 py-3.5 md:py-4 rounded-full bg-white text-indigo-600 font-bold shadow-xl shadow-indigo-900/20 hover:scale-[1.03] active:scale-95 transition-transform flex items-center justify-center gap-2 no-underline"
                >
                  <Mail size={19} />
                  {t('help_email_support')}
                </a>
                <Link
                  href="/chat"
                  className="px-8 md:px-10 py-3.5 md:py-4 rounded-full bg-white/10 backdrop-blur-md border border-white/25 text-white font-bold hover:bg-white/20 active:scale-95 transition-all flex items-center justify-center gap-2 no-underline"
                >
                  <MessageCircle size={19} />
                  {t('help_ask_ai')}
                </Link>
              </div>
            </div>
          </motion.div>
        </div>

        <Footer />
      </main>
    </div>
  );
}
