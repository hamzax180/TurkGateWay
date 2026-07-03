'use client';

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowRight, CheckCircle, Bot, Globe, Database,
  Clock, Building2, FileText, ShieldCheck,
  ChevronDown, Search, Sparkles, Plus, Mic, Send
} from 'lucide-react';
import type { Variants } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useLanguage } from './context/LanguageContext';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import TypewriterText from './components/TypewriterText';
import Footer from './components/Footer';

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

const FlipCard = ({ step, i, isRTL, t, openIndex, setOpenIndex }: { step: any; i: number; isRTL: boolean; t: any; openIndex: number | null; setOpenIndex: (v: number | null) => void }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile so the "grow" pop only fires on small screens
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // On mobile only one card is open at a time (opening one auto-closes the rest);
  // desktop keeps independent flipping.
  const flipped = isMobile ? openIndex === i : isFlipped;
  const handleToggle = () => {
    if (isMobile) {
      setOpenIndex(openIndex === i ? null : i);
    } else {
      setIsFlipped(!isFlipped);
    }
  };

  // Mushroom-pop: the active card springs bigger and sits above its neighbors
  const popScale = isMobile && flipped ? 1.22 : 1;

  return (
    <motion.div
      whileInView={{ opacity: 1, y: 0 }}
      initial={{ opacity: 0, y: 30 }}
      viewport={{ once: true }}
      transition={{ delay: i * 0.15, duration: 0.8, ease: "easeOut" }}
      style={{ zIndex: isMobile && flipped ? 30 : 1 }}
      className="relative w-full h-[160px] md:h-[400px] cursor-pointer group [perspective:1200px]"
      onClick={handleToggle}
    >
      <motion.div
        className="w-full h-full relative [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0, scale: popScale }}
        transition={{
          rotateY: { duration: 0.8, ease: [0.16, 1, 0.3, 1] }, // Smooth snappy curve
          scale: { type: 'spring', stiffness: 430, damping: 11, mass: 0.7 }, // Bouncy "shroom" overshoot
        }}
      >
        {/* Front */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] flex flex-col justify-center items-center text-center rounded-2xl md:rounded-[32px] bg-gradient-to-br from-white/10 to-white/0 backdrop-blur-md border border-white/20 p-2.5 md:p-10 shadow-[0_8px_32px_rgba(0,0,0,0.3)] hover:bg-white/10 hover:border-white/30 transition-all duration-500">
          <h4 className="text-sm md:text-5xl font-medium text-white drop-shadow-md tracking-tight leading-tight mb-0 md:mb-6">{step.title}</h4>


        </div>

        {/* Back */}
        <div className="absolute inset-0 w-full h-full [backface-visibility:hidden] [transform:rotateY(180deg)] flex flex-col justify-center items-center text-center rounded-2xl md:rounded-[32px] bg-gradient-to-br from-[#1a1a2e]/40 to-[#16213e]/40 backdrop-blur-2xl border border-white/20 p-2.5 md:p-10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] transition-all duration-500">
          <p className="text-[9px] md:text-[22px] text-white/90 leading-snug md:leading-relaxed font-light">
            {step.desc}
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default function Home() {
  const { t, isRTL } = useLanguage();
  const { user, token } = useAuth();
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openCard, setOpenCard] = useState<number | null>(null); // single-open flip cards (mobile)

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

  const handleSessionSelect = (id: string, title: string) => {
    router.push(`/chat?session_id=${id}`);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg)] transition-colors duration-500 relative">
      <Sidebar
        currentSessionId={null}
        assistantType="permit"
        onSessionSelect={handleSessionSelect}
        onNewChat={() => router.push('/chat')}
        onDeleteSession={() => {}} // History deletion mostly done in chat or dashboard
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      <div className="flex-1 h-full overflow-y-auto relative slim-scroll block">
        <Navbar isAppPage={true} transparentTop={true} onMobileMenuClick={() => setMobileMenuOpen(true)} />
        <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col items-center justify-start overflow-x-hidden relative transition-colors duration-500 -mt-[64px]">
          
          {/* Real Turkish Flag Video Background */}
        <div className="absolute inset-x-0 top-0 h-[52vh] md:h-[58vh] xl:h-[90vh] dark:bg-[#a00000] bg-gradient-to-br from-white via-red-50 to-red-100 pointer-events-none z-0 select-none overflow-hidden">
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
              preload="auto"
              disablePictureInPicture
              controlsList="nofullscreen nodownload"
              src="/turkeyflag.mp4"
              onContextMenu={(e) => e.preventDefault()}
              onLoadedData={(e) => {
                try {
                  (e.currentTarget as HTMLVideoElement).play().catch(() => {});
                } catch (err) {}
              }}
              onPlaying={(e) => {
                const placeholder = (e.currentTarget as HTMLVideoElement).parentElement?.querySelector('.video-hero-placeholder') as HTMLElement;
                if (placeholder) {
                  placeholder.style.opacity = '0';
                  placeholder.style.pointerEvents = 'none';
                }
              }}
              className="absolute inset-0 w-full h-full object-cover object-[50%_25%] scale-110 md:scale-105 dark:brightness-100 brightness-[1.2] grayscale-[0.2] bg-video-hidden z-0"
              style={{ WebkitPlaysinline: 'true', WebkitBackfaceVisibility: 'hidden' } as any}
            />

            {/* Placeholder ON TOP of video — covers iOS native play button until playback actually starts */}
            <div className="video-hero-placeholder absolute inset-0 w-full h-full bg-white dark:bg-black transition-opacity duration-700 opacity-100 z-20 pointer-events-none" />

            {/* Silk Texture Simulation Overlay (kept for added luxury feel) */}
            <div className="absolute inset-0 opacity-10 cloth-shimmer z-10" />
          </motion.div>

          {/* Depth Overlays — Added -1px bottom to bleed over any sub-pixel gaps */}
          <div className="absolute inset-x-0 bottom-[-2px] h-64 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/80 to-transparent z-30" />
        </div>

      {/* ═══════════════ PERMIT ASSISTANT CONTENT ═══════════════ */}
      <section className="w-full max-w-4xl mx-auto flex flex-col items-center text-center space-y-4 md:space-y-5 pt-14 md:pt-16 pb-4 md:pb-6 xl:h-[90vh] xl:pt-[18vh] xl:pb-10 px-6 relative z-10">

        {/* Animated Header Group */}
        <motion.div
          initial={{ opacity: 0, y: 30, filter: 'blur(20px)', scale: 0.95 }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-2 md:space-y-3"
        >
          <div className="flex items-center justify-center gap-3 mb-1">
            <div className="w-5 h-5 animate-pulse bg-gradient-to-tr from-[#4285f4] via-[#9b72cb] to-[#d96570] rounded-full blur-[2px] opacity-80" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-[#8ab4f8] dark:to-[#9b72cb] font-semibold text-base md:text-lg drop-shadow-[0_2px_10px_rgba(255,255,255,0.8)]">
              {t('home_hero_greeting_user').replace('Hamza', user?.fullName || 'Guest')}
            </span>
          </div>

          <h1 
            className="text-4xl md:text-6xl font-bold tracking-tight text-white leading-tight min-h-[80px] md:min-h-[120px] flex items-center justify-center"
            style={{ 
              textShadow: '0 4px 20px rgba(0,0,0,0.5), -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000' 
            }}
          >
            <TypewriterText text={t('home_hero_title')} speed={40} />
          </h1>

          <motion.h2
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 1 }}
            className="text-xl md:text-2xl text-[var(--muted)] font-light max-w-2xl mx-auto"
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
            className="text-base md:text-lg text-[var(--muted)] font-light italic opacity-80"
            style={{ 
              textShadow: '0 2px 10px rgba(255,255,255,1), -0.5px -0.5px 0 #000, 0.5px -0.5px 0 #000, -0.5px 1.5px 0 #000, 0.5px 1.5px 0 #000' 
            }}
          >
            {t('home_hero_question') || 'Where should we start?'}
          </motion.p>
        </motion.div>

        {/* Minimalist Pill Input Bar (Matched to Chat) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1.8, duration: 0.5 }}
          className="w-full max-w-2xl relative group px-4"
        >
          <div className="absolute inset-0 bg-indigo-500/5 rounded-full blur-2xl group-hover:bg-indigo-500/10 transition-all duration-300 -z-10" />
          <div className="relative flex items-center gap-2 rounded-full p-1.5 border border-[var(--border)] bg-[var(--surface-1)] shadow-lg focus-within:shadow-xl transition-all">
            <button className="hidden sm:flex p-2.5 text-[var(--muted)] hover:text-[var(--text)] transition-colors shrink-0">
              <Plus size={22} />
            </button>
            
            <input
              type="text"
              placeholder={t('chat_placeholder') || "Ask TurkGateway AI agents..."}
              className="flex-1 bg-transparent py-3 px-2 md:px-1 text-[16px] md:text-[18px] text-[var(--text)] placeholder:text-[var(--muted)]/50 focus:outline-none min-w-0"
            />

            <div className="flex items-center gap-1 md:gap-1.5 pr-1 shrink-0">
              <Link href="/chat">
                <button className="flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-full bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface-3)] transition-all shrink-0">
                  <div className="flex items-center gap-0.5">
                    <div className="w-0.5 h-3 bg-current rounded-full animate-pulse" />
                    <div className="w-0.5 h-2 bg-current rounded-full" />
                    <div className="w-0.5 h-3.5 bg-current rounded-full animate-pulse" />
                  </div>
                  <span className="hidden sm:inline text-[13px] font-bold tracking-tight">{t('chat_voice') || "Voice"}</span>
                </button>
              </Link>
              
              <Link href="/chat">
                <button className="h-10 w-10 flex items-center justify-center rounded-full bg-[var(--text)] text-[var(--bg)] hover:opacity-90 transition-all shrink-0 shadow-sm">
                  <ArrowRight size={20} />
                </button>
              </Link>
            </div>
          </div>
        </motion.div>


        {/* Scroll Down Arrow */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.8, duration: 1 }}
          className="pt-2 flex flex-col items-center gap-1 cursor-pointer group xl:mt-auto"
          onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--muted)] group-hover:text-[var(--text)] transition-colors">
            {t('how_it_works_label')}
          </span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="text-[var(--muted)] group-hover:text-[var(--accent)] transition-colors"
          >
            <ChevronDown size={20} />
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
            preload="auto"
            disablePictureInPicture
            controlsList="nofullscreen nodownload"
            src="/how_it_works.mp4"
            onContextMenu={(e) => e.preventDefault()}
            onLoadedData={(e) => {
              try {
                (e.currentTarget as HTMLVideoElement).play().catch(() => {});
              } catch (err) {}
            }}
            onPlaying={(e) => {
              const placeholder = (e.currentTarget as HTMLVideoElement).parentElement?.querySelector('.video-section-placeholder') as HTMLElement;
              if (placeholder) {
                placeholder.style.opacity = '0';
                placeholder.style.pointerEvents = 'none';
              }
            }}
            className="absolute inset-0 w-full h-full object-cover bg-video-hidden z-0"
            style={{ WebkitPlaysinline: 'true', WebkitBackfaceVisibility: 'hidden' } as any}
          />

          {/* Placeholder ON TOP of video — covers iOS native play button until playback actually starts */}
          <div className="video-section-placeholder absolute inset-0 w-full h-full bg-white dark:bg-black transition-opacity duration-700 opacity-100 z-20 pointer-events-none" />

          {/* Sharp Gradual Transitions (The Split) */}
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[var(--bg)] to-transparent z-30" />
        </div>

        <div className="max-w-6xl mx-auto relative z-10 px-6 text-center">
          <div className="mb-10 md:mb-24 space-y-6">
            <h2 className="text-2xl md:text-7xl font-medium text-white drop-shadow-[0_6px_10px_rgba(0,0,0,0.9)] tracking-tight leading-tight max-w-4xl mx-auto">{t('process_subtitle')}</h2>
          </div>

          <div className="grid grid-cols-3 gap-2 md:gap-16 px-1 md:px-0">
            {stepsData.map((step, i) => (
              <div key={i}>
                <FlipCard step={step} i={i} isRTL={isRTL} t={t} openIndex={openCard} setOpenIndex={setOpenCard} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>

    {/* ── Minimalist Footer ── */}
    <Footer />
      </div>
    </div>
  );
}
