'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';

// TurkGateway brand red — shown when no agent is selected (page-level loads)
const BRAND = {
  color: '#ef4444',
  shadow: 'rgba(239, 68, 68, 0.55)',
  name: null, // null = show TURKGATEWAY wordmark
};

// Agent-specific colors — shown in chat (initial load + switching)
const AGENT_DATA = {
  permit:  { color: '#3b82f6', shadow: 'rgba(59, 130, 246, 0.6)',  name: 'PERMIT'  },
  student: { color: '#10b981', shadow: 'rgba(16, 185, 129, 0.6)',  name: 'STUDENT' },
  lawyer:  { color: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.6)',  name: 'LEGAL'   },
};

interface LoadingScreenProps {
  /** When provided, shows agent-specific branding (chat / agent switch).
   *  When omitted, shows TurkGateway brand (red). */
  agentType?: 'permit' | 'student' | 'lawyer';
}

export default function LoadingScreen({ agentType }: LoadingScreenProps) {
  const [isDark, setIsDark] = useState(false);

  // Pick brand (TurkGateway red) or agent-specific colors
  const agent = agentType ? AGENT_DATA[agentType] : null;
  const color  = agent?.color  ?? BRAND.color;
  const shadow = agent?.shadow ?? BRAND.shadow;
  const label  = agent?.name   ?? null; // null → show TURKGATEWAY wordmark

  useEffect(() => {
    const dark =
      document.documentElement.classList.contains('dark') ||
      localStorage.getItem('theme') === 'dark';
    setIsDark(dark);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden selection:bg-transparent transition-colors duration-300 ${
        isDark ? 'bg-[#09090b]' : 'bg-white'
      }`}
    >
      {/* Ambient glow */}
      <motion.div
        key={color}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.14 }}
        transition={{ duration: 0.7 }}
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(circle at center, ${shadow} 0%, transparent 60%)` }}
      />

      <div className="relative flex flex-col items-center justify-center z-10">
        {/* Chip */}
        <div className="relative w-44 h-44 flex items-center justify-center mb-10">
          <motion.div
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* Neon border draw */}
            <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100">
              <motion.rect
                x="2" y="2" width="96" height="96" rx="24"
                fill="transparent"
                stroke={color}
                strokeWidth="2.5"
                initial={{ pathLength: 0, strokeOpacity: 0 }}
                animate={{ pathLength: 1, strokeOpacity: 1 }}
                transition={{ duration: 0.9, ease: 'easeInOut' }}
                style={{ filter: `drop-shadow(0 4px 14px ${shadow})` }}
              />
            </svg>

            {/* Pulsing outer ring */}
            <motion.div
              animate={{ scale: [1, 1.12, 1], opacity: [0.12, 0.28, 0.12] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute inset-[-20px] rounded-[40px]"
              style={{ backgroundColor: color, filter: 'blur(30px)' }}
            />

            {/* CPU icon */}
            <motion.div
              initial={{ opacity: 0, scale: 0.65 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.22, duration: 0.42, ease: 'easeOut' }}
              className="relative z-10 flex items-center justify-center"
            >
              <Cpu size={72} color={color} strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 2px 10px ${shadow})` }}
              />

              {/* Scan beam */}
              <motion.div
                animate={{ y: ['-120%', '120%'] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute inset-x-0 h-[2px] rounded-full"
                style={{
                  background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
                  boxShadow: `0 0 8px 2px ${shadow}`,
                }}
              />

              {/* Core pulse */}
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [0.25, 0, 0.25] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute w-12 h-12 rounded-full"
                style={{ backgroundColor: color, filter: 'blur(18px)' }}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Wordmark */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.38, duration: 0.5 }}
          className="flex flex-col items-center"
        >
          <AnimatePresence mode="wait">
            <motion.h2
              key={label ?? 'brand'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="font-black uppercase tracking-[0.45em] font-[Outfit]"
              style={{
                fontSize: label ? '28px' : '22px',
                color: label ? color : 'white',
              }}
            >
              {label ?? 'TURKGATEWAY'}
            </motion.h2>
          </AnimatePresence>

          {/* Animated dots */}
          <div className="flex gap-2 mt-6">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ scale: [1, 1.3, 1], opacity: [0.25, 1, 0.25] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
