'use client';

import { useLanguage } from '../context/LanguageContext';
import { motion } from 'framer-motion';

/**
 * Language switcher — nine languages with their national flags.
 * The site's UI copy is fully translated for EN/TR/AR/TK; Azerbaijani, Uzbek,
 * Kazakh, Persian and Russian ride on the closest existing translation while
 * the AI agents answer natively in the selected language.
 */
const langs = [
  { code: 'en', label: 'English', flag: '/flags/gb.png' },
  { code: 'tr', label: 'Türkçe', flag: '/flags/tr.png' },
  { code: 'ar', label: 'العربية', flag: '/flags/sa.png' },
  { code: 'tk', label: 'Türkmençe', flag: '/flags/tm.png' },
  { code: 'az', label: 'Azərbaycanca', flag: '/flags/az.png' },
  { code: 'uz', label: "O'zbekcha", flag: '/flags/uz.png' },
  { code: 'kk', label: 'Қазақша', flag: '/flags/kz.png' },
  { code: 'fa', label: 'فارسی', flag: '/flags/ir.png' },
  { code: 'ru', label: 'Русский', flag: '/flags/ru.png' },
] as const;

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-1 bg-[var(--surface-2)] p-1 rounded-full border border-[var(--border)]">
      {langs.map((lang) => {
        const active = language === lang.code;
        return (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            title={lang.label}
            aria-label={lang.label}
            className={`relative h-7 w-7 rounded-full overflow-hidden border-2 transition-all duration-200 ${
              active
                ? 'border-[var(--text)] scale-110 shadow-md'
                : 'border-transparent opacity-60 hover:opacity-100 hover:scale-105'
            }`}
          >
            {active && (
              <motion.div
                layoutId="active-lang"
                className="absolute inset-0 rounded-full border border-[var(--border)]"
                transition={{ type: 'spring', bounce: 0.25, duration: 0.4 }}
              />
            )}
            <img src={lang.flag} alt={lang.label} className="h-full w-full object-cover" draggable={false} />
          </button>
        );
      })}
    </div>
  );
}
