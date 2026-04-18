'use client';

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, User, Mic, Plus, ChevronDown, Building2, FileText, Search, Clock, HelpCircle, Scale, Menu, GraduationCap, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import LoadingScreen from '../components/LoadingScreen';

type Role = 'assistant' | 'user';
interface Msg { id: number; role: Role; content: string; }

export default function ChatPage() {
  const { t, isRTL, language, translateHistory } = useLanguage();
  const { token, isAuthenticated, user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string>('');
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [allSessions, setAllSessions] = useState<any[]>([]);

  const [assistantType, setAssistantType] = useState<'permit' | 'student' | 'lawyer'>('permit');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const QUICK_Q = [
    t('chat_q1'),
    t('chat_q2'),
    t('chat_q3'),
    t('chat_q4'),
  ];
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgIdRef = useRef(1);

  // Load sessions on mount or when auth changes
  useEffect(() => {
    let mounted = true;
    const initSession = async () => {
      // Check for forced type from dashboard/sidebar
      const forcedType = localStorage.getItem('permitops_assistant_type') as 'permit' | 'student' | 'lawyer' | null;
      if (forcedType) {
        setAssistantType(forcedType);
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/sessions?token=${token}`);
          if (res?.ok) {
            const data = await res.json();
            if (!mounted) return;
            setAllSessions(data);

            // Read what Dashboard requested (if any)
            const forcedSessionId = localStorage.getItem('permitops_ask_step_session');
            if (forcedSessionId) {
              localStorage.removeItem('permitops_ask_step_session');
              const fSession = data.find((s: any) => s.id === forcedSessionId);
              setSessionId(forcedSessionId);
              setSessionTitle(fSession ? (fSession.title || '') : '');
              if (fSession && fSession.assistant_type) {
                setAssistantType(fSession.assistant_type);
              }
              return;
            }

            // Normal load: check if there's a stored active session
            const activeSessionId = localStorage.getItem('permitops_active_session_id');
            const activeSession = data.find((s: any) => s.id === activeSessionId);

            if (activeSession) {
              setSessionId(activeSession.id);
              setSessionTitle(activeSession.title || '');
              // Only override assistant type if no forced type exists
              if (!forcedType && activeSession.assistant_type) {
                setAssistantType(activeSession.assistant_type);
              }
            } else if (!activeSessionId && forcedType) {
              // Redirected from dashboard with a SPECIFIC agent but NO session
              handleNewChat();
            } else if (data.length > 0) {
              setSessionId(data[0].id);
              setSessionTitle(data[0].title || '');
              if (!forcedType && data[0].assistant_type) setAssistantType(data[0].assistant_type);
            } else {
              handleNewChat();
            }
          }
        } catch (e) {
          console.error("Failed to fetch sessions", e);
        }
      } else {
        // Ephemeral GUEST session — unique per visit but not saved in DB
        const existingGuestId = localStorage.getItem('permitops_active_session_id');
        if (existingGuestId && existingGuestId.length > 20) {
          setSessionId(existingGuestId);
        } else {
          const newId = `guest-${Math.random().toString(36).substring(2, 15)}`;
          setSessionId(newId);
          localStorage.setItem('permitops_active_session_id', newId);
        }
      }
    };
    initSession();
    return () => { mounted = false; };
  }, [token, isAuthenticated]);

  // Load messages from backend when sessionId changes
  useEffect(() => {
    const loadHistory = async () => {
      const startTime = Date.now();
      if (!sessionId) {
        // Small delay for smooth transition
        await new Promise(r => setTimeout(r, 500));
        setIsLoaded(true);
        return;
      }

      if (isAuthenticated && token) {
        try {
          const res = await apiFetch(`/chat/history/${sessionId}?token=${token}`);
          if (res?.ok) {
            const data = await res.json();
            setMsgs(data);
            if (data.length > 0) {
              msgIdRef.current = Math.max(...data.map((m: any) => m.id)) + 1;
            } else {
              msgIdRef.current = 1;
            }
          }
        } catch (e) {
          console.error("Failed to fetch history from backend", e);
        }
      } else if (sessionId === "default-session") {
        const saved = localStorage.getItem('permitops_chat_history');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed && Array.isArray(parsed) && parsed.length > 0) {
              setMsgs(parsed);
              msgIdRef.current = Math.max(...parsed.map((m: Msg) => m.id)) + 1;
            }
          } catch (e) {
            console.error("Failed to parse local chat history", e);
          }
        }
      }

      const endTime = Date.now();
      const elapsed = endTime - startTime;
      const remaining = Math.max(0, 500 - elapsed);
      if (remaining > 0) await new Promise(r => setTimeout(r, remaining));

      setIsLoaded(true);
    };
    loadHistory();
  }, [sessionId, token, isAuthenticated]);

  useEffect(() => {
    if (isLoaded && !isAuthenticated && sessionId === "default-session") {
      localStorage.setItem('permitops_chat_history', JSON.stringify(msgs));
    }
    if (sessionId) {
      localStorage.setItem('permitops_active_session_id', sessionId);
      // Use a specific key so Dashboard only updates when a session is set
      localStorage.setItem('permitops_workflow_update', Date.now().toString());
      window.dispatchEvent(new StorageEvent('storage', { key: 'permitops_workflow_update' }));
    }
  }, [msgs, isLoaded, isAuthenticated, sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  // Auto-send a question if navigated from "Ask AI about this step"
  useEffect(() => {
    if (!sessionId || !isLoaded) return;
    const pending = localStorage.getItem('permitops_ask_step');
    if (!pending) return;
    localStorage.removeItem('permitops_ask_step');
    // Small delay so the page settles first
    const timer = setTimeout(() => send(pending), 600);
    return () => clearTimeout(timer);
  }, [sessionId, isLoaded]);

  const handleNewChat = async (forceType?: string) => {
    const typeToUse = forceType || assistantType;
    if (isAuthenticated && token) {
      try {
        const res = await apiFetch(`/chat/sessions?token=${token}&assistant_type=${typeToUse}`, { method: 'POST' });
        if (res?.ok) {
          const data = await res.json();
          setAllSessions(prev => [data, ...prev]);
          setSessionId(data.id);
          setMsgs([]);
        }
      } catch (e) {
        console.error("Failed to create new session", e);
      }
    } else {
      // Ephemeral GUEST reset
      const newGuestId = `guest-${Math.random().toString(36).substring(2, 15)}`;
      setSessionId(newGuestId);
      localStorage.setItem('permitops_active_session_id', newGuestId);
      clearChat();
    }
  };

  const switchAssistant = (newType: 'permit' | 'student' | 'lawyer') => {
    setAssistantType(newType);
    setIsDropdownOpen(false);

    // Resume logic: find the most recent session belonging to the requested type
    const recentSession = allSessions.find(s => (s.assistant_type || 'permit') === newType);
    if (recentSession) {
      setSessionId(recentSession.id);
      setSessionTitle(recentSession.title || '');
    } else {
      handleNewChat(newType);
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!token) return;
    try {
      const res = await apiFetch(`/chat/history/${id}?token=${token}`, { method: 'DELETE' });
      if (res?.ok) {
        setAllSessions(prev => prev.filter((s: any) => s.id !== id));
        if (sessionId === id) setSessionId(null);
        else setSessionId(prev => prev);
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  };

  const send = async (text?: string) => {
    const q = (text ?? input).trim();
    if ((!q && !file) || busy || !sessionId) return;
    setInput('');

    const displayQ = file ? `📎 [Attached: ${file.name}]\n${q}` : q;
    const userMsg: Msg = { id: msgIdRef.current++, role: 'user', content: displayQ };
    setMsgs(p => [...p, userMsg]);
    setBusy(true);
    if (!sessionTitle && msgs.length === 0) {
      setSessionTitle(q.length > 35 ? q.slice(0, 32) + '...' : q || "Document Analysis");
    }

    const currentFile = file;
    setFile(null);

    try {
      let body;
      let headers: HeadersInit = {};

      if (currentFile) {
        const formData = new FormData();
        formData.append('query', q);
        formData.append('language', language);
        formData.append('session_id', sessionId);
        if (token) formData.append('token', token);
        formData.append('file', currentFile);
        formData.append('assistant_type', assistantType);
        body = formData;
        // Browser sets Content-Type multipart/form-data boundary automatically
      } else {
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({ query: q, language, context: { session_id: sessionId }, assistant_type: assistantType });
      }

      const res = await apiFetch(`/agent/query${token ? `?token=${token}` : ''}`, {
        method: 'POST',
        headers,
        body,
      });
      if (!res || !res.ok) throw new Error();
      const data = await res.json();

      if (data.source) {
        console.log(`%c[Data Source] %c${data.source}`, "color: #ef4444; font-weight: bold;", "color: #3b82f6; font-weight: bold;");
      }

      if (data.session_title && data.session_title !== sessionTitle) {
        setSessionTitle(data.session_title);
        setSidebarRefresh(prev => prev + 1);
      }

      const rawContent: string = data.content ?? data.answer ?? data.response ?? 'Done.';

      // Detect topic-switch redirect signal
      if (rawContent.startsWith('REDIRECT_NEW_CHAT:')) {
        const displayMsg = rawContent.replace('REDIRECT_NEW_CHAT:', '').trim();
        setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: displayMsg }]);
        setBusy(false);
        // Auto-navigate to a new chat after 2 seconds
        setTimeout(async () => {
          await handleNewChat();
          setMsgs([]);
        }, 2000);
        return;
      }

      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: rawContent }]);
    } catch {
      setMsgs(p => [...p, { id: msgIdRef.current++, role: 'assistant', content: "⚠️ Backend is currently offline. Please make sure the server is running." }]);
    } finally {
      setBusy(false);
    }
  };

  const clearChat = async () => {
    if (isAuthenticated && token && sessionId) {
      try {
        await fetch(`http://localhost:8003/chat/history/${sessionId}?token=${token}`, { method: 'DELETE' });
        setSessionId(null);
      } catch (e) {
        console.error("Failed to clear history on backend", e);
      }
    } else {
      localStorage.removeItem('permitops_chat_history');
      setMsgs([]);
      msgIdRef.current = 1;
    }
  };

  const isEmpty = msgs.length === 0;

  if (!isLoaded) return <LoadingScreen />;

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)] transition-colors duration-500">
      {/* Dynamic Background — uses CSS vars so it auto-adapts to dark mode */}
      <div className="absolute inset-0 bg-[var(--bg)] pointer-events-none transition-colors duration-500" />
      <Sidebar
        currentSessionId={sessionId}
        assistantType={assistantType}
        onSessionSelect={(id, title) => { setSessionId(id); setSessionTitle(title); }}
        onNewChat={() => handleNewChat()}
        onDeleteSession={handleDeleteSession}
        token={token}
        onSwitchAssistant={switchAssistant}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
        refreshTrigger={sidebarRefresh}
      />

      <main className={`flex-1 flex flex-col min-w-0 transition-colors duration-300 relative border-[var(--border)] ${isRTL ? 'border-r' : 'border-l'}`}>
        {/* Desktop Navbar with Agent Selector */}
        <div className="hidden md:block">
          <Navbar
            isAppPage
            extraContent={
              <div className="relative" ref={dropdownRef}>
                  <div
                    className={`flex items-center gap-2.5 cursor-pointer px-4 py-2 rounded-full transition-all border glass-mesh shadow-lg group hover:scale-[1.02] active:scale-95 ${
                      assistantType === 'student' ? 'border-emerald-500/20 mesh-green shadow-emerald-500/10' : 
                      assistantType === 'lawyer' ? 'border-amber-500/20 mesh-amber shadow-amber-500/10' : 
                      'border-blue-500/20 mesh-blue shadow-blue-500/10'
                    }`}
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  >
                    <div className="relative flex items-center justify-center">
                      <Cpu size={15} className={`animate-[pulse_1.5s_easeInOut_infinite] relative z-10 ${
                        assistantType === 'student' ? 'text-emerald-500' : 
                        assistantType === 'lawyer' ? 'text-amber-500' : 
                        'text-blue-500'
                      }`} />
                      <div className={`absolute inset-0 blur-md rounded-full animate-pulse ${
                        assistantType === 'student' ? 'bg-emerald-500/30' : 
                        assistantType === 'lawyer' ? 'bg-amber-500/30' : 
                        'bg-blue-500/30'
                      }`} />
                    </div>
                    <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${
                      assistantType === 'student' ? 'text-emerald-500' : 
                      assistantType === 'lawyer' ? 'text-amber-500' : 
                      'text-blue-500'
                    }`}>
                      {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
                    </span>
                    <ChevronDown size={12} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''} ${
                      assistantType === 'student' ? 'text-emerald-400 group-hover:text-emerald-500' : 
                      assistantType === 'lawyer' ? 'text-amber-400 group-hover:text-amber-500' : 
                      'text-blue-400 group-hover:text-blue-500'
                    }`} />
                  </div>

                <AnimatePresence mode="wait">
                  {isDropdownOpen && (
                    <motion.div
                      key="desktop-dropdown"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 bg-[var(--surface)]/90 border border-white/10 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.3)] z-[100] overflow-hidden backdrop-blur-2xl"
                    >
                      <div className="p-2 space-y-1">
                        <div className="px-3 py-1.5 mb-2 text-[10px] font-bold text-[var(--muted)] opacity-50 uppercase tracking-widest border-b border-white/5">
                          Switch Assistant
                        </div>
                        <button
                          onClick={() => switchAssistant('permit')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'permit' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${
                            assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20'
                          }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500'}`} />
                            {assistantType === 'permit' && <div className="absolute inset-0 bg-blue-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_permit')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('student')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'student' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${
                            assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20'
                          }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500'}`} />
                            {assistantType === 'student' && <div className="absolute inset-0 bg-emerald-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_student')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('lawyer')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${assistantType === 'lawyer' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)] border border-transparent'}`}
                        >
                          <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-500 overflow-hidden border ${
                            assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20'
                          }`}>
                            <Cpu size={16} className={`relative z-10 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500'}`} />
                            {assistantType === 'lawyer' && <div className="absolute inset-0 bg-amber-400 opacity-40 blur-md animate-pulse" />}
                          </div>
                          <span className="text-[13px] font-bold tracking-tight">{t('assistant_lawyer')}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </div>

        {/* Mobile Top Bar — Ultra-clean agent selection overlay */}
        <div className="flex md:hidden items-center justify-between px-5 h-16 shrink-0 bg-[var(--bg)]/80 backdrop-blur-xl border-b border-white/5 z-[60]">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-[var(--text)] active:scale-95 transition-all"
          >
            <Menu size={20} />
          </button>
          
          <div 
            className="flex flex-col items-center justify-center cursor-pointer group"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full border active:scale-95 transition-all ${
              assistantType === 'student' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' : 
              assistantType === 'lawyer' ? 'bg-amber-500/10 border-amber-500/20 text-amber-500' : 
              'bg-blue-500/10 border-blue-500/20 text-blue-500'
            }`}>
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
              </span>
              <ChevronDown size={10} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            {isEmpty && (
              <span className="text-[13px] font-bold text-[var(--text)]/40 mt-0.5 tracking-tight">
                {t('chat_new')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {user ? (
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[13px] font-bold shadow-lg shadow-indigo-500/20">
                {(user.fullName || user.email || 'U')[0].toUpperCase()}
              </div>
            ) : (
              <Link href="/login" className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors">
                <User size={16} className="text-[var(--text)]" />
              </Link>
            )}
          </div>
        </div>

        <div className="hidden md:block h-4 shrink-0" />

        {/* Gemini-Style Content Header - Desktop only */}
        <div className="hidden md:flex flex-col items-center justify-center pt-2 pb-4 shrink-0 z-30 relative">
          <span className="text-2xl font-bold text-[var(--text)] opacity-95 tracking-tight leading-none">
            {(() => {
              if (!sessionTitle || msgs.length === 0 || sessionTitle === t('chat_new')) return t('chat_new');
              const match = sessionTitle.toLowerCase().match(/^(.+?)\s+in\s+(.+)$/);
              if (match) {
                const bizKey = `biz_${match[1].trim()}`;
                const distKey = `dist_${match[2].trim().replace(/\s/g, '').toLowerCase()}`;
                const lb = t(bizKey), ld = t(distKey);
                if (lb !== bizKey && ld !== distKey) return `${lb} ${t('connect_in')} ${ld}`;
              }
              return sessionTitle;
            })()}
          </span>
        </div>

        {/* Agent Selection Dropdown — renders on both mobile & desktop */}
        <AnimatePresence mode="wait">
          {isDropdownOpen && (
            <motion.div key="mobile-dropdown-wrapper">
              {/* Backdrop Blur */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/40 backdrop-blur-md z-[90]"
                onClick={() => setIsDropdownOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.05, y: 20 }}
                className="fixed top-24 md:top-32 left-1/2 -translate-x-1/2 bg-[var(--surface-1)]/98 border border-white/10 rounded-[40px] md:rounded-[48px] shadow-[0_40px_100px_rgba(0,0,0,0.7)] p-4 md:p-6 w-[90vw] max-w-[440px] z-[100] flex flex-col gap-3 md:gap-4 overflow-hidden backdrop-blur-3xl"
              >
                <div className="px-5 py-2.5 border-b border-white/5 mb-2 text-center font-black uppercase tracking-[0.2em] text-[12px] text-[var(--text)] opacity-40">
                  {t('chat_switch_assistant')}
                </div>

                <div className="flex flex-col gap-2.5 md:gap-3 px-2">
                  <button
                    onClick={() => switchAssistant('permit')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'permit' ? 'bg-blue-500/10 border border-blue-500/30 shadow-[0_8px_30px_rgba(59,130,246,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-blue-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${
                      assistantType === 'permit' ? 'bg-blue-500 border-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.4)]' : 'bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500 group-hover:border-blue-400'
                    }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'permit' ? 'text-white' : 'text-blue-500 group-hover:text-white'}`} />
                      {(assistantType === 'permit' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'permit' ? 'bg-blue-400' : 'bg-blue-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_permit')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_permit_desc')}</span>
                    </div>
                    {assistantType === 'permit' && <div className="ml-auto w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'student' ? 'bg-emerald-500/10 border border-emerald-500/30 shadow-[0_8px_30px_rgba(16,185,129,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-emerald-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${
                      assistantType === 'student' ? 'bg-emerald-500 border-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]' : 'bg-emerald-500/10 border-emerald-500/20 group-hover:bg-emerald-500 group-hover:border-emerald-400'
                    }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'student' ? 'text-white' : 'text-emerald-500 group-hover:text-white'}`} />
                      {(assistantType === 'student' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'student' ? 'bg-emerald-400' : 'bg-emerald-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_student')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className="ml-auto w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    className={`flex items-center gap-4 p-4 w-full rounded-2xl transition-all duration-300 group ${assistantType === 'lawyer' ? 'bg-amber-500/10 border border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.15)] scale-[1.02]' : 'bg-[var(--surface-2)] border border-[var(--border)] hover:border-amber-400 opacity-90 hover:opacity-100 shadow-sm'}`}
                  >
                    <div className={`relative w-11 h-11 rounded-[14px] flex items-center justify-center transition-all duration-500 overflow-hidden shrink-0 border ${
                      assistantType === 'lawyer' ? 'bg-amber-500 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.4)]' : 'bg-amber-500/10 border-amber-500/20 group-hover:bg-amber-500 group-hover:border-amber-400'
                    }`}>
                      <Cpu size={22} className={`relative z-10 transition-colors duration-300 ${assistantType === 'lawyer' ? 'text-white' : 'text-amber-500 group-hover:text-white'}`} />
                      {(assistantType === 'lawyer' || true) && <div className={`absolute inset-0 opacity-40 blur-xl animate-pulse transition-opacity duration-500 ${assistantType === 'lawyer' ? 'bg-amber-400' : 'bg-amber-400 opacity-0 group-hover:opacity-40'}`} />}
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[15px] font-bold tracking-tight text-[var(--text)]">{t('assistant_lawyer')} {t('agent_badge')}</span>
                      <span className="text-[11px] font-medium text-[var(--muted)] opacity-60">{t('chat_lawyer_desc')}</span>
                    </div>
                    {assistantType === 'lawyer' && <div className="ml-auto w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_#f59e0b]" />}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">

          {isEmpty ? (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-5 md:px-6 overflow-y-auto no-scrollbar">
              {/* Welcome Message — Cinematic AI Entrance */}
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 0.8 }}
                className="flex flex-col items-center justify-center text-center px-4 pt-8 md:pt-16 mb-8 md:mb-12"
              >
                <div className="relative mb-12 md:mb-20">
                  {/* Holographic scanning grid area */}
                  <div className="absolute inset-[-60px] rounded-full overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute inset-0" style={{ 
                      backgroundImage: `radial-gradient(circle, ${
                        assistantType === 'student' ? 'rgba(16,185,129,0.4)' :
                        assistantType === 'lawyer' ? 'rgba(245,158,11,0.4)' :
                        'rgba(59,130,246,0.4)'
                      } 1px, transparent 1px)`, 
                      backgroundSize: '16px 16px' 
                    }} />
                  </div>

                  {/* Primary holographic ring */}
                  <motion.div
                    animate={{
                      rotate: 360,
                      scale: [1, 1.05, 1],
                    }}
                    transition={{
                      rotate: { duration: 12, repeat: Infinity, ease: "linear" },
                      scale: { duration: 4, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-15px] md:inset-[-25px] rounded-[35%] border-[1.5px] border-dashed border-red-500/40 blur-[1px]"
                  />

                  {/* Counter-rotating technical ring */}
                  <motion.div
                    animate={{
                      rotate: -360,
                      scale: [1.1, 1, 1.1],
                    }}
                    transition={{
                      rotate: { duration: 18, repeat: Infinity, ease: "linear" },
                      scale: { duration: 5, repeat: Infinity, ease: "easeInOut" }
                    }}
                    className="absolute inset-[-25px] md:inset-[-40px] rounded-full border-t border-b border-red-500/20"
                  />

                  {/* Floating technical particles (Orbital Swarm) */}
                  {[...Array(12)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{
                        x: [
                          Math.cos(i * 30) * 50, 
                          Math.cos(i * 30 + 120) * 70, 
                          Math.cos(i * 30 + 240) * 50, 
                          Math.cos(i * 30) * 50
                        ],
                        y: [
                          Math.sin(i * 30) * 50, 
                          Math.sin(i * 30 + 120) * 70, 
                          Math.sin(i * 30 + 240) * 50, 
                          Math.sin(i * 30) * 50
                        ],
                        opacity: [0, 0.7, 0.3, 0.7, 0],
                        scale: [0, 1.2, 0.8, 1.2, 0]
                      }}
                      transition={{
                        duration: 5 + Math.random() * 8,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                      className={`absolute rounded-full blur-[0.4px] pointer-events-none ${
                        i % 4 === 0 ? 'bg-white w-0.5 h-0.5' : 
                        assistantType === 'student' ? 'bg-emerald-400/60 w-1 h-1 shadow-[0_0_5px_rgba(16,185,129,0.5)]' :
                        assistantType === 'lawyer' ? 'bg-amber-400/60 w-1 h-1 shadow-[0_0_5px_rgba(245,158,11,0.5)]' :
                        'bg-blue-400/60 w-1 h-1 shadow-[0_0_5px_rgba(59,130,246,0.5)]'
                      }`}
                    />
                  ))}

                  {/* Outer breathing aura */}
                  <motion.div
                    animate={{
                      scale: [1, 1.5, 1],
                      opacity: [0.3, 0.6, 0.3]
                    }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                    className={`absolute inset-[-60px] rounded-full blur-[80px] ${
                      assistantType === 'student' ? 'bg-emerald-600/10' :
                      assistantType === 'lawyer' ? 'bg-amber-600/10' :
                      'bg-blue-600/10'
                    }`}
                  />

                {isEmpty ? (
                  <div className="flex-1 flex flex-col items-center justify-center w-full max-w-5xl mx-auto px-4 py-20">
                    {/* Chat Welcome Title */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center mb-10"
              >
                <h2 className="text-4xl md:text-5xl font-black text-[var(--text)] tracking-tight mb-2">
                  {t('chat_welcome_title')}
                </h2>
              </motion.div>

              {/* Chat Input Pill (empty state) */}
              <div className="w-full max-w-3xl mx-auto mb-12 relative">
                {/* File Preview Chip - Floating above */}
                <AnimatePresence>
                  {file && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute -top-14 left-4 flex items-center z-50"
                    >
                      <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-full pl-3 pr-2 py-1.5 text-[13px] text-[var(--text)] shadow-lg backdrop-blur-xl">
                        <FileText size={14} className="text-indigo-400" />
                        <span className="truncate max-w-[200px] font-medium">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/10 text-[var(--muted)] hover:text-red-500 transition-colors">
                          <Plus size={14} className="rotate-45" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className={`relative flex items-center gap-2 rounded-full p-2 border border-[var(--border)] transition-all duration-300 bg-[var(--surface-1)] shadow-[0_15px_50px_rgba(0,0,0,0.1)] ${isRTL ? 'flex-row-reverse pl-2 pr-4' : 'pl-4 pr-2'} ${busy ? 'opacity-70' : 'hover:border-indigo-500/50 focus-within:border-indigo-500/50 focus-within:shadow-[0_8px_36px_rgba(0,0,0,0.15)]'}`}>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      if (e.target.files?.[0]) setFile(e.target.files[0]);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 p-2 text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-all"
                    title="Upload Document"
                  >
                    <Plus size={22} />
                  </button>

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                        if (inputRef.current) inputRef.current.style.height = 'auto';
                      }
                    }}
                    disabled={busy}
                    placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything..."}
                    className={`flex-1 max-h-[200px] min-h-[44px] py-2.5 bg-transparent text-[16px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none resize-none overflow-y-auto slim-scroll leading-relaxed ${isRTL ? 'text-right' : 'text-left'}`}
                    rows={1}
                  />

                  <div className={`flex items-center gap-1 shrink-0 ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}>
                    <button className="p-2.5 rounded-full text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-all">
                      <Mic size={20} />
                    </button>
                    
                    {input.trim() ? (
                      <button
                        onClick={() => {
                          send();
                          if (inputRef.current) inputRef.current.style.height = 'auto';
                        }}
                        disabled={busy}
                        className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg transition-all active:scale-95"
                      >
                        <Send size={18} />
                      </button>
                    ) : (
                      <div className={`flex items-center gap-1.5 p-1 bg-[var(--surface-2)] rounded-full border border-[var(--border)] px-2.5 cursor-pointer hover:bg-[var(--surface)] transition-all ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}>
                         <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                         <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-tight">{t('chat_speed_fast')}</span>
                         <ChevronDown size={10} className="text-[var(--muted)]" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

          ) : (
            <div className={`flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-12 pb-44 slim-scroll bg-[var(--bg)]/40 rounded-t-[40px]`} dir={isRTL ? 'rtl' : 'ltr'}>
              <AnimatePresence initial={false}>
                {msgs.map(m => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className={`h-9 w-9 rounded-xl bg-gradient-to-br flex items-center justify-center text-white shrink-0 mt-1 shadow-md border ${
                        assistantType === 'student' ? 'from-emerald-500 to-emerald-600 shadow-emerald-500/30 border-emerald-400/30' :
                        assistantType === 'lawyer' ? 'from-amber-500 to-amber-600 shadow-amber-500/30 border-amber-400/30' :
                        'from-blue-500 to-blue-600 shadow-blue-500/30 border-blue-400/30'
                      } ${isRTL ? 'ml-4' : 'mr-4'}`}>
                        <Cpu size={18} />
                      </div>
                    )}

                    <div className={`flex flex-col max-w-[92%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[17px] leading-[1.8] whitespace-pre-wrap ${m.role === 'user'
                        ? 'px-6 py-4 rounded-3xl border border-[var(--border)] text-[var(--text)] bg-[var(--surface-1)] shadow-sm'
                        : `text-[var(--text)] px-6 py-4 rounded-3xl bg-[var(--surface-2)]/60 dark:bg-transparent border border-[var(--border)] dark:border-transparent md:border-none md:bg-transparent w-full font-normal`
                        }`}
                      >
                        {(() => {
                          const contentToRender = translateHistory(m.content);

                          if (m.role === 'assistant') {
                            // Support for custom [CTA: Label | URL] buttons
                            const parts = contentToRender.split(/(\[CTA: .+? \| .+?\])/g);
                            
                            return (
                              <div className={`prose dark:prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
                                {parts.map((part, idx) => {
                                  const ctaMatch = part.match(/\[CTA: (.+?) \| (.+?)\]/);
                                  if (ctaMatch) {
                                    const [, label, url] = ctaMatch;
                                    return (
                                      <motion.div 
                                        key={idx}
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="my-6"
                                      >
                                        <Link 
                                          href={url} 
                                          target="_blank"
                                          className="inline-flex items-center gap-2 bg-[var(--surface-2)] hover:bg-[#3c4043] text-[var(--text)] px-8 py-3 rounded-full font-bold transition-all shadow-lg active:scale-95 border border-[var(--border)] group no-underline"
                                        >
                                          <span>{label}</span>
                                          <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                                        </Link>
                                      </motion.div>
                                    );
                                  }
                                  
                                  return (
                                    <ReactMarkdown
                                      key={idx}
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        p: ({ node, ...props }) => <p className="mb-6 last:mb-0" {...props} />,
                                        ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-6 space-y-2 marker:text-red-500" {...props} />,
                                        ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-6 space-y-2 marker:text-red-500" {...props} />,
                                        strong: ({ node, ...props }) => <strong className="font-bold text-[var(--text)]" {...props} />,
                                        a: ({ node, ...props }) => <a className="text-red-400 hover:underline transition-colors" {...props} />,
                                        code: ({ node, className, children, ...props }) => {
                                          const match = /language-(\w+)/.exec(className || '');
                                          const isInline = !match && !className?.includes('language-');
                                          return isInline
                                            ? <code className="bg-[var(--surface-2)] text-red-300 px-1.5 py-0.5 rounded text-[14px] font-mono" {...props}>{children}</code>
                                            : <div className="bg-[#0e0e0e] rounded-xl border border-white/10 overflow-hidden my-6"><div className="px-4 py-2 bg-white/5 text-[11px] text-white/40 font-mono uppercase tracking-widest border-b border-white/10">{match?.[1] || 'code'}</div><pre className="p-4 overflow-x-auto text-[14px] text-gray-300 font-mono leading-relaxed"><code {...props}>{children}</code></pre></div>
                                        }
                                      }}
                                    >
                                      {part}
                                    </ReactMarkdown>
                                  );
                                })}
                              </div>
                            );
                          }
                          return contentToRender;
                        })()}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {busy && (
                <motion.div
                  initial={{ opacity: 0, x: isRTL ? 10 : -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex w-full items-center justify-start py-4 ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`relative h-10 w-10 flex items-center justify-center shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing status ring */}
                    <div className={`absolute inset-0 rounded-xl border backdrop-blur-sm ${
                      assistantType === 'student' ? 'border-emerald-500/20 bg-emerald-500/5' :
                      assistantType === 'lawyer' ? 'border-amber-500/20 bg-amber-500/5' :
                      'border-blue-500/20 bg-blue-500/5'
                    }`} />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className={`absolute inset-[-2px] rounded-xl border-t ${
                        assistantType === 'student' ? 'border-emerald-500/60' :
                        assistantType === 'lawyer' ? 'border-amber-500/60' :
                        'border-blue-500/60'
                      }`}
                    />
                    <Cpu size={18} className={`${
                      assistantType === 'student' ? 'text-emerald-500' :
                      assistantType === 'lawyer' ? 'text-amber-500' :
                      'text-blue-500'
                    } animate-pulse relative z-10`} />

                    {/* Live processing blip */}
                    <motion.div
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className={`absolute -top-0.5 ${isRTL ? '-left-0.5' : '-right-0.5'} w-1.5 h-1.5 rounded-full z-20 ${
                        assistantType === 'student' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,1)]' :
                        assistantType === 'lawyer' ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,1)]' :
                        'bg-blue-400 shadow-[0_0_8px_rgba(59,130,246,1)]'
                      }`}
                    />
                  </div>
                  <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'}`}>
                    <span className={`text-[14px] font-medium animate-pulse ${
                      assistantType === 'student' ? 'text-emerald-500/80' :
                      assistantType === 'lawyer' ? 'text-amber-500/80' :
                      'text-blue-500/80'
                    }`}>
                      {t('agent_thinking')}
                    </span>
                  </div>
                </motion.div>
              )}
              <div ref={bottomRef} className="h-4" />
            </div>
          )}

          {/* Sticky Input Bar - Floating Gemini Pill */}
          {!isEmpty && (
            <div className="absolute bottom-0 left-0 w-full pt-16 pb-8 px-4 flex justify-center bg-gradient-to-t from-[var(--bg)] via-[var(--bg)]/90 to-transparent z-40">
              <div className="w-full max-w-4xl relative">
                <div className={`relative flex flex-col transition-all duration-300 z-40`}>
                  {/* File Preview Chip - Floating above */}
                  <AnimatePresence>
                    {file && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute -top-14 left-4 flex items-center"
                      >
                        <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-full pl-3 pr-2 py-1.5 text-[13px] text-[var(--text)] shadow-lg backdrop-blur-xl">
                          <FileText size={14} className="text-indigo-400" />
                          <span className="truncate max-w-[200px] font-medium">{file.name}</span>
                          <button onClick={() => setFile(null)} className="ml-1 w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500/10 text-[var(--muted)] hover:text-red-500 transition-colors">
                            <Plus size={14} className="rotate-45" />
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div className={`relative flex items-center gap-2 rounded-full p-2 border border-[var(--border)] transition-all duration-300 bg-[var(--surface-1)] shadow-[0_8px_32px_rgba(0,0,0,0.15)] ${isRTL ? 'flex-row-reverse pl-2 pr-4' : 'pl-4 pr-2'} ${busy ? 'opacity-70' : 'hover:border-indigo-500/50 focus-within:border-indigo-500/50 focus-within:shadow-[0_8px_36px_rgba(0,0,0,0.2)]'}`}>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        if (e.target.files?.[0]) setFile(e.target.files[0]);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="shrink-0 p-2 text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-all"
                      title="Upload Document"
                    >
                      <Plus size={22} />
                    </button>

                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => {
                        setInput(e.target.value);
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send();
                          if (inputRef.current) inputRef.current.style.height = 'auto';
                        }
                      }}
                      disabled={busy}
                      placeholder={t(`chat_placeholder_${assistantType}`) || "Ask anything..."}
                      className={`flex-1 max-h-[200px] min-h-[44px] py-2.5 bg-transparent text-[16px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none resize-none overflow-y-auto slim-scroll leading-relaxed ${isRTL ? 'text-right' : 'text-left'}`}
                      rows={1}
                    />

                    <div className={`flex items-center gap-1 shrink-0 ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}>
                      <button className="p-2.5 rounded-full text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-all">
                        <Mic size={20} />
                      </button>
                      
                      {input.trim() ? (
                        <button
                          onClick={() => {
                            send();
                            if (inputRef.current) inputRef.current.style.height = 'auto';
                          }}
                          disabled={busy}
                          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg transition-all active:scale-95"
                        >
                          <Send size={18} />
                        </button>
                      ) : (
                        <div className={`flex items-center gap-1.5 p-1 bg-[var(--surface-2)] rounded-full border border-[var(--border)] px-2.5 cursor-pointer hover:bg-[var(--surface)] transition-all ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}>
                           <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                           <span className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-tight">{t('chat_speed_fast')}</span>
                           <ChevronDown size={10} className="text-[var(--muted)]" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-center text-[11px] text-[var(--muted)] mt-5 font-normal tracking-wide opacity-50">
                  {t('agent_name')} • {t('footer_version')}
                </p>
              </div>
            </div>
          )}

        </div>

        <style dangerouslySetInnerHTML={{
          __html: `
          .slim-scroll::-webkit-scrollbar { width: 6px; }
          .slim-scroll::-webkit-scrollbar-track { background: transparent; }
          .slim-scroll::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
          .slim-scroll::-webkit-scrollbar-thumb:hover { background: var(--border); }
        `}} />
      </main>
    </div>
  );
}
