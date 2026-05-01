'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Cpu } from 'lucide-react';

const agents = [
  { name: 'PERMIT', color: '#ff2a2a', shadow: 'rgba(255, 42, 42, 0.6)' },
  { name: 'STUDENT', color: '#2a84ff', shadow: 'rgba(42, 132, 255, 0.6)' },
  { name: 'LEGAL', color: '#00e676', shadow: 'rgba(0, 230, 118, 0.6)' },
];

export default function LoadingScreen() {
  const [phase, setPhase] = useState(0);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Read theme immediately so loading screen matches app theme
    const dark =
      document.documentElement.classList.contains('dark') ||
      localStorage.getItem('theme') === 'dark';
    setIsDark(dark);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((prev) => (prev + 1) % 3);
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const agent = agents[phase];

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden selection:bg-transparent transition-colors duration-300 ${
      isDark ? 'bg-[#09090b]' : 'bg-white'
    }`}>

      {/* Intense Ambient Glow - Refined for White */}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={`ambient-${agent.name}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: `radial-gradient(circle at center, ${agent.shadow} 0%, transparent 60%)` }}
        />
      </AnimatePresence>

      <div className="relative flex flex-col items-center justify-center z-10 mt-10">

        {/* Core Chip Container */}
        <div className="relative w-44 h-44 flex items-center justify-center mb-16">
          <AnimatePresence mode="wait">
            <motion.div
              key={agent.name}
              initial={{ scale: 0.8, opacity: 0, filter: "blur(10px)" }}
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              exit={{ scale: 1.1, opacity: 0, filter: "blur(10px)" }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
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
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                  style={{ filter: `drop-shadow(0 4px 12px ${agent.shadow})` }}
                />
              </svg>

              {/* The Inner Glowing CPU */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.6, ease: "easeOut" }}
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
                  animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute w-12 h-12 rounded-full"
                  style={{ backgroundColor: agent.color, filter: "blur(16px)" }}
                />
              </motion.div>

            </motion.div>
          </AnimatePresence>
        </div>

        {/* Minimal Typography */}
        <div className="h-16 flex flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            <motion.h2
              key={`title-${agent.name}`}
              initial={{ opacity: 0, letterSpacing: "0.1em" }}
              animate={{ opacity: 1, letterSpacing: "0.4em" }}
              exit={{ opacity: 0, letterSpacing: "0.8em" }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className={`text-3xl font-bold uppercase tracking-[0.4em] ${isDark ? 'text-white' : 'text-black'}`}
            >
              {agent.name}
            </motion.h2>
          </AnimatePresence>

          {/* Subtle loading dots */}
          <div className="flex gap-1.5 mt-6">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                animate={{ scale: [1, 1.2, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }}
                className={`w-2 h-2 rounded-full ${isDark ? 'bg-white/20' : 'bg-black/20'}`}
              />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
