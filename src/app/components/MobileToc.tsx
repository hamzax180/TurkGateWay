'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

type Section = { id: string; label: string; color: string };
type ColorMap = Record<string, { text: string; dot: string; light: string; border: string }>;

/**
 * Mobile-only floating Table of Contents.
 * Stays hidden while the full in-flow CONTENTS list (#toc-full) is on screen,
 * then fades in as a slim collapsed pill pinned under the navbar once that list
 * scrolls away. Collapsed by default (one thin row showing the current section)
 * to maximise reading space; tapping it expands the full 2-column grid.
 */
export default function MobileToc({
  sections,
  activeSection,
  onSelect,
  C,
  scrollContainerId,
}: {
  sections: Section[];
  activeSection: string;
  onSelect: (id: string) => void;
  C: ColorMap;
  /** When the page scrolls inside a container (not the window), pass its id. */
  scrollContainerId?: string;
}) {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const scroller = scrollContainerId ? document.getElementById(scrollContainerId) : null;
    const scrollTarget: HTMLElement | Window = scroller ?? window;
    const getScrollY = () => (scroller ? scroller.scrollTop : window.scrollY);

    const onScroll = () => {
      const full = document.getElementById('toc-full');
      // Show the compact bar once the full list has scrolled under the navbar.
      setShow(full ? full.getBoundingClientRect().bottom < 72 : getScrollY() > 420);
    };
    onScroll();
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      scrollTarget.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [scrollContainerId]);

  const active = sections.find(s => s.id === activeSection) ?? sections[0];
  const activeColor = active ? C[active.color] : undefined;

  return (
    <AnimatePresence>
      {show && (
        <motion.nav
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="lg:hidden fixed top-2 inset-x-3 z-[60] rounded-2xl border border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.28)] overflow-hidden"
        >
          {/* Collapsed header — single slim row, tap to expand */}
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-full flex items-center gap-2 px-3 py-2"
          >
            <span className="text-[8px] font-bold tracking-[0.25em] uppercase text-[var(--muted)] opacity-50 shrink-0">
              Contents
            </span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeColor ? activeColor.dot : 'bg-[var(--muted)]'}`} />
            <span className={`truncate text-[11px] font-semibold ${activeColor ? activeColor.text : 'text-[var(--text)]'}`}>
              {active?.label}
            </span>
            <ChevronDown
              size={14}
              className={`ml-auto shrink-0 text-[var(--muted)] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Expanded grid */}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-1 px-2.5 pb-2.5 pt-0.5 border-t border-[var(--border)]">
                  {sections.map(({ id, label, color }) => {
                    const c = C[color];
                    const isActive = activeSection === id;
                    return (
                      <button
                        key={id}
                        onClick={() => { onSelect(id); setExpanded(false); }}
                        className={`text-left flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition-colors duration-200 ${
                          isActive
                            ? `${c.light} ${c.text} border ${c.border}`
                            : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent'
                        }`}
                      >
                        <span className={`w-1 h-1 rounded-full shrink-0 ${isActive ? c.dot : 'bg-[var(--muted)] opacity-40'}`} />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
