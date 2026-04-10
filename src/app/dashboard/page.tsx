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

  // Subscription State
  const [iyzicoFormHtml, setIyzicoFormHtml] = useState<string | null>(null);
  const [isSubscribing, setIsSubscribing] = useState(false);

  const askAiAboutStep = (step: { id: number; title: string; summary: string; detail: string; responsible: string }) => {
    const q = `I need more information about Step ${step.id}: "${step.title}". ${step.detail ? step.detail.slice(0, 300) : step.summary} Can you explain this in more detail, including what exactly I need to do, which documents I need, and any tips?`;
    localStorage.setItem('permitops_ask_step', q);
    // Use the session that THIS dashboard loaded data from — not whatever was last visited in chat
    if (dashboardSessionId) localStorage.setItem('permitops_ask_step_session', dashboardSessionId);
    router.push('/chat');
  };

  const fetchState = useCallback(async () => {
    const startTime = Date.now();
    try {
      setLoading(true);
      const token = localStorage.getItem('permitops_token');
      const sid = localStorage.getItem('permitops_active_session_id');
      const params = new URLSearchParams();
      if (token) params.append('token', token);
      if (sid) params.append('session_id', sid);
      const query = params.toString() ? `?${params.toString()}` : '';

      const res = await apiFetch(`/workflow/latest${query}`);
      if (res?.ok) {
        const json = await res.json();
        setData(json);
        // _session_id is the authoritative session this data belongs to
        const resolvedSession = json._session_id || sid;
        if (resolvedSession) setDashboardSessionId(resolvedSession);
      }
    } catch (e) {
      console.error("Failed to fetch dashboard data", e);
    } finally {
      // Ensure the loading screen shows for at least 2 seconds for branding/traffic control
      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 2000 - elapsed);
      
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, remaining));
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();

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
      const remaining = Math.max(0, 2000 - elapsed);
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
      title: t('dashboard_init_title'),
      responsible: 'Agent',
      status: 'pending' as Status,
      date: 'N/A',
      summary: t('dashboard_init_summary'),
      detail: t('dashboard_init_detail'),
      docs: [],
    }
  ];

  const done = steps.filter(s => s.status === 'completed').length;
  const progress = steps.length > 0 ? Math.round((done / steps.length) * 100) : 0;

  const currentAutomatedStep = automatedStepId ? steps.find(s => s.id === automatedStepId) : null;
  const isMersis = currentAutomatedStep && (
    [3, 4, 5].includes(currentAutomatedStep.id) ||
    (
      (currentAutomatedStep.title || "") + 
      (currentAutomatedStep.detail || "") + 
      (currentAutomatedStep.summary || "")
    ).toLowerCase().includes("mersis")
  );
  const portalName = isMersis ? "MERSİS" : "e-Devlet";
  const portalUrl = isMersis ? "https://mersis.ticaret.gov.tr/Portal/KullaniciIslemleri/GirisIslemleri" : "https://giris.turkiye.gov.tr/Giris/";

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
        body: JSON.stringify({ tckn, password, portal_url: portalUrl, step_id: automatedStepId })
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
          const isMersis = step && (
            (step.title || "") + 
            (step.detail || "") + 
            (step.summary || "")
          ).toLowerCase().includes("mersis");
          
          let targetUrl = "https://www.turkiye.gov.tr";
          if (isMersis) targetUrl = "https://mersis.gtb.gov.tr";
          
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
      const remaining = Math.max(0, 2000 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
      
      setUploading(false);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    }
  };

  const renderContent = () => {
    if (loading) {
      return <LoadingScreen />;
    }

    return (
      <main className="flex-1 min-w-0 relative overflow-y-auto overflow-x-hidden slim-scroll bg-[var(--bg)]">
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
      {/* Video Background */}
      <div className="absolute inset-0 z-0 w-full h-full overflow-hidden">
        {/* Fallback Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--surface-2)] via-[var(--bg)] to-[var(--surface-2)] dark:hidden" />
        
        <video
          autoPlay
          loop
          muted
          playsInline
          onLoadedData={(e) => {
            const video = e.currentTarget;
            video.style.opacity = '1';
          }}
          style={{ opacity: 0, transition: 'opacity 1s ease' }}
          className="absolute inset-0 w-full h-full object-cover z-10 hidden"
        >
          <source src="/dashboard_bg.mp4" type="video/mp4" />
        </video>

        {/* Dynamic mesh gradient overlays */}
        <div className="absolute inset-0 z-20 pointer-events-none opacity-20 dark:opacity-40">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/20 blur-[120px] animate-pulse" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/20 blur-[120px] animate-pulse [animation-delay:2s]" />
        </div>
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
                      disabled={true}
                      className="w-full py-3 px-4 bg-red-600 cursor-not-allowed opacity-70 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2 shadow-inner border border-red-400/20"
                    >
                      <ShieldCheck size={18} />
                      <span className="uppercase tracking-tight">{t('dashboard_disabled_law')}</span>
                    </button>
                    <p className="text-[10px] text-center text-gray-400 mt-3 font-medium">{t('dashboard_privacy_notice')}</p>
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
            <div className="space-y-1.5">
              <span className="badge badge-purple">
                <Activity size={10} className="animate-pulse" />
                {t('dashboard_live_session')} · #{data?.combined_result?.location && !data.combined_result.location.includes('_') ? `IST-${data.combined_result.location.substring(0,3).toUpperCase().replace(/İ/g, 'I')}-4221` : 'IST-TR-4221'}
              </span>
              <h1 className="text-4xl md:text-6xl font-black text-gradient-premium tracking-tight drop-shadow-[0_2px_15px_rgba(0,0,0,0.08)] py-1">
                {(() => {
                  const loc = data?.combined_result?.location || '';
                  if (loc.startsWith('student.')) return t('dashboard_student_title');
                  if (loc.startsWith('lawyer.')) return t('dashboard_legal_title');
                  if (loc && (loc.includes('student') || loc.includes('renew') || loc.includes('uni'))) return t('dashboard_student_title');
                  if (loc && (loc.includes('lawyer') || loc.includes('legal'))) return t('dashboard_legal_title');
                  return t('dashboard_title') || 'Permit Dashboard';
                })()}
              </h1>
              <p className="text-sm text-[var(--muted)] flex items-center gap-3 flex-wrap font-medium dark:drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                <span className="flex items-center gap-1.5">
                  <MapPin size={12} className="text-purple-500" />
                  {(() => {
                    const loc = data?.combined_result?.location || '';
                    if (loc.includes('_') || loc.includes('.')) {
                       // Format the intent e.g., student_renew -> Renew Id, student.register_uni -> Register Uni
                       const parts = loc.split(/[._]/);
                       const formatted = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
                       return formatted;
                    }
                    if (loc) return `${loc} ${data?.combined_result?.business_type || ''}`;
                    return isRTL ? 'مشروع في إسطنبول' : 'Istanbul Area';
                  })()}
                </span>
                <span className="h-3 w-px bg-[var(--border)]" />
                <span className="flex items-center gap-1.5" suppressHydrationWarning><Calendar size={12} className="text-purple-500" /> {data?.last_updated ? `${t('dashboard_updated')} ${new Date(data.last_updated).toLocaleDateString()}` : t('dashboard_no_session')}</span>
              </p>
            </div>

            <div className="flex items-center gap-2.5 md:gap-3 shrink-0">
              {/* Subscription Status Badge */}
              <div className={`h-10 px-4 rounded-full flex items-center gap-2 border transition-all cursor-default ${
                data?.subscription_status === 'active' 
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
                  : 'bg-[var(--surface-2)]/50 border-[var(--border)] text-[var(--muted)]'
              }`}>
                <Sparkles size={13} className={data?.subscription_status === 'active' ? 'text-emerald-500' : 'text-[var(--muted)] opacity-50'} />
                <span className="text-[11px] font-bold uppercase tracking-wider hidden sm:inline whitespace-nowrap">
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
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ease: 'easeOut', duration: 0.4, delay: 0.07 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            {([
              { label: t('dashboard_compliance_score'), value: `${progress > 0 ? progress : '0'}%`,  from: '#34d399', to: '#10b981', icon: ShieldCheck,  iconColor: '#34d399', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.25)', mesh: 'mesh-emerald' },
              { label: t('dashboard_steps_complete'),   value: `${done}/${steps.length}`,            from: '#c084fc', to: '#a855f7', icon: CheckCircle2, iconColor: '#c084fc', bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.25)', mesh: 'mesh-purple' },
              { label: t('dashboard_est_days'),         value: `${Math.max(0, steps.length*2 - done*2)}d`, from: '#fcd34d', to: '#f59e0b', icon: Clock,    iconColor: '#fcd34d', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.25)', mesh: 'mesh-amber'  },
              { label: t('dashboard_active_agents'),    value: `${data?.execution_plan?.assigned_agents?.length || 0}`, from: '#60a5fa', to: '#3b82f6', icon: Cpu, iconColor: '#60a5fa', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)', mesh: 'mesh-indigo' },
            ] as const).map((s, i) => (
              <motion.div 
                key={i} 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + (i * 0.05) }}
                className={`glow-card bg-[var(--surface)] p-6 flex flex-col gap-4 group cursor-default shadow-lg overflow-hidden border border-[var(--border)]`}
              >
                <div className={`absolute inset-0 ${s.mesh} opacity-30 group-hover:opacity-50 transition-opacity`} />
                <div className="flex items-center justify-between relative z-10 w-full">
                  <div style={{ background: s.bg, border: `1px solid ${s.border}` }} className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform shadow-inner">
                    <s.icon size={18} style={{ color: s.iconColor }} />
                  </div>
                  <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: s.iconColor }} />
                </div>
                <div className="relative z-10">
                  <p className="text-[10px] text-[var(--muted)] font-black uppercase tracking-[0.15em] mb-1.5">{s.label}</p>
                  <p className="text-3xl font-black leading-tight tracking-tight" style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{s.value}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* ── Progress Bar ── */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="glass-card p-5 flex items-center gap-6 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-transparent to-purple-500/5 pointer-events-none" />
            <div className="flex flex-col shrink-0 relative z-10">
              <span className="text-[11px] text-[var(--muted)] font-black uppercase tracking-[0.2em]">{t('dashboard_overall_progress')}</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-3xl font-black text-[var(--text)]">{progress}%</span>
                <span className="text-xs font-bold text-emerald-500">+{Math.round(progress/2)}%</span>
              </div>
            </div>
            <div className="flex-1 h-3.5 bg-black/5 dark:bg-white/5 rounded-full overflow-hidden border border-[var(--border)] shadow-inner relative z-10">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 1.6, ease: [0.34, 1.56, 0.64, 1], delay: 0.5 }}
                className="h-full rounded-full relative overflow-hidden"
                style={{ background: 'linear-gradient(90deg, #4f46e5, #7c3aed, #a855f7, #c084fc)' }}
              >
                <div className="absolute inset-0 bg-[length:200%_100%] animate-[shimmer-sweep_2s_linear_infinite]" style={{ background: 'linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.3) 50%, transparent 75%)', backgroundSize: '200% 100%' }} />
              </motion.div>
            </div>
            <div className="text-right shrink-0 relative z-10">
              <span className="text-[11px] text-[var(--muted)] font-black uppercase tracking-[0.2em] block">Status</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                <span className="text-sm font-black text-[var(--text)] tracking-wider">{done} / {steps.length}</span>
              </div>
            </div>
          </motion.div>

          {/* ── Main Grid ── */}
          <div className="grid lg:grid-cols-12 gap-5">

            {/* Workflow Steps */}
            <div className="lg:col-span-8 space-y-2 min-w-0">
              <div className="flex items-center justify-between px-2 mb-2">
                <h2 className="text-xl font-black tracking-tight uppercase tracking-[0.05em]">{t('dashboard_roadmap')}</h2>
                <div className="flex items-center gap-4 text-[11px] font-black uppercase tracking-[0.15em] text-[var(--muted)]">
                   <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" /> DONE</div>
                   <div className="flex items-center gap-1.5"><div className="h-1.5 w-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" /> ACTIVE</div>
                </div>
              </div>
              {(showAllSteps && data?.subscription_status === 'active' ? steps : steps.slice(0, 3)).map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, ease: 'easeOut', duration: 0.35 }}
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  className={`glow-card bg-[var(--surface)] border border-[var(--border)] rounded-[28px] cursor-pointer group transition-all relative z-10 ${
                    expanded === i ? 'ring-2 ring-indigo-500/20 bg-[var(--surface-2)]/40 shadow-2xl' : 'hover:bg-[var(--surface-2)]/30'
                  } ${
                    s.status === 'completed'   ? 'step-card-completed' :
                    s.status === 'in-progress' ? 'step-card-inprogress' :
                                                 'step-card-pending'
                  }`}
                >
                  <div className="p-5 flex items-start gap-5">
                    <div className="shrink-0 relative">
                      <div className={`step-num h-9 w-9 !text-[12px] !font-black !rounded-xl !bg-[var(--surface-2)] !border-[var(--border)] transition-all ${
                        s.status === 'completed'   ? 'step-num-completed shadow-lg shadow-emerald-500/20 !bg-emerald-500 !text-white' : 
                        s.status === 'in-progress' ? 'step-num-inprogress shadow-lg shadow-purple-500/20 !bg-purple-500 !text-white' :
                        expanded === i ? '!bg-indigo-500 !text-white' : ''
                      }`}>
                        {s.status === 'completed' ? <Check size={18} /> : i + 1}
                      </div>
                    </div>

                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center justify-between mb-1.5 gap-2">
                        <h3 className={`text-[15px] font-black tracking-tight truncate pr-4 transition-colors uppercase ${expanded === i ? 'text-indigo-500' : 'text-[var(--text)]'}`}>
                          {s.title}
                        </h3>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={
                            (s.responsible.includes('Agent') || s.responsible.includes('Ajan') || s.responsible.includes('وكيل'))
                              ? 'agent-chip' : 'human-chip'
                          }>
                            {(s.responsible.includes('Agent') || s.responsible.includes('Ajan') || s.responsible.includes('وكيل')) ? '⚡ Agent' : '👤 Human'}
                          </span>
                          <StepBadge status={s.status} />
                        </div>
                      </div>
                      <p className={`text-[12px] text-[var(--muted)] leading-relaxed transition-all duration-300 ${expanded === i ? 'line-clamp-none opacity-100' : 'line-clamp-1 opacity-60 group-hover:opacity-100'}`}>
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
                            <p className="text-[13px] text-[var(--text)] opacity-80 leading-relaxed font-medium">{s.detail}</p>
                          </div>

                          {s.docs.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {s.docs.map((doc: string) => (
                                <div key={doc} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold text-[var(--muted)] hover:text-[var(--text)] transition-colors cursor-pointer bg-[var(--surface-2)] border border-[var(--border)]">
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
              ))}

              {/* Show More / Less / Upgrade */}
              {steps.length > 3 && (
                data?.subscription_status === 'active' ? (
                  <button
                    onClick={() => setShowAllSteps(!showAllSteps)}
                    className="w-full py-3 rounded-2xl border border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-2)] hover:bg-[var(--surface-2)] transition-all text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <ChevronDown size={16} className={`transition-transform duration-300 ${showAllSteps ? 'rotate-180' : ''}`} />
                    {showAllSteps ? `Show less` : `Show ${steps.length - 3} more steps`}
                  </button>
                ) : (
                  <Link href="/pricing" className="block">
                    <div className="w-full py-6 rounded-[28px] border-2 border-dashed border-indigo-500/30 bg-indigo-500/5 hover:bg-indigo-500/10 transition-all flex flex-col items-center justify-center gap-2 group cursor-pointer relative overflow-hidden">
                       <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-[shimmer_2s_infinite] pointer-events-none" />
                       <div className="flex items-center gap-2 text-indigo-600">
                          <Lock size={16} />
                          <span className="text-sm font-black uppercase tracking-widest">Premium Content</span>
                       </div>
                       <p className="text-xs text-[var(--muted)] font-bold text-center px-6">
                         Unlock {steps.length - 3} more specialized workflow steps and municipal protocols.
                       </p>
                       <div className="mt-2 text-xs font-black text-white bg-indigo-600 px-4 py-1.5 rounded-full shadow-lg group-hover:scale-105 transition-transform">
                          Upgrade to Premium
                       </div>
                    </div>
                  </Link>
                )
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
                  {(data?.execution_plan?.assigned_agents || ['Planner', 'Classifier']).map((name: string, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3.5 rounded-2xl transition-all hover:bg-[var(--surface-2)] glass-mesh mesh-purple shadow-sm">
                      <div className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0 text-purple-600 dark:text-purple-400 bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/20 shadow-sm">
                        <Cpu size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-bold text-[var(--text)]">{name}</p>
                        <p className="text-[11px] text-[var(--muted)] font-medium truncate">{t('dashboard_agent_status')}</p>
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
                        {t('dashboard_running')}
                      </span>
                    </div>
                  ))}
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
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)]">
      <Sidebar 
        currentSessionId={dashboardSessionId}
        assistantType="permit"
        showAllTypes
        onSessionSelect={(id, title) => {
          localStorage.setItem('permitops_active_session_id', id);
          router.push('/chat');
        }}
        onNewChat={() => {
          localStorage.removeItem('permitops_active_session_id');
          router.push('/chat');
        }}
        onSwitchAssistant={(type) => {
          localStorage.setItem('permitops_assistant_type', type);
          localStorage.removeItem('permitops_active_session_id');
          router.push('/chat');
        }}
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

