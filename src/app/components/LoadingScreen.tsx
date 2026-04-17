'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Cpu, RefreshCw } from 'lucide-react';

const agents = [
  { name: 'PERMIT', label: 'Deploying Permit Agent', desc: 'Mapping work permit regulations, residence applications, and e-Devlet authentication pathways.', color: 'red' },
  { name: 'STUDENT', label: 'Deploying Student Agent', desc: 'Analyzing university enrollment pipelines, ÖYS registration systems, and student visa compliance.', color: 'blue' },
  { name: 'LEGAL', label: 'Deploying Legal Agent', desc: 'Indexing Turkish commercial law articles, contract frameworks, and legal precedent databases.', color: 'emerald' },
];

export default function LoadingScreen() {
  const { t, isRTL } = useLanguage();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((prev) => (prev + 1) % 3);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  const agent = agents[phase];

  const chipGradient = phase === 0
    ? 'bg-gradient-to-br from-red-600 via-red-700 to-red-950 border-red-400/30 shadow-red-600/30'
    : phase === 1
    ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-blue-950 border-blue-400/30 shadow-blue-500/30'
    : 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-950 border-emerald-400/30 shadow-emerald-500/30';

  const glowColor = phase === 0 ? 'bg-red-600/30' : phase === 1 ? 'bg-blue-500/30' : 'bg-emerald-500/30';
  const ambientColor = phase === 0 ? 'bg-red-600' : phase === 1 ? 'bg-blue-500' : 'bg-emerald-500';
  const labelColor = phase === 0 ? 'text-red-500/70' : phase === 1 ? 'text-blue-400/70' : 'text-emerald-400/70';
  const barVia = phase === 0 ? 'via-red-600' : phase === 1 ? 'via-blue-500' : 'via-emerald-500';
  const spinColor = phase === 0 ? 'text-red-800' : phase === 1 ? 'text-blue-700' : 'text-emerald-700';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--bg)] overflow-hidden transition-colors duration-500">
      {/* Ambient Glow — synced to agent color */}
      <div className="absolute inset-0 pointer-events-none transition-all duration-1000">
         <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[200px] opacity-[0.08] transition-colors duration-1000 ${ambientColor}`} />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* The Chip: Color-Shifting Processor */}
        <div className="relative mb-20 flex items-center justify-center">
          {/* Outer glow */}
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.15, 0.35, 0.15] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            className={`absolute inset-[-30px] rounded-[36px] blur-[50px] transition-colors duration-1000 ${glowColor}`}
          />

          {/* The Chip */}
          <div className={`relative h-28 w-28 rounded-[28px] border transition-all duration-1000 shadow-2xl flex items-center justify-center overflow-hidden ${chipGradient}`}>
            {/* Circuit texture */}
            <div className="absolute inset-0 opacity-30 bg-[linear-gradient(45deg,transparent_45%,#ffffff_48%,#ffffff_52%,transparent_55%)] bg-[length:8px_8px] mix-blend-overlay" />
            
            {/* Scan beam */}
            <motion.div
              animate={{ y: ['-120%', '120%'] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
              className="absolute inset-x-0 h-[2px] bg-white/40 shadow-[0_0_12px_rgba(255,255,255,0.4)] z-20"
            />

            <Cpu size={44} className="text-white relative z-10 drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
          </div>
        </div>

        {/* Agent Cycling Text */}
        <div className="text-center min-h-[220px] flex flex-col items-center">
          {/* Phase label */}
          <div className="mb-6">
            <span className={`text-[10px] font-black uppercase tracking-[0.6em] transition-colors duration-1000 ${labelColor}`}>
              {agent.label}
            </span>
          </div>

          {/* Agent name */}
          <AnimatePresence mode="wait">
            <motion.h3
              key={phase}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="text-3xl md:text-6xl font-black text-[var(--text)] tracking-[0.4em] mb-6 uppercase leading-none font-[Outfit] transition-colors duration-500"
            >
              {agent.name}
            </motion.h3>
          </AnimatePresence>

          {/* Agent description */}
          <AnimatePresence mode="wait">
            <motion.p
              key={`desc-${phase}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="text-base text-[var(--muted)] max-w-lg leading-relaxed mb-10 transition-colors duration-500 font-medium"
            >
              {agent.desc}
            </motion.p>
          </AnimatePresence>

          {/* Progress bar */}
          <div className="w-80 h-[1.5px] bg-[var(--text)]/[0.04] relative overflow-hidden mb-8">
            <motion.div 
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
              className={`absolute inset-0 bg-gradient-to-r from-transparent to-transparent transition-all duration-1000 ${barVia}`}
            />
          </div>

          {/* Micro status */}
          <div className="flex items-center gap-3 text-[10px] font-black text-[var(--muted)] tracking-[0.4em] uppercase opacity-40">
             <RefreshCw size={10} className={`animate-spin transition-colors duration-1000 ${spinColor}`} />
             <span>Initializing neural systems</span>
          </div>
        </div>
      </div>
    </div>
  );
}
