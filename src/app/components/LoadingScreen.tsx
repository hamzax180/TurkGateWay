'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Cpu, ShieldCheck, Database, Layers, CheckCircle2, Sparkles } from 'lucide-react';

export default function LoadingScreen() {
  const { t, isRTL } = useLanguage();
  const [step, setStep] = useState(0);

  const loadingSteps = [
    { key: 'loading_preparing', icon: Cpu, color: 'text-purple-500' },
    { key: 'loading_verifying', icon: ShieldCheck, color: 'text-red-500' },
    { key: 'loading_analyzing', icon: Layers, color: 'text-blue-500' },
    { key: 'loading_building', icon: Sparkles, color: 'text-amber-500' },
    { key: 'loading_finalizing', icon: Database, color: 'text-emerald-500' },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % loadingSteps.length);
    }, 2000);
    return () => clearInterval(timer);
  }, [loadingSteps.length]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--bg)] overflow-hidden">
      {/* Cinematic Background Elements */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600/10 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/10 blur-[120px] animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* Central Animation Unit */}
        <div className="relative mb-12">
          {/* Rotating Rings */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            className="w-48 h-48 rounded-full border border-dashed border-purple-500/30 flex items-center justify-center"
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
            className="absolute inset-2 rounded-full border border-dashed border-blue-500/20"
          />
          
          {/* Pulse Core */}
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              animate={{ 
                scale: [1, 1.15, 1],
                opacity: [0.5, 0.8, 0.5]
              }}
              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
              className="w-24 h-24 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 blur-2xl opacity-50"
            />
            
            <motion.div
              key={step}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.2, opacity: 0 }}
              className="absolute z-20"
            >
              {(() => {
                const Icon = loadingSteps[step].icon;
                return <Icon size={44} className={`${loadingSteps[step].color} drop-shadow-[0_0_15px_rgba(168,85,247,0.5)]`} />;
              })()}
            </motion.div>
          </div>

          {/* Orbiting particles */}
          {[...Array(6)].map((_, i) => (
            <motion.div
              key={i}
              animate={{ 
                rotate: 360,
                scale: [1, 1.2, 1]
              }}
              transition={{ 
                rotate: { duration: 10 + i * 2, repeat: Infinity, ease: "linear" },
                scale: { duration: 3, repeat: Infinity, ease: "easeInOut", delay: i * 0.5 }
              }}
              className="absolute inset-0 flex items-start justify-center"
              style={{ transform: `rotate(${i * 60}deg)` }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.8)] mt-[-0.75rem]" />
            </motion.div>
          ))}
        </div>

        {/* Text Area */}
        <div className="w-full max-w-sm px-6 text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="flex flex-col items-center"
            >
              <h2 className="text-xl font-black text-gradient-premium tracking-tight mb-2">
                {t(loadingSteps[step].key)}
              </h2>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ 
                        opacity: i === step ? 1 : 0.2,
                        scale: i === step ? 1.2 : 1
                      }}
                      className="w-1.5 h-1.5 rounded-full bg-purple-500"
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
          
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
            className="text-[10px] text-[var(--muted)] font-bold uppercase tracking-[0.25em] mt-8"
          >
            {t('agent_name')}
          </motion.p>
        </div>
      </div>

      {/* Modern Scanning Effect */}
      <motion.div 
        animate={{ translateY: ['0%', '100%', '0%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        className="absolute inset-x-0 top-0 h-[30%] bg-gradient-to-b from-transparent via-purple-500/5 to-transparent pointer-events-none"
      />
    </div>
  );
}
