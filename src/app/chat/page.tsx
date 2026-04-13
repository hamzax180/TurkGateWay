'use client';

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
        setSessionId("default-session");
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
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-gradient-to-tr from-white via-[#f0f7ff] to-[#f5f3ff] dark:deep-mesh transition-colors duration-500">
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

      <main className="flex-1 flex flex-col min-w-0 transition-colors duration-300 relative">
        {/* Desktop Navbar with Agent Selector */}
        <div className="hidden md:block">
          <Navbar
            isAppPage
            extraContent={
              <div className="relative" ref={dropdownRef}>
                <div
                  className="flex items-center gap-2.5 cursor-pointer px-4 py-2 rounded-full transition-all border border-red-500/20 glass-mesh mesh-red shadow-[0_4px_15px_rgba(239,68,68,0.1)] group hover:scale-[1.02] active:scale-95"
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                >
                  <div className="relative flex items-center justify-center">
                    <Cpu size={15} className="text-red-500 animate-[pulse_1.5s_easeInOut_infinite] relative z-10" />
                    <div className="absolute inset-0 bg-red-500/30 blur-md rounded-full animate-pulse" />
                  </div>
                  <span className="text-[12px] font-black uppercase tracking-[0.15em] text-red-500 dark:text-red-400">
                    {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} Agent
                  </span>
                  <ChevronDown size={12} className={`text-red-400 group-hover:text-red-500 transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </div>

                <AnimatePresence>
                  {isDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      className="absolute top-full left-1/2 -translate-x-1/2 mt-3 w-60 bg-[var(--surface)]/90 border border-white/10 rounded-2xl shadow-[0_15px_50px_rgba(0,0,0,0.3)] z-[100] overflow-hidden backdrop-blur-2xl"
                    >
                      <div className="p-2 space-y-1">
                        <div className="px-3 py-1.5 mb-2 text-[10px] font-bold text-red-500/70 uppercase tracking-widest border-b border-white/5">
                          Switch Assistant
                        </div>
                        <button
                          onClick={() => switchAssistant('permit')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${assistantType === 'permit' ? 'bg-red-500/10 text-red-500' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)]'}`}
                        >
                          <Building2 size={18} className={assistantType === 'permit' ? 'text-red-500' : ''} />
                          <span className="text-xs font-black uppercase tracking-wider">{t('assistant_permit')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('student')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${assistantType === 'student' ? 'bg-red-500/10 text-red-500' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)]'}`}
                        >
                          <GraduationCap size={18} className={assistantType === 'student' ? 'text-red-500' : ''} />
                          <span className="text-xs font-black uppercase tracking-wider">{t('assistant_student')}</span>
                        </button>
                        <button
                          onClick={() => switchAssistant('lawyer')}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${assistantType === 'lawyer' ? 'bg-red-500/10 text-red-500' : 'hover:bg-white/5 text-[var(--muted)] hover:text-[var(--text)]'}`}
                        >
                          <Scale size={18} className={assistantType === 'lawyer' ? 'text-red-500' : ''} />
                          <span className="text-xs font-black uppercase tracking-wider">{t('assistant_lawyer')}</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            }
          />
        </div>

        {/* Mobile Top Bar — Agent selection replaces static title */}
        <div className="flex md:hidden items-center justify-between px-4 h-20 shrink-0 border-b border-[var(--border)] bg-[var(--bg)] z-30">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors"
          >
            <Menu size={22} />
          </button>
          <div className="flex flex-col items-center justify-center py-2 h-auto">
            <div
              className="flex items-center gap-2 cursor-pointer hover:bg-red-500/10 px-4 py-1.5 rounded-full transition-all border border-red-500/20 bg-red-500/5 mb-2"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span className="text-[13px] font-extrabold uppercase tracking-widest text-red-500">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} {t('agent_badge')}
              </span>
              <ChevronDown size={11} className={`text-red-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            <span className="text-[16px] font-bold text-[var(--text)] tracking-tight leading-none truncate max-w-[200px]">
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
        <AnimatePresence>
          {isDropdownOpen && (
            <>
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

                <div className="flex flex-col gap-2.5 md:gap-3">
                  <button
                    onClick={() => switchAssistant('permit')}
                    className={`flex items-center gap-4 px-5 py-3.5 w-full rounded-[24px] transition-all duration-300 group ${assistantType === 'permit' ? 'bg-red-500/10 text-[var(--text)] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent'}`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                      <Building2 size={22} className="text-red-500" />
                    </div>
                    <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'} overflow-hidden`}>
                      <span className="text-[16px] font-bold tracking-tight">{t('assistant_permit')}</span>
                      <span className="text-[12px] opacity-60 truncate max-w-[220px]">{t('chat_permit_desc')}</span>
                    </div>
                    {assistantType === 'permit' && <div className={`${isRTL ? 'mr-auto' : 'ml-auto'} w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]`} />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 px-5 py-3.5 w-full rounded-[24px] transition-all duration-300 group ${assistantType === 'student' ? 'bg-red-500/10 text-[var(--text)] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent'}`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                      <GraduationCap size={22} className="text-red-500" />
                    </div>
                    <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'} overflow-hidden`}>
                      <span className="text-[16px] font-bold tracking-tight">{t('assistant_student')}</span>
                      <span className="text-[12px] opacity-60 truncate max-w-[220px]">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className={`${isRTL ? 'mr-auto' : 'ml-auto'} w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]`} />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    className={`flex items-center gap-4 px-5 py-3.5 w-full rounded-[24px] transition-all duration-300 group ${assistantType === 'lawyer' ? 'bg-red-500/10 text-[var(--text)] border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent'}`}
                  >
                    <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                      <Scale size={22} className="text-red-500" />
                    </div>
                    <div className={`flex flex-col ${isRTL ? 'text-right' : 'text-left'} overflow-hidden`}>
                      <span className="text-[16px] font-bold tracking-tight">{t('assistant_lawyer')}</span>
                      <span className="text-[12px] opacity-60 truncate max-w-[220px]">{t('chat_lawyer_desc')}</span>
                    </div>
                    {assistantType === 'lawyer' && <div className={`${isRTL ? 'mr-auto' : 'ml-auto'} w-2 h-2 rounded-full bg-red-500 shadow-[0_0_10px_#ef4444]`} />}
                  </button>
                </div>
              </motion.div>
            </>
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
                className="flex flex-col items-center justify-center text-center px-4 pt-2 md:pt-8 mb-4 md:mb-6"
              >
                <div className="relative mb-6 md:mb-12">
                  {/* Holographic scanning grid area */}
                  <div className="absolute inset-[-60px] rounded-full overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute inset-0" style={{ 
                      backgroundImage: 'radial-gradient(circle, rgba(239,68,68,0.4) 1px, transparent 1px)', 
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
                        i % 4 === 0 ? 'bg-white w-0.5 h-0.5' : 'bg-red-400/60 w-1 h-1 shadow-[0_0_5px_rgba(239,68,68,0.5)]'
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
                    className="absolute inset-[-60px] rounded-full bg-red-600/10 blur-[80px]"
                  />



                  {/* The Chip Unit */}
                  <motion.div
                    whileHover={{ 
                      scale: 1.05, 
                      rotateY: 10, 
                      rotateX: -10,
                      shadow: '0 0 70px rgba(239,68,68,0.7)'
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                    className="relative h-20 w-20 md:h-28 md:w-28 rounded-2xl md:rounded-3xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center shadow-[0_0_50px_rgba(239,68,68,0.5)] overflow-hidden border border-red-400/40"
                    style={{ perspective: '1000px', transformStyle: 'preserve-3d' }}
                  >
                    {/* Active Interior Scanning Bar */}
                    <motion.div
                      animate={{ y: ['-140%', '140%'] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-x-0 h-[3px] bg-white/30 blur-[1px] shadow-[0_0_15px_white] z-20"
                    />

                    <motion.div
                      animate={{
                        filter: ['drop-shadow(0 0 8px rgba(255,255,255,0.4))', 'drop-shadow(0 0 20px rgba(255,255,255,0.9))', 'drop-shadow(0 0 8px rgba(255,255,255,0.4))']
                      }}
                      style={{ transform: 'translateZ(20px)' }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Cpu size={isMobile ? 32 : 48} className="text-white" />
                    </motion.div>

                    {/* Scanning light streak */}
                    <motion.div
                      animate={{ skewX: [-20, -20], x: ['-200%', '200%'] }}
                      transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.5 }}
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-24"
                    />
                  </motion.div>
                </div>

                <div className="flex flex-col items-center gap-2 mb-4">
                  <motion.span
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="text-3xl md:text-7xl font-bold text-gradient-premium tracking-tighter py-1 md:py-2"
                  >
                    {t('chat_greeting').replace('{name}', user?.fullName || (user?.email ? user.email.split('@')[0] : 'there'))}
                  </motion.span>
                  <motion.h1
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="text-2xl md:text-5xl font-bold tracking-tight text-[var(--muted)] opacity-50"
                  >
                    {t('chat_begin')}
                  </motion.h1>
                </div>
              </motion.div>

              {/* Suggestion Chips — Gemini style: left-aligned simple pills on mobile, fancy chips on desktop */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                className="grid grid-cols-2 lg:flex lg:flex-row lg:flex-wrap lg:justify-center gap-2 md:gap-2.5 mt-4 md:mt-0 md:mb-8"
              >
                {(assistantType === 'student' ? [
                  { emoji: "🪪", label: t('chat_sug_renew'), mesh: 'mesh-red' },
                  { emoji: "🏛️", label: t('chat_sug_uni'), mesh: 'mesh-red' },
                  { emoji: "🗺️", label: t('chat_sug_roadmap'), mesh: 'mesh-red' },
                  { emoji: "📅", label: t('chat_sug_deadlines'), mesh: 'mesh-red' },
                  { emoji: "🛂", label: t('chat_sug_visas'), mesh: 'mesh-red' },
                  { emoji: "🆘", label: t('chat_sug_shelp'), mesh: 'mesh-red' }
                ] : assistantType === 'lawyer' ? [
                  { emoji: "📑", label: t('chat_sug_contract'), mesh: 'mesh-red' },
                  { emoji: "🏗️", label: t('chat_sug_formation'), mesh: 'mesh-red' },
                  { emoji: "🤝", label: t('chat_sug_employ'), mesh: 'mesh-red' },
                  { emoji: "📊", label: t('chat_sug_times'), mesh: 'mesh-red' },
                  { emoji: "🏠", label: t('chat_sug_resid'), mesh: 'mesh-red' },
                  { emoji: "⚖️", label: t('chat_sug_dispute'), mesh: 'mesh-red' }
                ] : [
                  { emoji: "🏢", label: t('chat_suggestion_business'), mesh: 'mesh-red' },
                  { emoji: "📜", label: t('chat_suggestion_permit'), mesh: 'mesh-red' },
                  { emoji: "📍", label: t('chat_suggestion_location'), mesh: 'mesh-red' },
                  { emoji: "⏳", label: t('chat_suggestion_duration'), mesh: 'mesh-red' },
                  { emoji: "💰", label: t('chat_suggestion_cost'), mesh: 'mesh-red' },
                  { emoji: "❓", label: t('chat_suggestion_help'), mesh: 'mesh-red' }
                ]).map((chip, i) => (
                  <div
                    key={i}
                    onClick={() => send(chip.label)}
                    className={`lg:glass-mesh lg:${chip.mesh} text-[var(--text)] text-[13px] md:text-[16px] py-2.5 md:py-4 px-4 md:px-6 rounded-2xl md:rounded-[28px] flex items-center gap-2.5 md:gap-4 font-medium md:font-bold select-none md:backdrop-blur-xl transition-all hover:scale-[1.02] md:hover:scale-105 active:scale-95 cursor-pointer border border-[var(--border)] lg:border-white/10 bg-[var(--surface-1)] lg:bg-transparent lg:opacity-95 lg:shadow-[0_8px_30px_rgba(0,0,0,0.12)] group w-full lg:w-fit`}
                  >
                    <div className="w-7 h-7 md:w-12 md:h-12 rounded-full bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 flex items-center justify-center md:shadow-inner group-hover:bg-white/20 transition-colors shrink-0">
                      <span className="text-lg md:text-2xl filter drop-shadow-sm">{chip.emoji}</span>
                    </div>
                    {chip.label}
                  </div>
                ))}
              </motion.div>

              {/* Spacer on mobile to push input down */}
              <div className="flex-1 md:hidden" />

              {/* Chat Input Pill (empty state) */}
              <div className="w-full max-w-3xl mx-auto mb-6 mt-auto">
                <div className="rounded-[28px] p-2 pr-3 min-h-[56px] md:min-h-[120px] flex flex-col glass-mesh mesh-indigo hover:border-[var(--border-2)] transition-all shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-none">
                  {/* File Preview Chip */}
                  {file && (
                    <div className="px-4 pt-2 flex items-center">
                      <div className="flex items-center gap-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[13px] text-[var(--text)]">
                        <FileText size={14} className="text-[var(--accent)]" />
                        <span className="truncate max-w-[200px]">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={14} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    placeholder={t(`chat_placeholder_${assistantType}`)}
                    className="flex-1 bg-transparent text-[16px] px-4 py-3 min-h-[44px] max-h-[200px] overflow-y-auto text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none resize-none slim-scroll"
                  />
                  <div className="flex items-center justify-between px-2 pb-1">
                    <div className="flex items-center gap-1">
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
                        className="p-2.5 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-full transition-all"
                        title="Upload Document"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="hidden md:flex text-xs font-medium text-[var(--muted)]/50 items-center gap-1 cursor-pointer hover:text-[var(--text)] transition-colors mr-2">
                        Fast <ChevronDown size={14} />
                      </span>
                      {input.trim() ? (
                        <button onClick={() => send()} disabled={busy}
                          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-full text-purple-600 dark:text-purple-400 hover:bg-[var(--surface-2)] transition-colors">
                          <Send size={20} />
                        </button>
                      ) : (
                        <button className="p-2.5 text-white/30 hover:text-white hover:bg-white/5 rounded-full transition-all">
                          <Mic size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto w-full max-w-4xl mx-auto px-4 md:px-8 py-10 space-y-12 pb-44 slim-scroll" dir={isRTL ? 'rtl' : 'ltr'}>
              <AnimatePresence initial={false}>
                {msgs.map(m => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {m.role === 'assistant' && (
                      <div className={`h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white shrink-0 mt-1 shadow-[0_0_15px_rgba(239,68,68,0.3)] border border-red-400/30 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                        <Cpu size={18} />
                      </div>
                    )}

                    <div className={`flex flex-col max-w-[90%] md:max-w-[85%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <div className={`text-[17px] leading-[1.8] whitespace-pre-wrap ${m.role === 'user'
                        ? 'px-6 py-4 rounded-3xl border border-[var(--border)] text-[var(--text)] bg-[var(--surface-1)] shadow-sm'
                        : `text-[var(--text)] opacity-95 py-2 w-full font-normal`
                        }`}
                      >
                        {(() => {
                          const contentToRender = translateHistory(m.content);

                          if (m.role === 'assistant') {
                            return (
                              <div className={`prose dark:prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={{
                                    p: ({ node, ...props }) => <p className="mb-6 last:mb-0" {...props} />,
                                    ul: ({ node, ...props }) => <ul className="list-disc pl-6 mb-6 space-y-2 marker:text-indigo-500" {...props} />,
                                    ol: ({ node, ...props }) => <ol className="list-decimal pl-6 mb-6 space-y-2 marker:text-indigo-500" {...props} />,
                                    strong: ({ node, ...props }) => <strong className="font-bold text-[var(--text)]" {...props} />,
                                    a: ({ node, ...props }) => <a className="text-indigo-400 hover:underline transition-colors" {...props} />,
                                    code: ({ node, className, children, ...props }) => {
                                      const match = /language-(\w+)/.exec(className || '');
                                      const isInline = !match && !className?.includes('language-');
                                      return isInline
                                        ? <code className="bg-[var(--surface-2)] text-indigo-300 px-1.5 py-0.5 rounded text-[14px] font-mono" {...props}>{children}</code>
                                        : <div className="bg-[#0e0e0e] rounded-xl border border-white/10 overflow-hidden my-6"><div className="px-4 py-2 bg-white/5 text-[11px] text-white/40 font-mono uppercase tracking-widest border-b border-white/10">{match?.[1] || 'code'}</div><pre className="p-4 overflow-x-auto text-[14px] text-gray-300 font-mono leading-relaxed"><code {...props}>{children}</code></pre></div>
                                    }
                                  }}
                                >
                                  {contentToRender}
                                </ReactMarkdown>
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
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`flex w-full items-center justify-start py-4 ${isRTL ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`relative h-10 w-10 flex items-center justify-center shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing status ring */}
                    <div className="absolute inset-0 rounded-xl border border-red-500/20 bg-red-500/5 backdrop-blur-sm" />
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-[-2px] rounded-xl border-t border-red-500/60"
                    />
                    <Cpu size={18} className="text-red-500 animate-pulse relative z-10" />

                    {/* Live processing blip */}
                    <motion.div
                      animate={{ opacity: [0, 1, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                      className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400 shadow-[0_0_8px_rgba(239,68,68,1)] z-20"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-black uppercase tracking-[0.2em] text-red-500/80 mb-0.5 animate-pulse">
                      Analyzing Protocol...
                    </span>
                    <span className="text-[14px] font-medium text-[var(--muted)]/80 italic">
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
                <div className={`relative flex flex-col rounded-[32px] p-2.5 pr-4 border border-[var(--border)] transition-all duration-300 bg-[var(--surface-1)] shadow-[0_8px_32px_rgba(0,0,0,0.15)] ${busy ? 'opacity-70' : 'hover:border-indigo-500/50 focus-within:border-indigo-500/50 focus-within:shadow-[0_8px_36px_rgba(0,0,0,0.2)]'}`}>

                  {/* File Preview Chip */}
                  {file && (
                    <div className="px-4 pt-2 -mb-2 flex items-center">
                      <div className="flex items-center gap-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3 py-1.5 text-[13px] text-[var(--text)]">
                        <FileText size={14} className="text-indigo-400" />
                        <span className="truncate max-w-[200px] font-medium">{file.name}</span>
                        <button onClick={() => setFile(null)} className="ml-1 text-[var(--muted)] hover:text-red-400 transition-colors">
                          <Plus size={14} className="rotate-45" />
                        </button>
                      </div>
                    </div>
                  )}

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
                    className="flex-1 max-h-[200px] min-h-[56px] px-5 py-4 bg-transparent text-[17px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none resize-none overflow-y-auto slim-scroll"
                    rows={1}
                  />

                  <div className="flex items-center justify-between px-3 pb-2">
                    <div className="flex items-center gap-1.5">
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
                        className="p-2.5 text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 rounded-full transition-all"
                        title="Upload Document"
                      >
                        <Plus size={22} />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <button className="p-2.5 rounded-full text-[var(--muted)] hover:text-indigo-400 hover:bg-indigo-500/10 transition-all">
                        <Mic size={22} />
                      </button>
                      {input.trim() ? (
                        <button
                          onClick={() => {
                            send();
                            if (inputRef.current) inputRef.current.style.height = 'auto';
                          }}
                          disabled={busy}
                          className="shrink-0 h-11 w-11 flex items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg transition-all scale-105 active:scale-95"
                        >
                          <Send size={20} />
                        </button>
                      ) : (
                        <div className="w-11 h-11" /> /* Spacer if no input */
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
