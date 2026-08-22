'use client';

import { motion } from 'framer-motion';
import { Cpu, ArrowRight, X, MessageSquare, BarChart3, Mic } from 'lucide-react';

interface OnboardingWizardProps {
  /**
   * `remember: true` means never show this again — it is the only path that
   * persists anything. Continue and the close button pass false, so the wizard
   * returns next visit; that is what gives the "Don't show again" button a
   * reason to exist rather than duplicating Continue.
   */
  onDismiss: (remember: boolean) => void;
}

const CAPABILITIES = [
  { icon: MessageSquare, color: 'bg-blue-500', glow: 'shadow-blue-500/20', label: 'Pick your AI Agent', desc: 'Switch between Permit, Student, or Legal from the top badge.' },
  { icon: Cpu, color: 'bg-red-500', glow: 'shadow-red-500/20', label: 'Describe naturally', desc: 'Type your situation — the AI builds a full step-by-step roadmap.' },
  { icon: BarChart3, color: 'bg-violet-500', glow: 'shadow-violet-500/20', label: 'Get your Dashboard', desc: 'Documents, timelines & bots generated after your first message.' },
  { icon: Mic, color: 'bg-emerald-500', glow: 'shadow-emerald-500/20', label: 'Voice Mode', desc: 'Tap the mic for a hands-free AI call — listens and speaks back.' },
];



export default function OnboardingWizard({ onDismiss }: OnboardingWizardProps) {
  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl sm:rounded-3xl w-full max-w-md shadow-[0_32px_80px_rgba(0,0,0,0.5)] overflow-hidden"
      >
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/[0.03] to-transparent pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[var(--muted)] opacity-40 mb-0.5">TurkGateway AI</p>
            <h2 className="text-sm sm:text-base font-black text-[var(--text)] leading-tight">Welcome! Here&apos;s how it works</h2>
          </div>
          <button onClick={() => onDismiss(false)} className="w-7 h-7 rounded-xl flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-all shrink-0 ml-3">
            <X size={14} />
          </button>
        </div>

        {/* Capability cards — 2x2 grid */}
        <div className="px-4 sm:px-6 pb-3 sm:pb-4 grid grid-cols-2 gap-2">
          {CAPABILITIES.map((cap, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06, duration: 0.28 }}
              className="p-2.5 sm:p-3.5 rounded-xl sm:rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]"
            >
              <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl ${cap.color} flex items-center justify-center mb-2 shadow-md ${cap.glow}`}>
                <cap.icon size={13} className="text-white" />
              </div>
              <p className="text-[11px] sm:text-xs font-bold text-[var(--text)] mb-0.5 leading-tight">{cap.label}</p>
              <p className="text-[9px] sm:text-[10px] text-[var(--muted)] leading-relaxed">{cap.desc}</p>
            </motion.div>
          ))}
        </div>


        {/* Footer */}
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 flex items-center justify-between border-t border-[var(--border)] pt-3">
          <button
            onClick={() => onDismiss(true)}
            className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--text)] underline underline-offset-2 decoration-[var(--border)] hover:decoration-current transition-colors"
          >
            Don&apos;t show again
          </button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onDismiss(false)}
            className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-black shadow-[0_4px_20px_rgba(239,68,68,0.3)] ml-auto"
          >
            Continue <ArrowRight size={12} />
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}
