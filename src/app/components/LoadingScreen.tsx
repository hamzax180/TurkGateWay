'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';

const AGENT_DATA = {
  permit: { name: 'PERMIT', color: '#3b82f6', shadow: 'rgba(59, 130, 246, 0.6)' },
  student: { name: 'STUDENT', color: '#10b981', shadow: 'rgba(16, 185, 129, 0.6)' },
  lawyer: { name: 'LEGAL', color: '#f59e0b', shadow: 'rgba(245, 158, 11, 0.6)' },
};

interface LoadingScreenProps {
  agentType?: 'permit' | 'student' | 'lawyer';
}

export default function LoadingScreen({ agentType = 'permit' }: LoadingScreenProps) {
  const [isDark, setIsDark] = useState(false);
  const agent = AGENT_DATA[agentType] || AGENT_DATA.permit;

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
      transition={{ duration: 0.4, ease: "easeInOut" }}
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden selection:bg-transparent transition-colors duration-300 ${
        isDark ? 'bg-[#09090b]' : 'bg-white'
      }`}
    >
      {/* Intense Ambient Glow */}
      <motion.div
        key={`ambient-${agent.name}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.12 }}
        transition={{ duration: 0.6 }}
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: `radial-gradient(circle at center, ${agent.shadow} 0%, transparent 60%)` }}
      />

      <div className="relative flex flex-col items-center justify-center z-10">
        {/* Core Chip Container */}
        <div className="relative w-44 h-44 flex items-center justify-center mb-12">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 flex items-center justify-center"
          >
            {/* Neon Border Drawing Effect (SVG) */}
            <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100">
              <motion.rect
                x="2" y="2" width="96" height="96" rx="24"
                fill="transparent"
                stroke={agent.color}
                strokeWidth="2.5"
                initial={{ pathLength: 0, strokeOpacity: 0 }}
                animate={{ pathLength: 1, strokeOpacity: 1 }}
                transition={{ duration: 0.8, ease: "easeInOut" }}
                style={{ filter: `drop-shadow(0 4px 12px ${agent.shadow})` }}
              />
            </svg>

            {/* The Inner Glowing CPU */}
            <motion.div
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
              className="relative z-10 flex items-center justify-center"
            >
              <Cpu
                size={72}
                color={agent.color}
                strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 2px 8px ${agent.shadow})` }}
              />

              {/* Core pulse */}
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [0.3, 0, 0.3] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute w-12 h-12 rounded-full"
                style={{ backgroundColor: agent.color, filter: "blur(16px)" }}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* Minimal Typography */}
        <div className="flex flex-col items-center justify-center">
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            className={`text-2xl font-black uppercase tracking-[0.4em] ${isDark ? 'text-white' : 'text-black'}`}
          >
            {agent.name}
          </motion.h2>

          {/* Subtle loading dots */}
          <div className="flex gap-2 mt-8">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ scale: [1, 1.25, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                className={`w-2 h-2 rounded-full ${isDark ? 'bg-white/30' : 'bg-black/20'}`}
              />
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
