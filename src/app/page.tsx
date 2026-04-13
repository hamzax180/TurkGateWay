'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, CheckCircle, Bot, Globe, Database,
  Clock, Building2, FileText, ShieldCheck,
  ChevronDown, Search, Sparkles
} from 'lucide-react';
import type { Variants } from 'framer-motion';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';

/* ── Animation Variants ── */
const fade: Variants = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0 } };
const stagger: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.09, delayChildren: 0.1 } } };

/* ── Data ── */
const howItWorksData = (t: any) => [
  { num: '01', icon: FileText, title: t('home_step1_title'), desc: t('home_step1_desc') },
  { num: '02', icon: Bot, title: t('home_step2_title'), desc: t('home_step2_desc') },
  { num: '03', icon: Building2, title: t('home_step3_title'), desc: t('home_step3_desc') },
  { num: '04', icon: ShieldCheck, title: t('home_step4_title'), desc: t('home_step4_desc') },
];

const featuresData = (t: any) => [
  { icon: Bot, title: t('home_feature_agents'), desc: t('home_feature_agents_desc'), badge: 'PydanticAI' },
  { icon: Globe, title: t('home_feature_districts'), desc: t('home_feature_districts_desc'), badge: 'Istanbul' },
  { icon: Database, title: t('home_feature_tracking'), desc: t('home_feature_tracking_desc'), badge: 'LangGraph' },
];

const statsData = (t: any) => [
  { value: '39', label: t('home_stat_districts') },
  { value: '14+', label: t('home_stat_types') },
  { value: '85%', label: t('home_stat_time') },
  { value: '98%', label: t('home_stat_success') },
];

const logos = ['Beşiktaş', 'Kadıköy', 'Şişli', 'Üsküdar', 'Ataşehir', 'Bakırköy'];

const howItWorksSteps = (t: any) => [
  {
    title: t('process_step1_title'),
    desc: t('process_step1_desc'),
  },
  {
    title: t('process_step2_title'),
    desc: t('process_step2_desc'),
  },
  {
    title: t('process_step3_title'),
    desc: t('process_step3_desc'),
  }
];

const FlipCard = ({ step, i, isRTL, t }: { step: any; i: number; isRTL: boolean; t: any }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const clickText = t('click_to_flip');
  const displayText = (!clickText || clickText === 'click_to_flip' || clickText === 'CLICK_TO_FLIP') ? 'Tap to reveal' : clickText;

  return (
    <motion.div
      whileInView={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 30 }}
      viewport={{ once: true }}
      transition={{ delay: i * 0.15, duration: 0.8, ease: "easeOut" }}
      className="relative w-full h-[400px] cursor-pointer group [perspective:1200px]"
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="w-full h-full relative [transform-style:preserve-3d]"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} // Smooth snappy curve
      >
        {/* Front */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] flex flex-col justify-center items-center text-center rounded-[32px] bg-gradient-to-br from-white/10 to-white/0 backdrop-blur-md border border-white/20 p-10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:bg-white/10 hover:border-white/30 transition-all duration-500">
          <h4 className="text-4xl md:text-5xl font-medium text-white drop-shadow-md tracking-tight leading-[1.1] mb-6">{step.title}</h4>
          
          <div className="opacity-70 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center gap-3 text-white font-bold tracking-[0.2em] uppercase">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
            </span>
            {displayText}
          </div>
        </div>

        {/* Back */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] flex flex-col justify-center items-center text-center rounded-[32px] bg-gradient-to-br from-[#1a1a2e]/40 to-[#16213e]/40 backdrop-blur-2xl border border-white/20 p-10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-500">
          <p className="text-[20px] md:text-[22px] text-white/90 leading-relaxed font-light">
            {step.desc}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default function Home() {
  const { t, isRTL } = useLanguage();
  const { user } = useAuth();
  const stepsData = howItWorksSteps(t);
  const featureData = featuresData(t);
  const statsDisplay = statsData(t);
  
  // Adjusted categories for dynamic labels
  const categories = [
    { label: t('hero_cat_upload'), icon: FileText, color: 'text-blue-500' },
    { label: t('hero_cat_status'), icon: Clock, color: 'text-purple-500' },
    { label: t('hero_cat_protocols'), icon: Building2, color: 'text-rose-500' },
    { label: t('hero_cat_safety'), icon: ShieldCheck, color: 'text-emerald-500' },
  ];
  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col items-center justify-center transition-colors duration-500 overflow-hidden relative">
        
        {/* Real Turkish Flag Video Background */}
        <div className="absolute inset-x-0 top-0 h-[55vh] md:h-[56vh] dark:bg-[#a00000] bg-gradient-to-br from-white via-red-50 to-red-100 pointer-events-none z-0 select-none overflow-hidden">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 2 }}
            className={`absolute inset-0 turkish-flag-mask dark:opacity-100 opacity-30`}
          >
            <video
              autoPlay
              loop
              muted
              playsInline
              className="absolute inset-0 w-full h-full object-cover object-[50%_25%] scale-110 md:scale-105 dark:brightness-100 brightness-[1.2] grayscale-[0.2]"
            >
              <source src="/turkeyflag.mp4" type="video/mp4" />
            </video>
            
            {/* Silk Texture Simulation Overlay (kept for added luxury feel) */}
            <div className="absolute inset-0 opacity-10 cloth-shimmer" />
          </motion.div>

          {/* Depth Overlays — Added -1px bottom to bleed over any sub-pixel gaps */}
          <div className="absolute inset-x-0 bottom-[-2px] h-64 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/80 to-transparent z-30" />
        </div>

      {/* ═══════════════ PERMIT ASSISTANT CONTENT ═══════════════ */}
      <section className="w-full max-w-4xl mx-auto flex flex-col items-center text-center space-y-8 pt-20 md:pt-24 pb-10 px-6 relative z-10">

        {/* Animated Header Group */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="space-y-4"
        >
          <div className="flex items-center justify-center gap-3 mb-1">
            <div className="w-5 h-5 animate-pulse bg-gradient-to-tr from-[#4285f4] via-[#9b72cb] to-[#d96570] rounded-full blur-[2px] opacity-80" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-[#8ab4f8] dark:to-[#9b72cb] font-semibold text-base md:text-lg drop-shadow-[0_2px_10px_rgba(255,255,255,0.8)]">
              {t('home_hero_greeting_user').replace('Hamza', user?.fullName || 'Guest')}
            </span>
          </div>

          <h1 
            className="text-4xl md:text-7xl font-bold tracking-tight text-white leading-tight"
            style={{ 
              textShadow: '0 4px 20px rgba(0,0,0,0.5), -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000' 
            }}
          >
            {t('home_hero_title')}
          </h1>

          <motion.h2
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 1 }}
            className="text-2xl md:text-4xl text-[var(--muted)] font-light max-w-2xl mx-auto"
            style={{ 
              textShadow: '0 2px 15px rgba(255,255,255,1), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000' 
            }}
          >
            {t('home_hero_subtitle')}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 2 }}
            className="text-lg md:text-2xl text-[var(--muted)] font-light italic opacity-80"
            style={{ 
              textShadow: '0 2px 10px rgba(255,255,255,1), -0.5px -0.5px 0 #000, 0.5px -0.5px 0 #000, -0.5px 1.5px 0 #000, 0.5px 1.5px 0 #000' 
            }}
          >
            {t('home_hero_question') || 'Where should we start?'}
          </motion.p>
        </motion.div>

        {/* Minimalist Input Bar */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.8, duration: 0.5 }}
          className="w-full max-w-2xl relative group"
        >
          <div className="absolute inset-0 bg-[var(--accent)]/5 rounded-2xl blur-xl group-hover:bg-[var(--accent)]/10 transition-all duration-300 -z-10" />
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-4 md:p-6 flex flex-col gap-4 text-left shadow-xl dark:shadow-2xl">
            <input
              type="text"
              placeholder={t('chat_placeholder')}
              className="bg-transparent border-none outline-none text-lg md:text-xl text-[var(--text)] placeholder-[var(--muted)] w-full"
            />
            <div className="flex items-center justify-between pt-1 md:pt-2">
              <div className="flex items-center gap-4 text-[var(--muted)]">
                <FileText size={18} className="hover:text-[var(--text)] cursor-pointer transition-colors" />
                <Bot size={18} className="hover:text-[var(--text)] cursor-pointer transition-colors" />
              </div>
              <div className="flex items-center gap-2 md:gap-3">
                <span className="text-[10px] md:text-xs text-[var(--muted)] font-medium">Fast v2.5</span>
                <Link href="/chat">
                  <button className="bg-[var(--surface-2)] hover:bg-[var(--border-2)] p-1.5 md:p-2 rounded-full transition-colors border border-[var(--border)]">
                    <ArrowRight size={18} className="text-blue-500" />
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Category Pills - More tightly clustered under chat */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 1 }}
          className="flex flex-wrap items-center justify-center gap-2 md:gap-3 pt-1 pb-1"
        >
          {categories.map((item, i) => (
            <button
              key={i}
              className="flex items-center gap-2 px-4 md:px-5 py-2 md:py-2.5 rounded-full bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] transition-all text-xs md:text-sm font-medium text-[var(--text)] shadow-sm"
            >
              <item.icon size={14} className={item.color} />
              {item.label}
            </button>
          ))}
        </motion.div>

        {/* Scroll Down Arrow - Moved further up for better vertical alignment */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.8, duration: 1 }}
          className="pt-6 flex flex-col items-center gap-2 cursor-pointer group"
          onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">
            {t('how_it_works_label')}
          </span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors"
          >
            <ChevronDown size={24} />
          </motion.div>
        </motion.div>

      </section>

      {/* ═══════════════ HOW IT WORKS SECTION ═══════════════ */}
      <section id="how-it-works" className="w-full relative overflow-hidden py-40">
        {/* Live Video Background - Brighter & Full Fit */}
        <div className="absolute inset-0 z-0 w-full h-full">
          <video
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          >
            <source src="/how_it_works.mp4" type="video/mp4" />
          </video>
          {/* Sharp Gradual Transitions (The Split) */}
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[var(--bg)] to-transparent z-10" />
        </div>

        <div className="max-w-6xl mx-auto relative z-10 px-6 text-center">
          <div className="mb-24 space-y-6">
            <h2 className="text-5xl md:text-7xl font-medium text-white drop-shadow-[0_6px_10px_rgba(0,0,0,0.9)] tracking-tight leading-tight max-w-4xl mx-auto">{t('process_subtitle')}</h2>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
            className="md:hidden flex items-center justify-center gap-3 mb-10 text-white font-bold text-base tracking-[0.2em] uppercase drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]"
          >
            <span>{t('scroll_right') || 'Scroll Right'}</span>
            <ArrowRight size={20} className="animate-pulse text-white" />
          </motion.div>
 
          <div className="flex overflow-x-auto pb-12 md:grid md:grid-cols-3 md:gap-16 snap-x snap-mandatory no-scrollbar px-0 md:px-0">
            {stepsData.map((step, i) => (
              <div key={i} className="min-w-full md:min-w-0 snap-center px-6 md:px-0">
                <FlipCard step={step} i={i} isRTL={isRTL} t={t} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>

    {/* ── Minimalist Footer ── */}
    <footer className="w-full py-10 border-t border-white/5 bg-[var(--surface)] relative z-10">
      <div className="max-w-6xl mx-auto px-6 text-center">
        <motion.p 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-[11px] font-semibold tracking-[0.15em] uppercase text-[var(--muted)] opacity-70"
        >
          © 2026 ALL RIGHTS RESERVED BY TurkGateWay AND POWERED BY{' '}
          <a 
            href="https://webocontrol.com" 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-block hover:text-[var(--text)] transition-colors"
          >
            <span>WEBO</span><span className="text-red-600">CONTROL</span>
          </a>
        </motion.p>
      </div>
    </footer>
    </>
  );
}
