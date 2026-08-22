'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

/**
 * "Go back" control for the standalone content pages.
 *
 * These pages are reached from several places and, on mobile, no longer sit
 * under a nav bar, so without this there is nothing to press but the browser
 * chrome. The arrow flips for RTL, where "back" points the other way.
 *
 * router.back() is only used when there is somewhere to go back TO. A visitor
 * who opened the page from a shared link or a search result has no in-app
 * history, and back() would walk them off the site — those land on `fallback`
 * instead.
 */
export default function BackButton({
  fallback = '/',
  className = '',
}: {
  fallback?: string;
  className?: string;
}) {
  const router = useRouter();
  const { t, isRTL } = useLanguage();
  const Arrow = isRTL ? ArrowRight : ArrowLeft;

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== 'undefined' && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallback);
        }
      }}
      // Mobile only: on desktop the top bar carries the navigation, so this
      // would be a second way to do the same thing taking up header space.
      className={`group md:hidden inline-flex items-center gap-2 px-3.5 py-2 rounded-full
                  border border-[var(--border)] bg-[var(--surface-1)]
                  text-[13px] font-semibold text-[var(--muted)]
                  hover:text-[var(--text)] hover:bg-[var(--surface-2)]
                  active:scale-95 transition-all no-underline ${className}`}
    >
      <Arrow
        size={15}
        className={`shrink-0 transition-transform ${isRTL ? 'group-hover:translate-x-0.5' : 'group-hover:-translate-x-0.5'}`}
      />
      <span>{t('back') || 'Go back'}</span>
    </button>
  );
}
