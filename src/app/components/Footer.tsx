'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full py-12 border-t border-[var(--border)] bg-[var(--surface)] relative z-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col items-center gap-8">
        <div className="flex flex-wrap justify-center items-center gap-x-12 gap-y-4">
          <Link href="/terms" className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Terms
          </Link>
          <Link href="/privacy" className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Privacy
          </Link>
          <Link href="/help" className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Help
          </Link>
          <Link href="/download" className="text-[11px] font-semibold tracking-[0.2em] uppercase text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            Download App
          </Link>
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-[10px] font-bold tracking-[0.3em] uppercase text-[var(--muted)] opacity-30 text-center"
        >
          © 2026 TurkGateWay • POWERED BY{' '}
          <a
            href="https://webocontrol.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block hover:opacity-100 transition-opacity"
          >
            <span>WEBO</span><span className="text-red-600">CONTROL</span>
          </a>
        </motion.p>
      </div>
    </footer>
  );
}
