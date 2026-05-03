'use client';

import { useLanguage } from '../context/LanguageContext';
import { motion } from 'framer-motion';

const langs = [
  { code: 'en', label: 'EN' },
  { code: 'tr', label: 'TR' },
  { code: 'ar', label: 'AR' },
] as const;

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-0.5 bg-[var(--surface-2)] p-1 rounded-full border border-[var(--border)]">
      {langs.map((lang) => {
        const active = language === lang.code;
        return (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={`relative px-2.5 py-1 text-[11px] font-bold tracking-wider rounded-full transition-all duration-200 ${
              active
                ? 'text-[var(--text)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {active && (
              <motion.div
                layoutId="active-lang"
                className="absolute inset-0 bg-[var(--surface)] shadow-sm rounded-full border border-[var(--border)]"
                transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }}
              />
            )}
            <span className="relative z-10">{lang.label}</span>
          </button>
        );
      })}
    </div>
  );
}
