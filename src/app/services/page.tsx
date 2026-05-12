'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, Briefcase, GraduationCap, Scale, ChevronDown, CheckCircle2,
  X, ShieldCheck, RefreshCw, Cpu, Sparkles, FileText, BarChart3,
  Layers, MessageSquare, ListTodo, Lock, Fingerprint, Eye, MousePointer2
} from 'lucide-react';
import Navbar from '../components/Navbar';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import Footer from '../components/Footer';
import LoadingScreen from '../components/LoadingScreen';
import { useAuth } from '../context/AuthContext';

// --- Custom Select Component to prevent native OS upwards dropdown behavior ---
const CustomSelect = ({
  value,
  onChange,
  options,
  placeholder,
  maxH = 'max-h-48'
}: {
  value: string,
  onChange: (val: string) => void,
  options: { label: string, value: string }[],
  placeholder: string,
  maxH?: string
}) => {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find(o => o.value === value)?.label || placeholder;

  return (
    <div className="relative">
      <div
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 transition-all outline-none cursor-pointer flex justify-between items-center group shadow-sm"
      >
        <span className={!value ? 'text-[var(--muted)]' : 'text-[var(--text)]'}>{selectedLabel}</span>
        <ChevronDown size={16} className={`text-[var(--muted)] group-hover:text-[var(--text)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className={`absolute top-full left-0 right-0 mt-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-[0_15px_40px_-5px_rgba(0,0,0,0.3)] z-50 overflow-y-auto py-2 ${maxH}`}
            >
              {options.map((o, idx) => (
                <div
                  key={idx}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`px-4 py-2.5 text-sm cursor-pointer hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between ${value === o.value ? 'text-blue-500 font-bold bg-blue-500/5' : 'text-[var(--text)]'}`}
                >
                  {o.label}
                  {value === o.value && <CheckCircle2 size={14} className="text-blue-500" />}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
};

const STUDENT_SERVICES_OPTIONS = [
  { label: 'University Registration', value: 'University Registration' },
  { label: 'Student Visa Application', value: 'Student Visa Application' },
  { label: 'ID (Kimlik)', value: 'ID (Kimlik)' },
  { label: 'Lost Student ID', value: 'Lost Student ID' },
  { label: 'Student Istanbul Card', value: 'Student Istanbul Card' },
];

const KIMLIK_ACTION_OPTIONS = [
  { label: 'New ID — First-time application', value: 'new' },
  { label: 'Renew ID — Expired or expiring soon', value: 'renew' },
];

const PERMIT_SERVICES_OPTIONS = [
  { label: 'Restaurant', value: 'Restaurant' },
  { label: 'Cafe', value: 'Cafe' },
  { label: 'Retail Store', value: 'Retail Store' },
  { label: 'Pharmacy', value: 'Pharmacy' },
  { label: 'Office Space', value: 'Office Space' },
];

const UNIVERSITIES_OPTIONS = [
  "Istanbul Technical University", "Boğaziçi University", "Istanbul University",
  "Marmara University", "Yıldız Technical University", "Koç University",
  "Sabancı University", "Galatasaray University", "Bahçeşehir University",
  "Bilkent University", "Middle East Technical University (METU)"
].map(u => ({ label: u, value: u }));

const COUNTRIES_OPTIONS = [
  "USA", "UK", "Germany", "France", "Russia", "China", "India", "Pakistan",
  "Iran", "Iraq", "Egypt", "Morocco", "Syria", "Palestine", "Jordan",
  "Lebanon", "Saudi Arabia", "UAE", "Qatar", "Other"
].map(c => ({ label: c, value: c }));

const DISTRICTS_OPTIONS = [
  "Adalar", "Arnavutköy", "Ataşehir", "Avcılar", "Bağcılar", "Bahçelievler",
  "Bakırköy", "Başakşehir", "Bayrampaşa", "Beşiktaş", "Beykoz", "Beylikdüzü",
  "Beyoğlu", "Büyükçekmece", "Çatalca", "Çekmeköy", "Esenler", "Esenyurt",
  "Eyüpsultan", "Fatih", "Gaziosmanpaşa", "Güngören", "Kadıköy", "Kağıthane",
  "Kartal", "Küçükçekmece", "Maltepe", "Pendik", "Sancaktepe", "Sarıyer",
  "Silivri", "Sultanbeyli", "Sultangazi", "Şile", "Şişli", "Tuzla", "Ümraniye",
  "Üsküdar", "Zeytinburnu"
].map(d => ({ label: d, value: d }));


export default function ServicesPage() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const { isAuthenticated, setIsLoginModalOpen } = useAuth();
  const [selectedAgent, setSelectedAgent] = useState<'permit' | 'student' | 'lawyer' | null>(null);
  const [loadingAgent, setLoadingAgent] = useState<'permit' | 'student' | 'lawyer'>('permit');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  useEffect(() => {
    // Sync active agent for appropriate loading screen without opening the modal
    const active = localStorage.getItem('permitops_active_agent');
    if (active === 'student' || active === 'lawyer' || active === 'permit') {
      setLoadingAgent(active as 'permit' | 'student' | 'lawyer');
    }

    // Initial load animation
    const timer = setTimeout(() => setIsLoaded(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  const [lawyerMatterType, setLawyerMatterType] = useState('Contract Review');

  // Form states based on selections
  const [studentServiceType, setStudentServiceType] = useState('University Registration');
  const [kimlikAction, setKimlikAction] = useState('renew'); // 'new' | 'renew'
  const [studentUni, setStudentUni] = useState('');
  const [studentVisaCountry, setStudentVisaCountry] = useState('');

  const [permitServiceType, setPermitServiceType] = useState('Restaurant');
  const [permitDistrict, setPermitDistrict] = useState('Fatih');

  const [simulatedText, setSimulatedText] = useState(t('services_chat_greeting'));
  const [isTyping, setIsTyping] = useState(false);
  const [activeTask, setActiveTask] = useState<string | null>(null);
  const [showSimulatedChat, setShowSimulatedChat] = useState(false);
  const [simulatedResponse, setSimulatedResponse] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

  const handleSimulateTask = async (taskLabel: string) => {
    if (isTyping || isAiTyping) return; // Prevent spamming
    if (showSimulatedChat) {
      setShowSimulatedChat(false);
      setSimulatedResponse('');
    }

    setIsTyping(true);
    setActiveTask(taskLabel);

    // Map tasks to realistic prompts
    const prompts: Record<string, { text: string, agent: string }> = {
      [t('services_task_register')]: { text: t('services_prompt_register'), agent: 'lawyer' },
      [t('services_task_tax')]: { text: t('services_prompt_tax'), agent: 'lawyer' },
      [t('services_task_permit')]: { text: t('services_prompt_permit'), agent: 'permit' },
      [t('services_task_enroll')]: { text: t('services_prompt_enroll'), agent: 'student' },
      [t('services_task_renewal')]: { text: t('services_prompt_renewal'), agent: 'student' },
      [t('services_task_legal')]: { text: t('services_prompt_legal'), agent: 'lawyer' }
    };

    const target = prompts[taskLabel];
    if (!target) {
      setIsTyping(false);
      setActiveTask(null);
      return;
    }

    // Typewriter effect — batch 4 chars per 30ms tick (prevents per-char re-render lag)
    setSimulatedText('');
    await new Promise<void>(resolve => {
      let charIdx = 0;
      const iv = setInterval(() => {
        charIdx = Math.min(charIdx + 4, target.text.length);
        setSimulatedText(target.text.slice(0, charIdx));
        if (charIdx >= target.text.length) {
          clearInterval(iv);
          resolve();
        }
      }, 30);
    });

    // Brief pause to read user input
    await new Promise(r => setTimeout(r, 400));
    setIsTyping(false);

    // Simulating Chat unfolding
    setShowSimulatedChat(true);
    setIsAiTyping(true);

    const responses: Record<string, string> = {
      [t('services_task_register')]: t('services_res_register'),
      [t('services_task_tax')]: t('services_res_tax'),
      [t('services_task_permit')]: t('services_res_permit'),
      [t('services_task_enroll')]: t('services_res_enroll'),
      [t('services_task_renewal')]: t('services_res_renewal'),
      [t('services_task_legal')]: t('services_res_legal')
    };

    const aiRes = responses[taskLabel];
    setSimulatedResponse('');

    await new Promise(r => setTimeout(r, 600)); // AI 'thinking' delay
    setIsAiTyping(false);

    // AI response — batch 8 chars per 25ms tick
    await new Promise<void>(resolve => {
      let charIdx = 0;
      const iv = setInterval(() => {
        charIdx = Math.min(charIdx + 8, aiRes.length);
        setSimulatedResponse(aiRes.slice(0, charIdx));
        if (charIdx >= aiRes.length) {
          clearInterval(iv);
          resolve();
        }
      }, 25);
    });

    // The automation is complete. We intentionally DO NOT redirect to the 
    // dashboard here, as this is purely a visual marketing demonstration of 
    // how the AI chat interface behaves organically.
  };

  const services = [
    {
      id: 'permit',
      title: t('assistant_permit') + ' ' + t('agent_badge'),
      icon: <Briefcase className="w-12 h-12 text-white" />,
      gradient: 'bg-gradient-to-br from-[#1a73e8] via-[#4285f4] to-[#1967d2]',
      description: t('services_permit_desc'),
      features: [
        t('services_feat_retail'),
        t('services_feat_restaurant'),
        t('services_feat_fire'),
        t('services_feat_municipal'),
      ],
      status: 'Available',
    },
    {
      id: 'student',
      title: t('assistant_student') + ' ' + t('agent_badge'),
      icon: <GraduationCap className="w-12 h-12 text-white" />,
      gradient: 'bg-gradient-to-br from-[#0f9d58] via-[#34a853] to-[#0d652d]',
      description: t('services_student_desc'),
      features: [
        t('services_feat_uni'),
        t('services_feat_visa'),
        t('services_feat_kimlik'),
        t('services_feat_nufus'),
      ],
      status: 'Available',
    },
    {
      id: 'lawyer',
      title: t('assistant_lawyer') + ' ' + t('agent_badge'),
      icon: <Scale className="w-12 h-12 text-white" />,
      gradient: 'bg-gradient-to-br from-[#f29900] via-[#fbbc04] to-[#ea8600]',
      description: t('services_lawyer_desc'),
      features: [
        t('services_feat_contract'),
        t('services_feat_formation'),
        t('services_feat_disputes'),
        t('services_feat_compliance'),
      ],
      status: 'Coming Soon',
    },
  ];

  // Wrapping carousel logic
  const extendedServices = [...services, ...services]; // 6 items to enable smooth endless sliding
  const CARD_W = 340;
  const CARD_GAP = 180;
  const CARD_STEP = CARD_W + CARD_GAP;
  const LOOP_WIDTH = 520 * services.length; // 1560px (3 items * 520)

  const handleStartProtocol = (id: string) => {
    if (!isAuthenticated) {
      setIsLoginModalOpen(true);
      return;
    }
    if (id === 'permit' || id === 'student' || id === 'lawyer') {
      setSelectedAgent(id as 'permit' | 'student' | 'lawyer');
    }
  };

  const handleInitializeWorkflow = () => {
    let prompt = '';

    if (selectedAgent === 'student') {
      if (studentServiceType === 'University Registration') {
        prompt = `I want to register to a university. The university is ${studentUni || 'not specified yet'}. Provide the roadmap.`;
      } else if (studentServiceType === 'Student Visa Application') {
        prompt = `I need to get a student visa. I am coming from ${studentVisaCountry || 'my home country'}. What are the steps?`;
      } else if (studentServiceType === 'ID (Kimlik)') {
        prompt = kimlikAction === 'new'
          ? `I need to apply for a new foreign ID card (Kimlik) in Turkey for the first time. What are the steps and required documents?`
          : `I need to renew my existing foreign ID (Kimlik) in Turkey. It is expiring soon. What should I do?`;
      } else if (studentServiceType === 'Lost Student ID') {
        prompt = `I lost my student ID card. How do I get a replacement?`;
      } else {
        prompt = `I need help with ${studentServiceType}.`;
      }
    } else if (selectedAgent === 'permit') {
      prompt = `I want to open a ${permitServiceType} business in ${permitDistrict} district of Istanbul. Please provide the required permits and roadmap.`;
    } else if (selectedAgent === 'lawyer') {
      prompt = `I need legal assistance regarding ${lawyerMatterType}. Please provide the roadmap and requirements under Turkish law.`;
    }

    setIsInitializing(true);
    setIsNavigating(true);
    localStorage.setItem('permitops_assistant_type', selectedAgent || 'permit');
    localStorage.setItem('permitops_ask_step', prompt);
    // Force a pending session so the dashboard renders a clean slate
    localStorage.setItem('permitops_active_session_id', 'pending-' + Date.now());

    // Brief delay for cinematic effect before navigation
    setTimeout(() => {
      router.push('/dashboard');
    }, 1800); // Increased for full loading screen effect
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {(!isLoaded || isNavigating) && (
          <LoadingScreen />
        )}
      </AnimatePresence>

      <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] selection:bg-blue-500/30 font-sans transition-colors duration-500">
        <Navbar />

        <div className="absolute inset-0 bg-[var(--bg)] -z-10 transition-colors duration-500" />

        {/* Transition Scanning Overlay */}
        <AnimatePresence>
          {isInitializing && !isNavigating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm pointer-events-none"
            >
              <motion.div
                animate={{ y: ['-100vh', '100vh'] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                className="absolute inset-x-0 h-[3px] bg-[#ff0000] shadow-[0_0_50px_#ff0000,0_0_100px_#ff0000]"
              />
            </motion.div>
          )}
        </AnimatePresence>

      <div className="pt-12 pb-20 px-6 overflow-hidden relative">
        {/* Soft Background Glints */}
        <div className="absolute top-[5%] left-[-10%] w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[160px] -z-20" />
        <div className="absolute bottom-[10%] right-[-15%] w-[500px] h-[500px] bg-magenta-500/10 rounded-full blur-[160px] -z-20" />

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-4xl mx-auto mb-8 relative"
        >
          <h1 className="text-3xl md:text-6xl font-black tracking-tighter text-[var(--text)] font-[Outfit] mb-4 leading-none transition-colors duration-500">
            {t('services_title')}
          </h1>
          <p className="text-base md:text-xl text-[var(--muted)] font-medium max-w-2xl mx-auto leading-relaxed transition-colors duration-500">
            {t('services_subtitle')}
          </p>
        </motion.div>

        {/* Mobile: Horizontal snap-scroll cards */}
        <div className="md:hidden flex gap-4 overflow-x-auto snap-x snap-mandatory no-scrollbar pb-4 px-1">
          {services.map((service, index) => (
            <div
              key={service.id}
              className="snap-center flex-shrink-0 w-[72vw] rounded-[24px] overflow-hidden border border-[var(--border)] bg-[var(--surface)] shadow-xl flex flex-col"
            >
              <div className={`h-[100px] w-full relative flex items-center justify-center overflow-hidden ${service.gradient}`}>
                <motion.div
                  animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-full z-0"
                />
                <div className="relative z-10 p-3 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-xl shadow-xl">
                  {service.icon}
                </div>
                {service.status !== 'Available' && (
                  <div className="absolute top-3 right-3 z-20">
                    <span className="px-2 py-0.5 rounded-full bg-black/40 text-[8px] font-black text-white uppercase tracking-widest">
                      {t('services_status_soon')}
                    </span>
                  </div>
                )}
              </div>
              <div className="p-4 flex flex-col flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-black font-[Outfit] tracking-tight">{service.title}</h3>
                  {service.status === 'Available' && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--muted)] font-medium leading-[1.4] mb-3 line-clamp-2">{service.description}</p>
                {service.status === 'Available' ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleStartProtocol(service.id); }}
                    className="mt-auto py-2.5 px-4 rounded-[14px] bg-[var(--text)] text-[var(--bg)] font-black uppercase text-[10px] tracking-widest transition-all active:scale-95 hover:bg-red-600 hover:text-white"
                  >
                    {t('services_launch_agent')}
                  </button>
                ) : (
                  <button disabled className="mt-auto py-2.5 px-4 rounded-[14px] bg-[var(--text)]/[0.04] text-[var(--text)] opacity-40 font-black uppercase text-[10px] tracking-widest border border-[var(--border)] cursor-not-allowed">
                    Coming Soon
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Desktop: Auto-scrolling carousel */}
        <div
          className="hidden md:block carousel-container relative max-w-6xl mx-auto overflow-hidden py-4"
          style={{ height: '420px' }}
        >
          {/* Fade edges — themed */}
          <div className="absolute left-0 top-0 bottom-0 w-24 bg-gradient-to-r from-[var(--bg)] to-transparent z-10 pointer-events-none transition-all duration-500" />
          <div className="absolute right-0 top-0 bottom-0 w-24 bg-gradient-to-l from-[var(--bg)] to-transparent z-10 pointer-events-none transition-all duration-500" />

          {/* Smooth Moving Track — pure CSS animation, pauses on hover via CSS */}
          <div className="carousel-track flex items-center gap-[180px] w-max">
            {[...services, ...services, ...services].map((service, index) => (
              <div
                key={`${service.id}-${index}`}
                style={{
                  width: `${CARD_W}px`,
                  flexShrink: 0
                }}
                onClick={() => { }}
                className={`backdrop-blur-3xl border rounded-[28px] overflow-hidden flex flex-col group cursor-pointer hover:scale-[1.02] transition-all duration-300 relative ${service.status === 'Available'
                  ? 'bg-[var(--surface)] border-[var(--border)] shadow-xl'
                  : 'bg-[var(--surface)] border-[var(--border)] shadow-lg'
                  }`}
              >
                <div className={`h-[150px] w-full relative flex items-center justify-center overflow-hidden transition-all duration-500 ${service.gradient}`}>
                  {/* Premium scanning streak */}
                  <motion.div
                    animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent w-full z-0"
                  />

                  <div className="relative z-10 p-5 bg-white/10 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-xl group-hover:scale-110 transition-transform duration-500">
                    {service.icon}
                  </div>

                  {service.status !== 'Available' && (
                    <div className="absolute top-4 right-4 z-20">
                      <span className="px-2.5 py-1 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-[9px] font-black text-white uppercase tracking-widest">
                        {t('services_status_soon')}
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-6 flex flex-col flex-1">
                  <div className="flex items-center justify-between mb-3 text-[var(--text)]">
                    <h3 className="text-lg font-black font-[Outfit] tracking-tight">{service.title}</h3>
                    {service.status === 'Available' ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">{t('services_status_active')}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">{t('services_status_waitlist')}</span>
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400/40" />
                      </div>
                    )}
                  </div>
                  <p className="text-[13px] text-[var(--muted)] font-medium leading-[1.5] mb-6 line-clamp-2">
                    {service.description}
                  </p>

                  {service.status === 'Available' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleStartProtocol(service.id); }}
                      className="mt-auto py-3.5 px-6 rounded-[20px] bg-[var(--text)] text-[var(--bg)] font-black uppercase text-[11px] tracking-widest shadow-xl transition-all active:scale-95 hover:bg-red-600 hover:text-white"
                    >
                      {t('services_launch_agent')}
                    </button>
                  ) : (
                    <button disabled className="mt-auto w-full py-3.5 px-6 rounded-[20px] bg-[var(--text)]/[0.04] text-[var(--text)] opacity-40 font-black uppercase text-[11px] tracking-widest border border-[var(--border)] cursor-not-allowed">
                      Coming Soon
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedAgent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 30 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 30 }}
              className="bg-[var(--surface)] border border-white/5 rounded-[44px] shadow-[0_50px_100px_rgba(0,0,0,0.8)] w-full max-w-lg relative overflow-hidden backdrop-blur-3xl"
            >
              <div className="p-10">
                <div className="flex justify-between items-start mb-12">
                  <div className="flex items-center gap-5">
                    <div className={`w-16 h-16 rounded-[22px] flex items-center justify-center border-2 transition-all duration-500 shadow-xl ${selectedAgent === 'student' ? 'bg-[#0f9d58]/10 border-[#0f9d58]/30 shadow-[#0f9d58]/10' :
                      selectedAgent === 'lawyer' ? 'bg-[#f29900]/10 border-[#f29900]/30 shadow-[#f29900]/10' :
                        'bg-[#1a73e8]/10 border-[#1a73e8]/30 shadow-[#1a73e8]/10'
                      }`}>
                      {selectedAgent === 'student' ? <GraduationCap size={32} className="text-[#0f9d58]" /> :
                        selectedAgent === 'lawyer' ? <Scale size={32} className="text-[#f29900]" /> :
                          <Briefcase size={32} className="text-[#1a73e8]" />}
                    </div>
                    <div>
                      <h3 className="text-2xl font-black text-[var(--text)] font-[Outfit] tracking-tight leading-tight mb-1">{t('services_setup_agent')}</h3>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedAgent(null)}
                    className="w-10 h-10 flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] transition-all hover:bg-white/5 rounded-2xl active:scale-90"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-8 relative">
                  {selectedAgent === 'student' && (
                    <div className="space-y-6">
                      <div className="relative">
                        <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">{t('services_type_service')}</label>
                        <CustomSelect
                          value={studentServiceType}
                          onChange={(val) => { setStudentServiceType(val); setStudentUni(''); setStudentVisaCountry(''); }}
                          options={STUDENT_SERVICES_OPTIONS}
                          placeholder={t('services_select_service')}
                        />
                      </div>

                      <AnimatePresence>
                        {studentServiceType === 'University Registration' && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                            <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">{t('services_select_uni')}</label>
                            <CustomSelect
                              value={studentUni}
                              onChange={setStudentUni}
                              options={UNIVERSITIES_OPTIONS}
                              placeholder={t('services_select_uni_placeholder')}
                              maxH="max-h-64"
                            />
                          </motion.div>
                        )}
                        {studentServiceType === 'Student Visa Application' && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                            <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">Country of Origin</label>
                            <CustomSelect
                              value={studentVisaCountry}
                              onChange={setStudentVisaCountry}
                              options={COUNTRIES_OPTIONS}
                              placeholder="Select your country"
                              maxH="max-h-64"
                            />
                          </motion.div>
                        )}
                        {studentServiceType === 'ID (Kimlik)' && (
                          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
                            <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">What do you need?</label>
                            <CustomSelect
                              value={kimlikAction}
                              onChange={setKimlikAction}
                              options={KIMLIK_ACTION_OPTIONS}
                              placeholder="Select action"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  {selectedAgent === 'permit' && (
                    <div className="space-y-6">
                      <div className="relative">
                        <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">Business Sector</label>
                        <CustomSelect
                          value={permitServiceType}
                          onChange={setPermitServiceType}
                          options={PERMIT_SERVICES_OPTIONS}
                          placeholder="Select Sector"
                        />
                      </div>

                      <div className="relative">
                        <label className="block text-[10px] font-black text-[var(--muted)] uppercase tracking-[0.25em] mb-3 ml-2 opacity-60">{t('services_district')}</label>
                        <CustomSelect
                          value={permitDistrict}
                          onChange={setPermitDistrict}
                          options={DISTRICTS_OPTIONS}
                          placeholder={t('services_select_district')}
                          maxH="max-h-64"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-14 flex items-center gap-4">
                  <button
                    onClick={() => setSelectedAgent(null)}
                    className="flex-1 py-4 px-6 rounded-[24px] border border-white/10 text-[var(--text)] font-black uppercase text-[11px] tracking-[0.15em] hover:bg-white/5 transition-all active:scale-95"
                  >
                    {t('settings_cancel')}
                  </button>
                  <button
                    onClick={handleInitializeWorkflow}
                    className={`flex-1 py-4 px-6 rounded-[24px] text-white font-black uppercase text-[11px] tracking-[0.15em] active:scale-95 transition-all ${selectedAgent === 'student' ? 'bg-[#0f9d58] hover:bg-[#0d652d] shadow-[0_15px_40px_rgba(15,157,88,0.25)]' :
                      selectedAgent === 'lawyer' ? 'bg-[#f29900] hover:bg-[#ea8600] shadow-[0_15px_40px_rgba(242,153,0,0.25)]' :
                        'bg-[#1a73e8] hover:bg-[#1967d2] shadow-[0_15px_40px_rgba(26,115,232,0.25)]'
                      }`}
                  >
                    {t('services_start_agent')}
                  </button>
                </div>

                <div className="mt-8 pt-6 border-t border-[var(--border)] flex items-center justify-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${selectedAgent === 'student' ? 'bg-[#0f9d58]' :
                    selectedAgent === 'lawyer' ? 'bg-[#f29900]' :
                      'bg-[#1a73e8]'
                    }`} />
                  <p className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest opacity-40">
                    {t('services_secure_session')}
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- ADDED SECTIONS FROM CLAUDE DESIGN --- */}

      <div className="bg-[var(--surface-1)] border-t border-[var(--border)] pt-16 pb-20 transition-colors duration-500">
        <div className="max-w-[1340px] mx-auto px-6">

          {/* Describe What You Need Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-start mb-12 lg:mb-20">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="lg:mt-12"
            >
              <h2 className="text-2xl md:text-4xl lg:text-6xl font-black text-[var(--text)] font-[Outfit] mb-4 leading-[1.1] tracking-tighter transition-colors duration-500">
                {t('services_cta_title')}
              </h2>
              <p className="text-[var(--muted)] text-sm md:text-lg leading-relaxed mb-4 lg:mb-8 max-w-lg transition-colors duration-500">
                {t('services_cta_desc')}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="bg-[var(--surface-2)] rounded-[20px] md:rounded-[24px] p-3 md:p-5 lg:p-6 shadow-2xl relative overflow-hidden group border border-[var(--border)] transition-colors duration-500"
              style={{ minHeight: 'auto' }}
            >
              {/* Graph Paper Background */}
              <div className="absolute inset-0 opacity-[0.03] pointer-events-none dark:opacity-[0.05]"
                style={{ backgroundImage: 'radial-gradient(var(--text) 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }} />

              <div className="relative z-10 text-[var(--text)]">
                <div className="flex items-center gap-3 mb-3 md:mb-4">
                  <div className={`relative w-9 h-9 rounded-[12px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${['University Enrollment', 'Kimlik Renewal'].includes(activeTask || '') ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-[0_0_25px_rgba(16,185,129,0.6)] border-emerald-400/40' :
                    ['Register Company', 'Get Work Permit', 'Tax Compliance'].includes(activeTask || '') ? 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_0_25px_rgba(59,130,246,0.6)] border-blue-400/40' :
                      ['Legal Consultation'].includes(activeTask || '') ? 'bg-gradient-to-br from-amber-500 to-amber-600 shadow-[0_0_25px_rgba(245,158,11,0.6)] border-amber-400/40' :
                        'bg-gradient-to-br from-red-500 to-red-600 shadow-[0_0_25px_rgba(239,68,68,0.6)] border-red-400/40'
                    }`}>
                    {/* Scanning light streak to perfectly match exact Chat animation */}
                    <motion.div
                      animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full z-0"
                    />
                    <motion.div
                      animate={{ filter: ['drop-shadow(0 0 4px rgba(255,255,255,0.4))', 'drop-shadow(0 0 10px rgba(255,255,255,0.9))', 'drop-shadow(0 0 4px rgba(255,255,255,0.4))'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                      className="relative z-10"
                    >
                      <Cpu className="text-white" size={16} />
                    </motion.div>
                  </div>
                  <h3 className="text-sm md:text-base font-bold tracking-tight">{t('services_list_title')}</h3>
                </div>

                <div className="grid grid-cols-2 gap-1.5 md:gap-3">
                  {[
                    { icon: FileText, label: t('services_task_register') },
                    { icon: BarChart3, label: t('services_task_tax') },
                    { icon: Layers, label: t('services_task_permit') },
                    { icon: GraduationCap, label: t('services_task_enroll') },
                    { icon: ListTodo, label: t('services_task_renewal') },
                    { icon: MessageSquare, label: t('services_task_legal') }
                  ].map((task, i) => {
                    const isStudent = [t('services_task_enroll'), t('services_task_renewal')].includes(task.label);
                    const isPermit = [t('services_task_register'), t('services_task_permit'), t('services_task_tax')].includes(task.label);
                    const isLawyer = [t('services_task_legal')].includes(task.label);

                    const activeColorClass = isStudent ? 'border-emerald-500 shadow-emerald-500/20' : isPermit ? 'border-blue-500 shadow-blue-500/20' : isLawyer ? 'border-amber-500 shadow-amber-500/20' : 'border-red-400 shadow-red-500/20';
                    const hoverColorClass = isStudent ? 'hover:border-emerald-200' : isPermit ? 'hover:border-blue-200' : isLawyer ? 'hover:border-amber-200' : 'hover:border-red-200';
                    const iconColorClass = isStudent ? 'text-emerald-500' : isPermit ? 'text-blue-500' : isLawyer ? 'text-amber-500' : 'text-red-500';
                    const iconBgClass = isStudent ? 'bg-emerald-500/10' : isPermit ? 'bg-blue-500/10' : isLawyer ? 'bg-amber-500/10' : 'bg-red-500/10';

                    return (
                      <div
                        key={i}
                        onClick={() => handleSimulateTask(task.label)}
                        className={`flex items-center gap-1.5 md:gap-2 p-1.5 md:p-2.5 rounded-lg border bg-[var(--surface)] hover:shadow-md transition-all cursor-pointer group/task ${activeTask === task.label ? `${activeColorClass} shadow-xl scale-[1.02]` : `border-[var(--border)] ${hoverColorClass} opacity-90 hover:opacity-100`
                          } ${isTyping && activeTask !== task.label ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <div className={`w-6 h-6 md:w-7 md:h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${activeTask === task.label ? `${iconBgClass} ${iconColorClass}` : `bg-[var(--surface-2)] text-[var(--muted)] group-hover/task:${iconColorClass}`
                          }`}>
                          <task.icon size={11} />
                        </div>
                        <span className="text-[9px] md:text-[11px] font-semibold text-[var(--text)] leading-tight">{task.label}</span>
                      </div>
                    );
                  })}
                </div>

                <div className={`mt-3 md:mt-4 p-2.5 md:p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl flex flex-col shadow-sm transition-all duration-500 ${isTyping || showSimulatedChat ? 'ring-2 ring-red-400/30 shadow-md' : ''}`}>
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <div className="w-6 h-6 rounded-md bg-[var(--surface-2)] flex items-center justify-center shrink-0 transition-colors duration-500">
                        <FileText size={12} className="text-[var(--muted)]" />
                      </div>
                      <span className={`text-xs transition-colors duration-500 ${isTyping || activeTask ? 'text-[var(--text)] font-medium' : 'text-[var(--muted)] font-medium italic'}`}>
                        {simulatedText}
                        {isTyping && <span className="animate-pulse inline-block ml-1">|</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 pl-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${activeTask && !isTyping ? 'bg-red-500 text-white shadow-md' : 'bg-red-500/10 text-red-500'
                        }`}>
                        <ArrowRight size={16} />
                      </div>
                    </div>
                  </div>

                  {/* Inline Simulated Chat Dropdown */}
                  <AnimatePresence>
                    {showSimulatedChat && (
                      <motion.div
                        initial={{ height: 0, opacity: 0, marginTop: 0 }}
                        animate={{ height: 'auto', opacity: 1, marginTop: 16 }}
                        exit={{ height: 0, opacity: 0, marginTop: 0 }}
                        className="border-t border-[var(--border)] pt-4 overflow-hidden flex items-start gap-4 transition-colors duration-500"
                      >
                        <div className="w-8 h-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 shadow-inner">
                          <Cpu size={14} className="text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">TurkGateway AI</p>
                          {isAiTyping ? (
                            <div className="flex items-center gap-1 mt-2 mb-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          ) : (
                            <p className="text-sm text-[var(--text)] leading-relaxed transition-colors duration-500">
                              {simulatedResponse}
                            </p>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>

          {/* TurkGateway Does the Work Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-48">
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="order-2 lg:order-1 bg-gradient-to-br from-[#4f46e5] to-[#3730a3] rounded-[44px] p-12 shadow-2xl relative overflow-hidden border border-white/10"
            >
              <div className="bg-[var(--surface)] rounded-3xl p-8 shadow-xl max-w-md mx-auto relative z-10 border border-[var(--border)] transition-colors duration-500">
                <div className="flex items-center justify-between mb-8">
                  <h4 className="text-lg font-bold text-[var(--text)] transition-colors duration-500">Progress</h4>
                  <ChevronDown size={20} className="text-[var(--muted)]" />
                </div>

                <div className="space-y-6">
                  {[
                    { label: 'Connect to e-Devlet Portal', status: 'done' },
                    { label: 'Verify Criminal Record (Adli Sicil)', status: 'active' },
                    { label: 'Download digital signatures', status: 'pending' },
                    { label: 'Submit Work Permit Form', status: 'pending' }
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-4">
                      {step.status === 'done' ? (
                        <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white">
                          <CheckCircle2 size={14} />
                        </div>
                      ) : step.status === 'active' ? (
                        <div className="w-6 h-6 rounded-full border-2 border-blue-600 flex items-center justify-center text-blue-600 text-[10px] font-bold">
                          2
                        </div>
                      ) : (
                        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] flex items-center justify-center text-[var(--muted)] text-[10px] font-bold">
                          {i + 1}
                        </div>
                      )}
                      <span className={`text-sm font-semibold tracking-tight transition-colors duration-500 ${step.status === 'pending' ? 'text-[var(--muted)]' : 'text-[var(--text)]'}`}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-12 pt-6 border-t border-[var(--border)] flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest">Target Folder</span>
                  <div className="flex gap-2">
                    <FileText size={16} className="text-[var(--muted)] opacity-50" />
                    <ChevronDown size={16} className="text-[var(--muted)] opacity-50" />
                  </div>
                </div>
              </div>

              {/* Abstract Background Curve */}
              <div className="absolute top-0 right-0 w-full h-full opacity-[0.05] pointer-events-none">
                <svg viewBox="0 0 400 400" className="w-full h-full">
                  <path d="M0,200 Q100,100 200,200 T400,200" fill="none" stroke="black" strokeWidth="2" />
                </svg>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="order-1 lg:order-2"
            >
              <h2 className="text-4xl md:text-5xl font-black text-[var(--text)] font-[Outfit] mb-6 tracking-tighter transition-colors duration-500">
                {t('services_ai_does_work')}
              </h2>
              <p className="text-[var(--muted)] text-lg leading-relaxed mb-8 max-w-lg transition-colors duration-500">
                {t('services_ai_desc')}
              </p>
            </motion.div>
          </div>

          {/* You're in Control Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-4xl md:text-5xl font-black text-[var(--text)] font-[Outfit] mb-6 tracking-tighter transition-colors duration-500">
                {t('services_control_title')}
              </h2>
              <p className="text-[var(--muted)] text-lg leading-relaxed mb-8 max-w-lg transition-colors duration-500">
                {t('services_control_desc')}
              </p>
              <div className="flex gap-8">
                <div className="flex items-center gap-3">
                  <Lock className="text-blue-500" size={20} />
                  <span className="text-xs font-bold text-[var(--text)] uppercase tracking-widest transition-colors duration-500">{t('services_encryption')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Eye className="text-blue-500" size={20} />
                  <span className="text-xs font-bold text-[var(--text)] uppercase tracking-widest transition-colors duration-500">{t('services_privacy')}</span>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="bg-gradient-to-br from-[#d48c9b] to-[#c97486] rounded-[44px] p-12 shadow-2xl relative overflow-hidden aspect-[4/3] flex items-center justify-center"
            >
              {/* Pattern */}
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at center, #000 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="bg-[var(--surface)] rounded-2xl p-8 shadow-2xl max-w-xs relative z-10 text-center border border-[var(--border)] transition-colors duration-500"
              >
                <div className="mb-4 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 mb-4">
                    <Fingerprint size={28} />
                  </div>
                  <h4 className="text-sm font-bold text-[var(--text)] mb-2">{t('services_allow_files')}</h4>
                  <p className="text-[11px] text-[var(--muted)] font-medium leading-relaxed">
                    {t('services_allow_desc')}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-[11px] font-bold">{t('services_allow_access')}</button>
                  <button className="w-full py-2.5 rounded-xl border border-[var(--border)] text-[var(--muted)] text-[11px] font-bold">{t('services_always_allow')}</button>
                  <button className="w-full py-2.5 rounded-xl text-[var(--muted)] text-[11px] font-bold">{t('settings_cancel')}</button>
                </div>
              </motion.div>
            </motion.div>
          </div>

        </div>
      </div>

      {/* ── Minimalist Footer ── */}
      <Footer />
      </main>
    </>
  );
}
