'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  CheckCircle2, Clock, Circle, AlertCircle,
  ShieldCheck, ArrowRight, MapPin, Calendar, FileText,
  Activity, Cpu, Upload, ChevronDown, ExternalLink, RefreshCw, X, Fingerprint, Lock, Sparkles, MessageSquare, Menu, User, Check
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import LoadingScreen from '../components/LoadingScreen';

type Status = 'completed' | 'in-progress' | 'pending';

interface PermitStep {
  title: string;
  status: Status;
  date: string;
  summary: string;
  detail: string;
  docs: string[];
}

function StepBadge({ status }: { status: Status }) {
  const { t } = useLanguage();
  if (status === 'completed') return <span className="badge badge-green">{t('status_completed')}</span>;
  if (status === 'in-progress') return <span className="badge badge-purple">{t('status_in_progress')}</span>;
  return <span className="badge badge-amber">{t('status_pending')}</span>;
}

function StepIcon({ status }: { status: Status }) {
  if (status === 'completed') return <CheckCircle2 size={18} className="text-emerald-500" />;
  if (status === 'in-progress') return <Clock size={18} className="text-purple-500" />;
  return <Circle size={18} className="text-[var(--muted)]" />;
}

export default function Dashboard() {
  const { t, isRTL, language } = useLanguage();
  const { token, user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState(t('dashboard_toast_success') || "Document uploaded successfully!");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [tckn, setTckn] = useState('99945855004');
  const [password, setPassword] = useState('••••••••••••');
  const [automatedStepId, setAutomatedStepId] = useState<number | null>(null);
  const [dashboardSessionId, setDashboardSessionId] = useState<string | null>(null);
  const [activeAssistantType, setActiveAssistantType] = useState<'permit' | 'student' | 'lawyer'>('permit');
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<string | null>(null);
  
  // Student/Residency Bot Data
  const [fullName, setFullName] = useState('');
  const [passportNo, setPassportNo] = useState('');
  const [passportType, setPassportType] = useState('Normal');
  const [ikametType, setIkametType] = useState('Student');
  const [dob, setDob] = useState('');
  const [isExtension, setIsExtension] = useState(false);
  const [generatingWorkflow, setGeneratingWorkflow] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);

  // Cycle through agents during loading
  useEffect(() => {
    if (!generatingWorkflow) return;
    const interval = setInterval(() => {
      setLoadingPhase(prev => (prev + 1) % 3);
    }, 2500);
    return () => clearInterval(interval);
  }, [generatingWorkflow]);

  // Load initial assistant type
  useEffect(() => {
    const stored = localStorage.getItem('permitops_assistant_type') as any;
    if (stored) setActiveAssistantType(stored);
    setPendingInitialPrompt(localStorage.getItem('permitops_ask_step'));
  }, []);

  // Subscription State
  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);

  // Progress Increase State
  const [prevProgress, setPrevProgress] = useState(0);
  const [showIncrease, setShowIncrease] = useState(false);
  const [increaseAmount, setIncreaseAmount] = useState(0);

  const handleSwitchAssistant = (type: 'permit' | 'student' | 'lawyer') => {
    setActiveAssistantType(type);
    localStorage.setItem('permitops_assistant_type', type);
    localStorage.removeItem('permitops_active_session_id');
    fetchState();
  };

  const askAiAboutStep = (step: { id: number; title: string; summary: string; detail: string; responsible: string }) => {
    if (step.id === 0 && pendingInitialPrompt) {
      // Just route to chat so it consumes the pending prompt automatically
      router.push('/chat');
      return;
    }
    const q = `I need more information about Step ${step.id}: "${step.title}". ${step.detail ? step.detail.slice(0, 300) : step.summary} Can you explain this in more detail, including what exactly I need to do, which documents I need, and any tips?`;
    localStorage.setItem('permitops_ask_step', q);
    // Use the session that THIS dashboard loaded data from — not whatever was last visited in chat
    if (dashboardSessionId && !dashboardSessionId.startsWith('pending-')) {
       localStorage.setItem('permitops_ask_step_session', dashboardSessionId);
    }
    router.push('/chat');
  };

  const fetchState = useCallback(async (retryCount = 0) => {
    const startTime = Date.now();
    try {
      setLoading(true);
      const token = localStorage.getItem('permitops_token');
      const sid = localStorage.getItem('permitops_active_session_id');
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (sid) {
        if (sid.startsWith('pending-')) return false;
        params.append('session_id', sid);
      }
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/workflow/latest${query}`);
      if (res?.ok) {
        const json = await res.json();
        const steps = json?.execution_plan?.steps || [];
        
        if (steps.length > 0) {
          setData(json);
          const resolvedSession = json._session_id || sid;
          if (resolvedSession) setDashboardSessionId(resolvedSession);
          if (json.assistant_type) setActiveAssistantType(json.assistant_type);
          return true;
        } else if (retryCount < 5 && sid && !sid.startsWith('pending-')) {
          console.log(`[Dashboard] No steps found yet. Retry ${retryCount + 1}/5...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return await fetchState(retryCount + 1);
        }
      }
      return false;
    } catch (e) {
      console.error("Failed to fetch dashboard data", e);
      return false;
    } finally {
      const remaining = Math.max(0, 500 - (Date.now() - startTime));
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const autoGenerate = async () => {
      const pendingPrompt = localStorage.getItem('permitops_ask_step');
      const sid = localStorage.getItem('permitops_active_session_id');
      
      if (pendingPrompt && sid && sid.startsWith('pending-')) {
        setGeneratingWorkflow(true);
        localStorage.removeItem('permitops_ask_step');
        setPendingInitialPrompt(null);
        
        try {
          let realSessionId = sid;
          const token = localStorage.getItem('permitops_token');
          const typeToUse = localStorage.getItem('permitops_assistant_type') || 'permit';
          
          if (token) {
            const res = await apiFetch(`/chat/sessions?token=${token}&assistant_type=${typeToUse}`, { method: 'POST' });
            if (res?.ok) {
              const data = await res.json();
              realSessionId = data.id;
              localStorage.setItem('permitops_active_session_id', realSessionId);
            }
          } else {
             realSessionId = `guest-${Math.random().toString(36).substring(2, 15)}`;
             localStorage.setItem('permitops_active_session_id', realSessionId);
          }
          
          const headers = { 'Content-Type': 'application/json' };
          const body = JSON.stringify({ 
             query: pendingPrompt, 
             language: language,
             context: { session_id: realSessionId },
             assistant_type: typeToUse 
          });

          console.log('[Dashboard] Auto-generating workflow for session:', realSessionId);
          await apiFetch(`/agent/query${token ? `?token=${token}` : ''}`, {
            method: 'POST',
            headers,
            body,
          });

          // Wait 1.5s for initial backend processing, then start polling
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          console.log('[Dashboard] Polling for state after generation...');
          const success = await fetchState();
          if (!success) {
            console.warn('[Dashboard] Generation finished but no roadmap found after retries.');
          }
          window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
          
        } catch (e) {
             console.error('[Dashboard] Failed to auto-generate workflow:', e);
             await fetchState();
        } finally {
          setGeneratingWorkflow(false);
        }
      } else {
        fetchState();
      }
    };
    
    autoGenerate();

    // handle payment redirects
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    if (paymentStatus === 'success') {
      setToastMessage(t('dashboard_toast_success_payment') || "Subscription activated! Welcome to Premium.");
      setToastType("success");
      setShowToast(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'error') {
      setToastMessage(params.get('message') || t('dashboard_toast_error_payment') || "Payment failed. Please try again.");
      setToastType("error");
      setShowToast(true);
      window.history.replaceState({}, '', window.location.pathname);
    }

    // listen only for explicit app-dispatched events, not all storage changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'permitops_workflow_update') fetchState();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [fetchState]);

  const handleSubscribe = async () => {
    try {
      setIsSubscribing(true);
      const token = localStorage.getItem('permitops_token');
      if (!token) {
        setToastMessage("Please log in to subscribe");
        setToastType("error");
        setShowToast(true);
        return;
      }

      const res = await apiFetch(`/payment/subscribe?token=${token}`, { method: 'POST' });
      if (res && res.ok) {
        const json = await res.json();
        if (json.status === 'success' && json.checkoutFormContent) {
          // iyzico returns a <script> tag. We need to inject it.
          setIyzicoFormHtml(json.checkoutFormContent);
        } else {
          throw new Error(json.errorMessage || json.detail || "Initialization failed");
        }
      } else {
        throw new Error("Payment server unreachable");
      }
    } catch (e: any) {
      setToastMessage(e.message || t('dashboard_toast_error_sub') || "Failed to start subscription");
      setToastType("error");
      setShowToast(true);
    } finally {
      setIsSubscribing(false);
    }
  };

  const refresh = async () => {
    await fetchState();
  };

  const automateStep = async (id: number) => {
    const step = steps.find(s => s.id === id);
    if (step) {
      setAutomatedStepId(id);
      setShowModal(true);
    }
  };

  const triggerAutomation = async (id: number) => {
    const startTime = Date.now();
    try {
      setLoading(true);
      const token = localStorage.getItem('permitops_token');
      const sid = localStorage.getItem('permitops_active_session_id');
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (sid) params.append('session_id', sid);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/workflow/step/automate/${id}${query}`, { method: 'POST' });
      if (res?.ok) {
        await refresh();
      }
    } catch (e) {
      console.error("Failed to automate step", e);
    } finally {
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      setLoading(false);
    }
  };

  const markComplete = async (id: number) => {
    try {
      const token = localStorage.getItem('permitops_token');
      const sid = localStorage.getItem('permitops_active_session_id');
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (sid) params.append('session_id', sid);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/workflow/step/complete/${id}${query}`, { method: 'POST' });
      if (res?.ok) {
        await refresh();
      }
    } catch (e) {
      console.error("Failed to mark step complete", e);
    }
  };

  const stepsData = data?.execution_plan?.steps;
  const hasSteps = stepsData && Array.isArray(stepsData) && stepsData.length > 0;

  const steps: any[] = hasSteps ? [
    ...(stepsData.map((s: any, i: number) => ({
      id: s.id,
      title: s.title,
      responsible: s.responsible,
      status: s.status as Status,
      date: data.last_updated ? new Date(data.last_updated).toLocaleDateString() : 'Recent',
      summary: s.notes || `Step ${i + 1} of the permit process.`,
      detail: s.notes || `${s.responsible} is handling this step.`,
      docs: i === 1 ? (data.permit_plan?.documents || []) : [],
    })))
  ] : [
    {
      id: 0,
      title: pendingInitialPrompt ? 'Manual Workflow Initialization' : t('dashboard_init_title'),
      responsible: pendingInitialPrompt ? 'You' : 'Agent',
      status: 'pending' as Status,
      date: 'Pending',
      summary: pendingInitialPrompt ? `Topic: ${pendingInitialPrompt}` : t('dashboard_init_summary'),
      detail: pendingInitialPrompt ? 'Click "Ask Agent" below to generate your complete roadmap based on the gathered details.' : t('dashboard_init_detail'),
      docs: [],
    }
  ];

  const done = steps.filter(s => s.status === 'completed').length;
  const progress = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;

  useEffect(() => {
    // Show increase if loading just finished and progress has changed
    if (!loading && progress > prevProgress) {
      const diff = progress - prevProgress;
      setIncreaseAmount(diff);
      setShowIncrease(true);
      const timer = setTimeout(() => setShowIncrease(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [loading, progress]); // Trigger when loading state changes or progress updates

  useEffect(() => {
    // Only update prevProgress when NOT showing increase, or after it's been shown
    if (!loading && !showIncrease) {
      setPrevProgress(progress);
    }
  }, [loading, progress, showIncrease]);

  const currentAutomatedStep = automatedStepId ? steps.find(s => s.id === automatedStepId) : null;
  const automatedText = (
    (currentAutomatedStep?.title || "") + " " +
    (currentAutomatedStep?.detail || "") + " " +
    (currentAutomatedStep?.summary || "")
  ).toLowerCase();
  
  const isMersis = /mersis|ticaret\.gov|company|nace|articles/.test(automatedText);
  const isIkamet = /ikamet|kimlik|residency|residence|permit|visa|goc\.gov|appointment/.test(automatedText);
  const isInsurance = /sigorta|insurance|e-ikametsigorta/.test(automatedText);
  
  const portalName = isMersis ? "MERSİS" : isIkamet ? "e-İkamet" : isInsurance ? "Sigorta" : "e-Devlet";
  const portalUrl = isMersis ? "https://mersis.ticaret.gov.tr/" : isIkamet ? "https://e-ikamet.goc.gov.tr/" : isInsurance ? "https://www.e-ikametsigorta.com/" : "https://giris.turkiye.gov.tr/Giris/";

  const handleUploadClick = () => {
    setShowModal(true);
  };

  const submitEDevlet = async () => {
    const startTime = Date.now();
    setUploading(true);
    // Open window immediately to avoid popup blocker
    const portalWin = window.open('about:blank', '_blank');
    
    try {
      const token = localStorage.getItem('permitops_token');
      const sid = localStorage.getItem('permitops_active_session_id');
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (sid) params.append('session_id', sid);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/api/submit-edevlet${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tckn, 
          password, 
          portal_url: portalUrl, 
          step_id: automatedStepId,
          full_name: fullName,
          passport_no: passportNo,
          passport_type: passportType,
          ikamet_type: ikametType,
          dob: dob,
          is_extension: isExtension
        })
      });

      if (!res) throw new Error('Backend offline');

      const json = await res.json();

      if (json.status === "success") {
        setToastType("success");
        setToastMessage(json.message || "Submitted successfully via bot.");
        setShowModal(false);
        
        // Use the pre-opened window
        if (portalWin && automatedStepId) {
          const step = steps.find(s => s.id === automatedStepId);
          const t = automatedText;
          
          let targetUrl = "https://www.turkiye.gov.tr";
          
          if (isMersis) {
            targetUrl = "https://mersis.gtb.gov.tr";
          } else if (isIkamet) {
            if (isExtension) {
               targetUrl = "https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/UzatmaBasvuru";
            } else {
               targetUrl = "https://e-ikamet.goc.gov.tr/Ikamet/Basvuru/IlkBasvuru";
            }
          } else if (isInsurance) {
            targetUrl = "https://www.e-ikametsigorta.com/";
          }
          
          portalWin.location.href = targetUrl;
          setAutomatedStepId(null);
        } else if (portalWin) {
          portalWin.close();
        }

        refresh();
      } else {
        if (portalWin) portalWin.close();
        setToastType("error");
        setToastMessage(json.message || "Failed to submit.");
      }
    } catch (e) {
      if (portalWin) portalWin.close();
      setToastType("error");
      setToastMessage("Backend offline. Please make sure the server is running.");
    } finally {
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      
      setUploading(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    }
  };

  const renderContent = () => {
    if (loading && !generatingWorkflow) {
      return <LoadingScreen />;
    }

    return (
      <main className="flex-1 min-w-0 relative overflow-y-auto overflow-x-hidden slim-scroll bg-[var(--bg)] text-[var(--text)] transition-colors duration-500">
          <AnimatePresence>
            {generatingWorkflow && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[var(--bg)] overflow-hidden transition-colors duration-700"
              >
                {/* Ambient Glow — synced to agent color */}
                <div className="absolute inset-0 pointer-events-none transition-all duration-1000">
                   <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[200px] opacity-[0.1] dark:opacity-[0.06] transition-colors duration-1000 ${
                     loadingPhase === 0 ? 'bg-red-600' : loadingPhase === 1 ? 'bg-blue-500' : 'bg-emerald-500'
                   }`} />
                </div>

                <div className="relative z-20 flex flex-col items-center">
                  {/* The Chip: Color-Shifting Processor */}
                  <div className="relative mb-20 flex items-center justify-center">
                    {/* Outer glow ring */}
                    <motion.div
                      animate={{ scale: [1, 1.08, 1], opacity: [0.15, 0.35, 0.15] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      className={`absolute inset-[-30px] rounded-[36px] blur-[50px] transition-colors duration-1000 ${
                        loadingPhase === 0 ? 'bg-red-600/30' : loadingPhase === 1 ? 'bg-blue-500/30' : 'bg-emerald-500/30'
                      }`}
                    />

                    {/* The Chip */}
                    <div className={`relative h-28 w-28 rounded-[28px] border transition-all duration-1000 shadow-2xl flex items-center justify-center overflow-hidden animate-pulse ${
                      loadingPhase === 0 
                        ? 'bg-gradient-to-br from-red-600 via-red-700 to-red-950 border-red-400/30 shadow-red-600/30' 
                        : loadingPhase === 1 
                        ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-blue-950 border-blue-400/30 shadow-blue-500/30' 
                        : 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-emerald-950 border-emerald-400/30 shadow-emerald-500/30'
                    }`}>
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
                      <span className={`text-[11px] font-bold uppercase tracking-[0.6em] transition-colors duration-1000 ${
                        loadingPhase === 0 ? 'text-red-500/80' : loadingPhase === 1 ? 'text-blue-500/80' : 'text-emerald-500/80'
                      }`}>
                        {loadingPhase === 0 ? 'Deploying Permit Agent' : loadingPhase === 1 ? 'Deploying Student Agent' : 'Deploying Legal Agent'}
                      </span>
                    </div>

                    {/* Agent name */}
                    <AnimatePresence mode="wait">
                      <motion.h3
                        key={loadingPhase}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                        transition={{ duration: 0.5, ease: 'easeOut' }}
                        className="text-4xl md:text-6xl font-black text-[var(--text)] tracking-[0.4em] mb-6 uppercase leading-none font-[Outfit]"
                      >
                        {loadingPhase === 0 ? 'PERMIT' : loadingPhase === 1 ? 'STUDENT' : 'LEGAL'}
                      </motion.h3>
                    </AnimatePresence>

                    {/* Agent description */}
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={`desc-${loadingPhase}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, delay: 0.15 }}
                        className="text-[15px] md:text-[17px] text-[var(--muted)] max-w-lg leading-relaxed mb-10 font-medium italic"
                      >
                        {loadingPhase === 0 
                          ? 'Mapping work permit regulations, residence applications, and e-Devlet authentication pathways across Turkish municipal systems.'
                          : loadingPhase === 1 
                          ? 'Analyzing university enrollment pipelines, ÖYS registration systems, and student visa compliance requirements.'
                          : 'Indexing Turkish commercial law articles, contract frameworks, and legal precedent databases for consultation.'}
                      </motion.p>
                    </AnimatePresence>

                    {/* Progress bar */}
                    <div className="w-80 h-[2px] bg-[var(--border)] relative overflow-hidden mb-6 rounded-full">
                      <motion.div 
                        animate={{ x: ['-100%', '100%'] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className={`absolute inset-0 bg-gradient-to-r from-transparent to-transparent transition-all duration-1000 ${
                          loadingPhase === 0 ? 'via-red-600' : loadingPhase === 1 ? 'via-blue-500' : 'via-emerald-500'
                        }`}
                      />
                    </div>

                    {/* Micro status */}
                    <div className="flex items-center gap-3 text-[10px] font-bold text-[var(--muted)] tracking-[0.3em] uppercase">
                       <RefreshCw size={10} className={`animate-spin transition-colors duration-1000 ${
                         loadingPhase === 0 ? 'text-red-500' : loadingPhase === 1 ? 'text-blue-500' : 'text-emerald-500'
                       }`} />
                       <span>Initializing Neural Systems</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Desktop Navbar */}
          <div className="hidden md:block">
            <Navbar isAppPage />
          </div>

          {/* Mobile Top Bar */}
          <div className="flex md:hidden items-center justify-between px-4 h-14 shrink-0 border-b border-[var(--border)] bg-[var(--bg)] z-30 sticky top-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors"
            >
              <Menu size={22} />
            </button>
            <span className="text-[17px] font-semibold text-[var(--text)] tracking-tight">Dashboard</span>
            <div className="flex items-center gap-2">
              {user ? (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[13px] font-bold shadow-md">
                  {(user.fullName || user.email || 'U')[0].toUpperCase()}
                </div>
              ) : (
                <div className="w-9 h-9 rounded-full bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center">
                  <User size={16} className="text-[var(--muted)]" />
                </div>
              )}
            </div>
          </div>

          {/* Premium Background — Adapts perfectly to system theme */}
      <div className="absolute inset-0 z-0 w-full h-full overflow-hidden pointer-events-none bg-[var(--bg)] transition-colors duration-500">
        <div className="absolute inset-0 opacity-[0.4] bg-[radial-gradient(circle_at_20%_20%,rgba(26,115,232,0.05),transparent_50%),radial-gradient(circle_at_80%_80%,rgba(161,68,239,0.03),transparent_50%)]" />
      </div>

      <div className="relative z-20 pt-6 md:pt-24 pb-20 px-4 md:px-6">
        {/* Toast Notification */}
        <AnimatePresence>
          {showToast && (
            <motion.div
              initial={{ opacity: 0, y: -20, x: '-50%' }}
              animate={{ opacity: 1, y: 0, x: '-50%' }}
              exit={{ opacity: 0, y: -20, x: '-50%' }}
              className={`fixed top-24 left-1/2 z-50 rounded-lg shadow-xl border px-5 py-3 flex items-center gap-3 backdrop-blur-md ${toastType === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500' : 'border-red-500/20 bg-red-500/10 text-red-500'
                }`}
            >
              {toastType === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{toastMessage}</span>
                {toastType === 'success' && (
                  <button 
                    onClick={() => {
                      const url = toastMessage.toLowerCase().includes('mersis') ? 'https://mersis.gtb.gov.tr' : 'https://www.turkiye.gov.tr';
                      window.open(url, '_blank');
                    }}
                    className="text-[11px] font-bold underline mt-0.5 hover:text-white transition-colors flex items-center gap-1"
                  >
                    Go to Portal <ExternalLink size={10} />
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* e-Devlet Login Modal */}
        <AnimatePresence>
          {showModal && (
            <motion.div
              key="edevlet-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
                        <ShieldCheck size={20} className="text-red-500" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-[var(--text)]">{portalName} {t('dashboard_integration')}</h3>
                        <p className="text-[var(--muted)] text-sm italic">{t('dashboard_simulating')}</p>
                      </div>
                    </div>
                    <button onClick={() => setShowModal(false)} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
                      <X size={20} />
                    </button>
                  </div>

                  <p className="text-sm text-[var(--muted)] mb-6 leading-relaxed">
                    {t('dashboard_rpa_desc').replace('{url}', portalUrl)}
                  </p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">{t('dashboard_id_label')}</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                          <Fingerprint size={16} className="text-[var(--muted)]" />
                        </div>
                        <div className="w-full">
                          <input
                            type="text"
                            maxLength={11}
                            value={tckn}
                            onChange={(e) => setTckn(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            placeholder="11-digit ID number"
                          />
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">
                        {portalName} {t('dashboard_password_label')}
                      </label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                          <Lock size={16} className="text-[var(--muted)]" />
                        </div>
                        <div className="w-full">
                          <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-blue-500 transition-all outline-none"
                            placeholder="••••••••••••"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-8">
                    <button
                      onClick={submitEDevlet}
                      disabled={uploading}
                      className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-inner border border-red-400/20"
                    >
                      {uploading ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                      <span className="uppercase tracking-tight">{uploading ? t('dashboard_starting') : t('dashboard_trigger')}</span>
                    </button>
                    <p className="text-[10px] text-center text-gray-400 mt-3 font-medium">{t('dashboard_privacy_notice')}</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}

          {/* Student/Residency Automation Modal */}
          {showModal && currentAutomatedStep && (isIkamet || isInsurance) && (
            <motion.div
              key="student-modal"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                        <Sparkles size={20} className="text-purple-500" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-[var(--text)]">Automation Data</h3>
                        <p className="text-[var(--muted)] text-sm italic">Gathering info for the bot</p>
                      </div>
                    </div>
                    <button onClick={() => setShowModal(false)} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 slim-scroll">
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">Full Name</label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                        placeholder="e.g. John Doe"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">Passport No</label>
                        <input
                          type="text"
                          value={passportNo}
                          onChange={(e) => setPassportNo(e.target.value)}
                          className="w-full px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                          placeholder="A1234567"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">Date of Birth</label>
                        <input
                          type="date"
                          value={dob}
                          onChange={(e) => setDob(e.target.value)}
                          className="w-full px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">Passport Type</label>
                      <select
                        value={passportType}
                        onChange={(e) => setPassportType(e.target.value)}
                        className="w-full px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                      >
                        <option>Normal</option>
                        <option>Diplomatic</option>
                        <option>Service</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[var(--muted)] uppercase tracking-widest mb-1.5 ml-0.5">Ikamet Type</label>
                      <select
                        value={ikametType}
                        onChange={(e) => setIkametType(e.target.value)}
                        className="w-full px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:ring-2 focus:ring-purple-500 transition-all outline-none"
                      >
                        <option>Student</option>
                        <option>Short Term</option>
                        <option>Family</option>
                        <option>Work</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl">
                      <input
                        type="checkbox"
                        id="is_extension"
                        checked={isExtension}
                        onChange={(e) => setIsExtension(e.target.checked)}
                        className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                      />
                      <label htmlFor="is_extension" className="text-sm font-semibold text-[var(--text)]">This is an Extension Application</label>
                    </div>
                  </div>

                  <div className="mt-8">
                    <button
                      onClick={submitEDevlet}
                      disabled={uploading}
                      className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-inner border border-purple-400/20"
                    >
                      {uploading ? <RefreshCw size={18} className="animate-spin" /> : <Sparkles size={18} />}
                      <span className="uppercase tracking-tight">{uploading ? "Launching Bot..." : "Trigger Automation"}</span>
                    </button>
                    <p className="text-[10px] text-center text-gray-400 mt-3 font-medium">Data is encrypted and used only for this simulation session.</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-6xl mx-auto space-y-7">

          {/* ── Header ── */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-5"
          >
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 shadow-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  {t('dashboard_live_session')} - TRACKING ACTIVE
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-extrabold text-[var(--text)] tracking-tight py-1 font-inter">
                {(() => {
                  if (pendingInitialPrompt && !hasSteps) return 'New Application';
                  if (activeAssistantType === 'student') return t('dashboard_student_title');
                  if (activeAssistantType === 'lawyer') return t('dashboard_legal_title');
                  const loc = data?.combined_result?.location || '';
                  if (loc.startsWith('student.')) return t('dashboard_student_title');
                  if (loc.startsWith('lawyer.')) return t('dashboard_legal_title');
                  if (loc && (loc.includes('student') || loc.includes('renew') || loc.includes('uni'))) return t('dashboard_student_title');
                  if (loc && (loc.includes('lawyer') || loc.includes('legal'))) return t('dashboard_legal_title');
                  return t('dashboard_title') || 'Permit Dashboard';
                })()}
              </h1>
              <div className="flex items-center gap-4 py-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--border)] backdrop-blur-sm group hover:border-red-500/30 transition-all">
                  <MapPin size={12} className="text-red-500 group-hover:scale-120 transition-transform" />
                  <span className="text-[13px] font-bold text-[var(--text)] tracking-tight">
                    {(() => {
                      const loc = data?.combined_result?.location || '';
                      if (loc.includes('_') || loc.includes('.')) {
                         const parts = loc.split(/[._]/);
                         const formatted = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
                         return formatted;
                      }
                      if (loc) return `${loc} ${data?.combined_result?.business_type || ''}`;
                      return isRTL ? 'مشروع في إسطنبول' : 'Istanbul Area';
                    })()}
                  </span>
                </div>

                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/5 dark:bg-white/5 border border-[var(--border)] backdrop-blur-sm group hover:border-purple-500/30 transition-all">
                  <Calendar size={12} className="text-purple-500 group-hover:scale-120 transition-transform" />
                  <span className="text-[13px] font-bold text-[var(--text)] tracking-tight" suppressHydrationWarning>
                    {data?.last_updated ? `${t('dashboard_updated')} ${new Date(data.last_updated).toLocaleDateString()}` : t('dashboard_no_session')}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 md:gap-3 shrink-0">
              {/* Subscription Status Badge */}
              <div className={`h-11 px-5 rounded-full flex items-center gap-2.5 border transition-all duration-300 cursor-default shadow-lg ${
                data?.subscription_status === 'active' 
                  ? 'glass-mesh mesh-emerald border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-emerald-500/10 active:scale-95' 
                  : 'bg-[var(--surface-2)]/80 border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] shadow-sm'
              }`}>
                <div className="relative">
                  <Sparkles size={14} className={data?.subscription_status === 'active' ? 'text-emerald-500 animate-pulse' : 'text-[var(--muted)] opacity-50'} />
                  {data?.subscription_status === 'active' && (
                    <motion.div animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 bg-emerald-400 blur-md rounded-full -z-10" />
                  )}
                </div>
                <span className="text-[12px] font-black uppercase tracking-[0.2em] hidden sm:inline-block whitespace-nowrap">
                  {data?.subscription_status === 'active' ? t('dashboard_premium') : t('dashboard_free_plan')}
                </span>
              </div>

              {data?.subscription_status !== 'active' && (
                <button 
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                  className="btn btn-indigo !h-10 !px-5 !text-[11px] !rounded-full shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                >
                  {isSubscribing ? <RefreshCw size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                  <span className="uppercase tracking-wide">{isSubscribing ? t('dashboard_starting') : t('dashboard_upgrade')}</span>
                </button>
              )}

              <button 
                onClick={refresh} 
                className="btn btn-outline !h-10 !w-10 !p-0 !text-sm lg:flex hidden items-center justify-center !rounded-full hover:bg-[var(--surface-2)] border-[var(--border)] transition-all"
                title="Refresh"
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : 'text-[var(--muted)]'} />
              </button>
              
              <Link href="/chat">
                <button className="btn btn-purple !h-10 !px-6 !text-[11px] flex items-center gap-2 !rounded-full group shadow-xl hover:shadow-purple-500/30 hover:scale-[1.03] active:scale-95 transition-all">
                  <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" /> 
                  <span className="uppercase tracking-wide">{t('dashboard_ask_ai')}</span>
                </button>
              </Link>
            </div>

          </motion.div>

          {/* ── Stats ── */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ease: 'easeOut', duration: 0.4, delay: 0.05 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4"
          >
            {([
              { label: t('dashboard_compliance_score'), value: `${progress > 0 ? progress : '0'}%`,  icon: ShieldCheck,  color: '#ff4d4d', glow: 'rgba(255,77,77,0.7)' },
              { label: t('dashboard_steps_complete'),   value: `${done}/${steps.length}`,            icon: CheckCircle2, color: '#ff00ff', glow: 'rgba(255,0,255,0.7)' },
              { label: t('dashboard_est_days'),         value: `${Math.max(0, steps.length*2 - done*2)}d`, icon: Clock,    color: '#ffaa00', glow: 'rgba(255,170,0,0.7)' },
              { label: t('dashboard_active_agents'),    value: `${data?.execution_plan?.assigned_agents?.length || 0}`, icon: Cpu, color: '#00ccff', glow: 'rgba(0,204,255,0.7)' },
            ] as const).map((s, i) => (
              <motion.div 
                key={i} 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ y: -8, scale: 1.02 }}
                transition={{ delay: 0.1 + (i * 0.05) }}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-[28px] p-6 flex flex-col gap-6 hover:border-[var(--border-2)] transition-all group shadow-[0_15px_40px_rgba(0,0,0,0.05)] dark:shadow-[0_15px_40px_rgba(0,0,0,0.9)] relative overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--text)]/[0.04] to-transparent pointer-events-none" />
                <div className="flex items-center justify-between relative z-10">
                  <div style={{ color: s.color, backgroundColor: `${s.color}15`, borderColor: `${s.color}30` }} className="p-4 rounded-[20px] transition-all group-hover:bg-[var(--surface-2)] shadow-2xl border">
                    <s.icon size={28} style={{ filter: `drop-shadow(0 0 12px ${s.glow})` }} />
                  </div>
                  <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: s.color, boxShadow: `0 0 20px ${s.glow}` }} />
                </div>
                <div className="relative z-10">
                  <p className="text-[12px] text-[var(--muted)] font-bold uppercase tracking-[0.25em] mb-2 leading-none opacity-90 group-hover:opacity-100 transition-opacity">{s.label}</p>
                  <p className="text-3xl font-black text-[var(--text)] tracking-tighter leading-none transition-colors duration-500" style={{ textShadow: `0 10px 40px ${s.glow}44` }}>{s.value}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* ── Progress Bar ── */}
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="bg-[var(--surface-1)] border border-[var(--border)] p-7 rounded-[32px] flex flex-col md:flex-row items-center gap-10 shadow-[0_20px_50px_rgba(0,0,0,0.05)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.9)] relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-transparent to-purple-500/10 pointer-events-none" />
            <div className="flex flex-col shrink-0 relative z-10">
              <span className="text-[12px] text-[var(--muted)] font-bold uppercase tracking-[0.3em] mb-4 opacity-50">Global Application Velocity</span>
              <div className="flex items-baseline gap-3">
                <span className="text-5xl font-black text-[var(--text)] tracking-tighter transition-colors duration-500" style={{ textShadow: '0 0 50px rgba(255,77,77,0.2)' }}>{progress}%</span>
                {showIncrease && (
                  <motion.span
                    initial={{ opacity: 0, x: -5 }} animate={{ opacity: 1, x: 0 }}
                    className="text-xl font-black text-emerald-400"
                  >
                    +{increaseAmount}%
                  </motion.span>
                )}
              </div>
            </div>
            <div className="flex-1 w-full h-5 bg-[var(--surface-2)] rounded-full overflow-hidden border border-[var(--border)] relative z-10 shadow-inner">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.5, ease: 'easeOut', delay: 0.5 }}
                className="h-full bg-gradient-to-r from-[#ff4d4d] via-[#ff00ff] to-[#4285f4] rounded-full shadow-[0_0_30px_rgba(255,77,77,0.4)]"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-30" />
            </div>
            <div className="flex flex-col items-end shrink-0 relative z-10 border-l border-[var(--border)] pl-8">
              <span className="text-[12px] text-[var(--muted)] font-black uppercase tracking-[0.3em] mb-4">Protocols</span>
              <div className="flex items-center gap-4">
                <div className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.8)] animate-pulse" />
                <span className="text-3xl font-black text-[var(--text)] tracking-[0.1em] transition-colors duration-500">{done} / {steps.length}</span>
              </div>
            </div>
          </motion.div>

          {/* ── Main Grid ── */}
          <div className="grid lg:grid-cols-12 gap-5">

            {/* Workflow Steps */}
            <div className="lg:col-span-8 space-y-4 min-w-0">
              <div className="flex flex-col md:flex-row md:items-center justify-between px-2 mb-6 gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                    <FileText size={20} className="text-blue-400" />
                  </div>
                  <h2 className="text-xl md:text-2xl font-bold text-[var(--text)] tracking-tight font-inter transition-colors duration-500">
                    My Application Guide
                  </h2>
                </div>
                
                <div className="flex items-center gap-5 p-2 px-4 rounded-full bg-[var(--surface-2)] border border-[var(--border)] transition-colors duration-500">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Complete</span>
                  </div>
                  <div className="h-4 w-px bg-[var(--border)]" />
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-400" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">Current</span>
                  </div>
                </div>
              </div>

              <div className="relative space-y-4">
                {(showAllSteps ? steps : steps.slice(0, 3)).map((s, i) => (
                  <div key={i} className="relative">
                    {/* Timeline Connector Line */}
                    {i < ((showAllSteps ? steps : steps.slice(0, 3)).length - 1) && (
                      <div className={`workflow-connector ${s.status === 'completed' ? 'workflow-connector-done' : s.status === 'in-progress' ? 'workflow-connector-active' : ''}`} />
                    )}

                    <motion.div
                      initial={{ opacity: 0, x: -14 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05, ease: 'easeOut', duration: 0.35 }}
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className={`glow-card bg-[var(--surface)] border border-[var(--border)] rounded-[28px] cursor-pointer group transition-all relative z-10 ${
                        expanded === i ? 'ring-2 ring-indigo-500/20 bg-[var(--surface-1)] shadow-2xl' : 'hover:bg-[var(--surface-2)] shadow-sm'
                      } ${
                        s.status === 'completed'   ? 'step-card-completed' :
                        s.status === 'in-progress' ? 'step-card-inprogress' :
                                                    'step-card-pending'
                      }`}
                    >
                      <div className="p-5 flex items-start gap-6">
                        <div className="shrink-0 relative z-20">
                          <div className={`step-num h-10 w-10 !text-[13px] !font-black !rounded-2xl !bg-[var(--surface-2)] !border-[var(--border)] shadow-inner transition-all duration-300 ${
                            s.status === 'completed'   ? 'step-num-completed shadow-lg shadow-emerald-500/20 !bg-emerald-500 !text-white scale-110' : 
                            s.status === 'in-progress' ? 'step-num-inprogress shadow-lg shadow-purple-500/20 !bg-purple-500 !text-white animate-pulse scale-110' :
                            expanded === i ? '!bg-indigo-500 !text-white' : ''
                          }`}>
                            {s.status === 'completed' ? <Check size={20} strokeWidth={3} /> : i + 1}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <h3 className={`text-[14px] font-bold tracking-normal truncate pr-4 transition-colors uppercase font-inter ${expanded === i ? 'text-indigo-500' : 'text-[var(--text)]'}`}>
                              {s.title}
                            </h3>
                            <div className="flex items-center gap-2 shrink-0">
                              {(s.responsible.includes('Agent') || s.responsible.includes('Ajan') || s.responsible.includes('وكيل')) ? (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.1)] group">
                                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }}>
                                    <Cpu size={10} className="text-red-500" />
                                  </motion.div>
                                  <span className="text-[10px] font-bold uppercase tracking-widest font-inter text-red-500">{t('agent_badge')}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 shadow-[0_0_15px_rgba(59,130,246,0.1)]">
                                  <User size={10} className="text-blue-500" />
                                  <span className="text-[10px] font-bold uppercase tracking-widest font-inter text-blue-500">HUMAN</span>
                                </div>
                              )}
                              <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest font-inter border shadow-xl backdrop-blur-md transition-all ${
                                s.status === 'completed'
                                  ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-500 shadow-emerald-500/10'
                                  : 'bg-amber-500/20 border-amber-500/30 text-amber-500 shadow-amber-500/10'
                              }`}>
                                {s.status === 'completed' ? t('status_completed') : t('status_pending')}
                              </div>
                            </div>
                          </div>
                          <p className={`text-[12px] text-[var(--muted)] leading-relaxed transition-all duration-300 font-inter font-bold ${expanded === i ? 'line-clamp-none opacity-100' : 'line-clamp-1 opacity-90 group-hover:opacity-100'}`}>
                            {s.summary}
                          </p>
                    </div>

                    <ChevronDown size={20} className={`shrink-0 text-[var(--muted)] opacity-30 mt-1.5 transition-transform duration-500 ${expanded === i ? 'rotate-180 opacity-100 text-indigo-500' : ''}`} />
                  </div>

                  <AnimatePresence>
                    {expanded === i && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-3 border-t border-[var(--border)] space-y-4">
                          {/* Manual instructions box */}
                          <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-3">
                            <p className="text-[13px] text-[var(--text)] opacity-80 leading-relaxed font-inter font-medium">{s.detail}</p>
                          </div>

                          {s.docs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {s.docs.map((doc: string) => (
                                <div key={doc} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-inter font-bold text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer bg-[var(--surface-2)] border border-[var(--border)]">
                                  <FileText size={11} className="text-purple-400 shrink-0" />
                                  {doc}
                                  <ExternalLink size={9} className="text-[var(--muted)] opacity-70" />
                                </div>
                              ))}
                            </div>
                          )}

                          {s.status !== 'completed' && (
                            <div className="flex flex-wrap gap-2 items-center pt-1">
                              {(s.responsible.includes('Agent') || s.responsible.includes('Ajan') || s.responsible.includes('وكيل')) ? (
                                <>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); automateStep(s.id); }}
                                    disabled={uploading} 
                                    title={t('dashboard_upload')}
                                    className="flex items-center justify-center w-[34px] h-[34px] bg-[#E30A17] hover:bg-[#C20914] text-white rounded-[10px] shadow-[0_0_15px_rgba(227,10,23,0.35)] transition-all shrink-0 disabled:opacity-50 border border-white/10 group z-10 mr-1"
                                  >
                                    {uploading && automatedStepId === s.id ? (
                                      <RefreshCw size={16} className="animate-spin" />
                                    ) : (
                                      <div className="relative flex items-center justify-center">
                                        <img 
                                          src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/E-Devlet_Kap%C4%B1s%C4%B1_logo.svg/320px-E-Devlet_Kap%C4%B1s%C4%B1_logo.svg.png" 
                                          alt="e-Devlet"
                                          className="h-5 w-auto object-contain brightness-0 invert group-hover:scale-110 transition-transform" 
                                          onError={(e) => { 
                                            (e.target as HTMLElement).style.display = 'none'; 
                                            (e.target as HTMLElement).nextElementSibling?.classList.remove('hidden'); 
                                          }}
                                        />
                                        <ShieldCheck size={16} className="hidden" />
                                      </div>
                                    )}
                                  </button>
                                  <button
                                    disabled
                                    className="btn !py-2 !px-3.5 !text-[11px] flex items-center gap-1.5 opacity-40 cursor-not-allowed bg-[var(--surface-2)] border-[var(--border)] text-[var(--muted)] !rounded-lg !whitespace-normal flex-1 sm:flex-none text-left"
                                    title="Bot automation disabled pending legal approval"
                                  >
                                    <Lock size={11} className="shrink-0" />
                                    {language === 'ar' ? 'معطّل — بانتظار الموافقة' : language === 'tr' ? 'Devre Dışı — Yasal Onay' : 'Disabled — Pending Law Approval'}
                                  </button>
                                  <a
                                    href={
                                      ((s.title || '') + (s.summary || '')).toLowerCase().includes('mersis')
                                        ? 'https://mersis.ticaret.gov.tr/Portal/KullaniciIslemleri/GirisIslemleri'
                                        : ((s.title || '') + (s.summary || '')).toLowerCase().includes('gıda') ||
                                          ((s.title || '') + (s.summary || '')).toLowerCase().includes('food') ||
                                          ((s.title || '') + (s.summary || '')).toLowerCase().includes('tarim')
                                        ? 'https://www.tarim.gov.tr'
                                        : 'https://www.turkiye.gov.tr'
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="btn btn-outline !py-2 !px-3.5 !text-xs flex items-center gap-1.5 !rounded-lg"
                                  >
                                    <ExternalLink size={11} />
                                    {language === 'ar' ? 'افعلها يدوياً' : language === 'tr' ? 'Manuel Yap' : 'Do Manually →'}
                                  </a>
                                </>
                              ) : (
                                <button
                                  onClick={(e) => { e.stopPropagation(); markComplete(s.id); }}
                                  className="btn btn-emerald !py-2 !px-4 !text-xs flex items-center gap-1.5 !rounded-lg"
                                >
                                  <CheckCircle2 size={12} /> {t('dashboard_mark_complete')}
                                </button>
                              )}
                            </div>
                          )}

                          {/* Ask AI about this step */}
                          <div className="pt-1 border-t border-white/[0.06]">
                            <button
                              onClick={(e) => { e.stopPropagation(); askAiAboutStep(s); }}
                              className="flex items-center gap-2 text-[12px] font-bold text-purple-400 hover:text-purple-300 transition-colors group/ai"
                            >
                              <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-purple-500/15 border border-purple-500/25 group-hover/ai:bg-purple-500/25 transition-colors">
                                <MessageSquare size={11} />
                              </span>
                              {language === 'ar' ? 'اسأل الذكاء الاصطناعي عن هذه الخطوة ←' : language === 'tr' ? 'Bu Adım Hakkında AI\'a Sor →' : 'Ask AI more about this step →'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                    </motion.div>
                  </div>
                ))}
              </div>

              {/* Show More / Less / Upgrade */}
              {steps.length > 3 && (
                <button
                  onClick={() => setShowAllSteps(!showAllSteps)}
                  className="w-full py-3 rounded-2xl border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] transition-all text-sm font-semibold flex items-center justify-center gap-2"
                >
                  <ChevronDown size={16} className={`transition-transform duration-300 ${showAllSteps ? 'rotate-180' : ''}`} />
                  {showAllSteps ? `Show less` : `Show ${steps.length - 3} more steps`}
                </button>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-4 space-y-4">

              {/* Action Required */}
              <div className="glass-mesh mesh-amber p-5 space-y-4 shadow-xl overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />
                <div className="flex items-start gap-3 relative z-10">
                  <div className="h-9 w-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-500 shrink-0">
                    <AlertCircle size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-black text-amber-500 uppercase tracking-widest">{t('dashboard_action_required')}</p>
                    <p className="text-[15px] font-bold text-[var(--text)] mt-1 leading-tight">
                      {steps.find(s => s.status !== 'completed' && s.responsible !== 'Agent')?.title || t('dashboard_all_clear')}
                    </p>
                  </div>
                </div>
                <p className="text-[13px] text-[var(--text)] opacity-70 leading-relaxed font-medium relative z-10">
                  {steps.find(s => s.status !== 'completed' && s.responsible !== 'Agent') 
                    ? t('dashboard_action_required_desc').replace('{step}', steps.find(s => s.status !== 'completed' && s.responsible !== 'Agent')?.title || '')
                    : t('dashboard_bot_processing')}
                </p>
                {steps.find(s => s.status !== 'completed' && s.responsible !== 'Agent') && (
                  <button 
                    onClick={() => markComplete(steps.find(s => s.status !== 'completed' && s.responsible !== 'Agent')?.id)} 
                    className="btn btn-purple w-full !py-2.5 !text-sm justify-center shadow-lg transform transition-transform hover:scale-[1.02] relative z-10"
                  >
                    <CheckCircle2 size={14} /> {t('dashboard_mark_done')}
                  </button>
                )}
              </div>

              {/* AI Agents */}
              <div className="glass-card p-5 space-y-5 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest">{t('dashboard_active_agents')}</p>
                  <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-500 dark:text-emerald-400">
                    <span className="live-dot w-2 h-2 relative shrink-0" />
                    {data?.execution_plan?.assigned_agents?.length || 0} {t('dashboard_active')}
                  </span>
                </div>
                <div className="space-y-3">
                  {(data?.execution_plan?.assigned_agents?.length > 0 ? data.execution_plan.assigned_agents : ['permit', 'student', 'lawyer']).map((agent_id: string, i: number) => {
                    // Extract the base type if it comes from the execution plan (e.g., "Permit Agent" -> "permit")
                    const type = agent_id.toLowerCase().includes('student') ? 'student' : (agent_id.toLowerCase().includes('lawyer') || agent_id.toLowerCase().includes('legal') || agent_id.toLowerCase().includes('law')) ? 'lawyer' : 'permit';
                    
                    const isActive = data?.execution_plan?.assigned_agents?.some((a: any) => a.toLowerCase().includes(type));
                    const displayName = `${t(`assistant_${type}`)} ${t('agent_badge')}`;
                    
                    return (
                      <div 
                        key={i} 
                        onClick={() => handleSwitchAssistant(type)}
                        className={`group flex items-center gap-3 p-3.5 rounded-2xl transition-all hover:translate-x-1 cursor-pointer glass-mesh ${isActive ? 'mesh-red shadow-[0_0_20px_rgba(239,68,68,0.1)] hover:bg-red-500/5' : 'border-[var(--border)] bg-[var(--surface-1)] hover:bg-[var(--surface-2)]'} shadow-sm`}
                      >
                        <div className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${isActive ? 'text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-500/20 border-red-500/20 group-hover:bg-red-500/30' : 'text-[var(--muted)] bg-[var(--surface-2)] border-[var(--border)]'} border shadow-sm transition-colors`}>
                          <Cpu size={14} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[14px] font-bold ${isActive ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{displayName}</p>
                          <p className="text-[11px] text-[var(--muted)] font-medium truncate">{t('dashboard_agent_status')}</p>
                        </div>
                        <div className="flex flex-col items-end">
                           <span className={`text-[9px] font-black uppercase tracking-widest group-hover:hidden transition-colors ${isActive ? 'text-red-500' : 'text-[var(--muted)] opacity-50'}`}>
                             {isActive ? t('dashboard_running') : t('dashboard_stopped') || 'STOPPED'}
                           </span>
                           <span className={`hidden group-hover:block text-[9px] font-black uppercase tracking-widest text-red-600 animate-pulse`}>
                             {t('chat_switch_assistant')} →
                           </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Next Step */}
              <div className="glass-card p-5 space-y-4 shadow-xl">
                <p className="text-xs font-black text-[var(--muted)] uppercase tracking-widest">{t('dashboard_whats_next')}</p>
                <p className="text-[14px] text-[var(--text)] opacity-90 leading-relaxed font-medium">
                  {t('dashboard_next_step_desc')}
                </p>
                <Link href="/chat" className="text-sm font-bold text-purple-400 hover:text-purple-300 flex items-center gap-2 transition-all hover:translate-x-1">
                  {t('dashboard_ask_ai_step')} <ArrowRight size={14} />
                </Link>
              </div>

            </div>
          </div>
        </div>
      </div>
    </main>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)] transition-colors duration-500">
      <Sidebar 
        currentSessionId={dashboardSessionId}
        assistantType={activeAssistantType}
        onSessionSelect={(id, title) => {
          localStorage.setItem('permitops_active_session_id', id);
          fetchState();
        }}
        onNewChat={() => {
          localStorage.removeItem('permitops_active_session_id');
          router.push('/chat');
        }}
        onSwitchAssistant={handleSwitchAssistant}
        onDeleteSession={(id) => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />
      {renderContent()}
      {/* Iyzico CheckOut Form Modal */}
      <AnimatePresence>
        {iyzicoFormHtml && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-[#1e1f20] w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col relative"
              style={{ minHeight: '600px' }}
            >
              <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
                <h3 className="font-bold text-[var(--text)]">Complete Your Subscription</h3>
                <button onClick={() => setIyzicoFormHtml(null)} className="p-2 hover:bg-black/5 rounded-full text-[var(--muted)]">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4" id="iyzico-form-container">
                 {/* iyzico script injection */}
                 <div dangerouslySetInnerHTML={{ __html: iyzicoFormHtml }} />
                 <div id="iyzipay-checkout-form" className="responsive"></div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}

