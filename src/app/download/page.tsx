'use client';

import { motion } from 'framer-motion';
import { Download, Monitor, CheckCircle, ShieldCheck, Apple, Laptop } from 'lucide-react';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import Footer from '../components/Footer';
import { useLanguage } from '../context/LanguageContext';

export default function DownloadPage() {
  const { t, isRTL } = useLanguage();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-[var(--primary)] selection:text-white flex flex-col font-sans" dir={isRTL ? 'rtl' : 'ltr'}>
      <Navbar />
      <MobileMenuButton />

      <main className="flex-grow pt-32 pb-24 relative overflow-hidden flex flex-col items-center justify-center">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-emerald-500/10 rounded-full blur-[80px] pointer-events-none" />

        <div className="container mx-auto px-6 relative z-10 text-center max-w-4xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
              {t('download_hero1')} <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-emerald-500">
                {t('download_hero2')}
              </span>
            </h1>

            <p className="text-xl text-[var(--muted)] max-w-2xl mx-auto mb-12">
              {t('download_desc')}
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 flex-wrap">
              <a href="/releases/TurkGateway-Windows-x64.exe" download className="w-full sm:w-auto relative group block">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-emerald-500 rounded-2xl blur opacity-25 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative flex items-center justify-center gap-3 px-8 py-4 bg-[#09090b] border border-white/10 text-white rounded-2xl font-bold tracking-wide hover:scale-[1.02] active:scale-[0.98] transition-all">
                  <Monitor size={22} className="text-blue-400" />
                  <span>Windows (x64)</span>
                  <Download size={18} className="opacity-70 group-hover:translate-y-1 transition-transform" />
                </div>
              </a>

              <a href="/releases/TurkGateway-Mac-Universal.dmg" download className="w-full sm:w-auto relative group block">
                <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl blur opacity-25 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative flex items-center justify-center gap-3 px-8 py-4 bg-[#09090b] border border-white/10 text-white rounded-2xl font-bold tracking-wide hover:scale-[1.02] active:scale-[0.98] transition-all">
                  <Apple size={22} className="text-purple-400" />
                  <span>Mac (Universal)</span>
                  <Download size={18} className="opacity-70 group-hover:translate-y-1 transition-transform" />
                </div>
              </a>

              <a href="/releases/TurkGateway-Linux-x86_64.AppImage" download className="w-full sm:w-auto relative group block">
                <div className="absolute -inset-1 bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl blur opacity-25 group-hover:opacity-60 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative flex items-center justify-center gap-3 px-8 py-4 bg-[#09090b] border border-white/10 text-white rounded-2xl font-bold tracking-wide hover:scale-[1.02] active:scale-[0.98] transition-all">
                  <Laptop size={22} className="text-amber-400" />
                  <span>Linux (AppImage)</span>
                  <Download size={18} className="opacity-70 group-hover:translate-y-1 transition-transform" />
                </div>
              </a>
            </div>

            <div className="grid grid-cols-3 gap-2 md:gap-6 text-left border-t border-[var(--border)] pt-8 md:pt-16">
              <div className="group relative p-3 md:p-8 rounded-xl md:rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] hover:border-blue-500/50 transition-all duration-500 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-blue-500/10">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl group-hover:bg-blue-500/20 transition-all hidden md:block" />
                <div className="relative z-10">
                  <div className="w-9 h-9 md:w-12 md:h-12 rounded-lg md:rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-blue-500 mb-3 md:mb-6 group-hover:scale-110 group-hover:border-blue-500/30 transition-all duration-500">
                    <Monitor className="w-4 h-4 md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-sm md:text-xl font-bold mb-1.5 md:mb-3 text-[var(--text)] leading-tight">{t('download_feat1_title')}</h3>
                  <p className="text-[11px] md:text-sm text-[var(--muted)] leading-snug md:leading-relaxed">{t('download_feat1_desc')}</p>
                </div>
              </div>

              <div className="group relative p-3 md:p-8 rounded-xl md:rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] hover:border-emerald-500/50 transition-all duration-500 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-emerald-500/10">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all hidden md:block" />
                <div className="relative z-10">
                  <div className="w-9 h-9 md:w-12 md:h-12 rounded-lg md:rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-emerald-500 mb-3 md:mb-6 group-hover:scale-110 group-hover:border-emerald-500/30 transition-all duration-500">
                    <ShieldCheck className="w-4 h-4 md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-sm md:text-xl font-bold mb-1.5 md:mb-3 text-[var(--text)] leading-tight">{t('download_feat2_title')}</h3>
                  <p className="text-[11px] md:text-sm text-[var(--muted)] leading-snug md:leading-relaxed">{t('download_feat2_desc')}</p>
                </div>
              </div>

              <div className="group relative p-3 md:p-8 rounded-xl md:rounded-3xl bg-[var(--surface-1)] border border-[var(--border)] hover:border-purple-500/50 transition-all duration-500 overflow-hidden shadow-sm hover:shadow-xl hover:shadow-purple-500/10">
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all hidden md:block" />
                <div className="relative z-10">
                  <div className="w-9 h-9 md:w-12 md:h-12 rounded-lg md:rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-purple-500 mb-3 md:mb-6 group-hover:scale-110 group-hover:border-purple-500/30 transition-all duration-500">
                    <CheckCircle className="w-4 h-4 md:w-6 md:h-6" />
                  </div>
                  <h3 className="text-sm md:text-xl font-bold mb-1.5 md:mb-3 text-[var(--text)] leading-tight">{t('download_feat3_title')}</h3>
                  <p className="text-[11px] md:text-sm text-[var(--muted)] leading-snug md:leading-relaxed">{t('download_feat3_desc')}</p>
                </div>
              </div>
            </div>

          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
