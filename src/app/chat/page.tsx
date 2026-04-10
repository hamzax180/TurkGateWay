'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, User, Mic, Plus, ChevronDown, Building2, FileText, Search, Clock, HelpCircle, Scale, Menu, GraduationCap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';

import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

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

              // Find the title for the forced session to update UI nicely
              const fSession = data.find((s: any) => s.id === forcedSessionId);

              // We use a callback in setSessionId just in case it's mid-update
              setSessionId(prev => {
                // If it already resolved to something else ignore, otherwise force:
                return forcedSessionId;
              });
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
              // Restore active session fully
              setSessionId(activeSession.id);
              setSessionTitle(activeSession.title || '');
              if (activeSession.assistant_type) {
                setAssistantType(activeSession.assistant_type);
              }
            } else if (data.length > 0) {
              // Fallback to most recent session overall
              setSessionId(data[0].id);
              setSessionTitle(data[0].title || '');
              if (data[0].assistant_type) setAssistantType(data[0].assistant_type);
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
      if (!sessionId) return;

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

  return (
    <div className="flex h-screen overflow-hidden selection:bg-purple-500/30 relative bg-[var(--bg)]">
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
        {/* Desktop Navbar */}
        <div className="hidden md:block">
          <Navbar isAppPage />
        </div>

        {/* Mobile Top Bar — Agent selection replaces static title */}
        <div className="flex md:hidden items-center justify-between px-4 h-14 shrink-0 border-b border-[var(--border)] bg-[var(--bg)] z-30">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors"
          >
            <Menu size={22} />
          </button>
          <div
            className="flex flex-col items-center justify-center cursor-pointer hover:bg-[var(--surface-2)] px-3 py-1 rounded-xl transition-all"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-[12px] font-extrabold uppercase tracking-widest text-indigo-500 opacity-90">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} Agent
              </span>
              <ChevronDown size={11} className={`text-indigo-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            <span className="text-[15px] font-bold text-[var(--text)] tracking-tight leading-none truncate max-w-[180px]">
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
        <div className="hidden md:flex h-20 items-center justify-center px-6 shrink-0 z-30 relative" ref={dropdownRef}>
          <div
            className="flex flex-col items-center justify-center cursor-pointer hover:bg-[var(--surface-2)] px-6 py-2 rounded-2xl transition-all border border-transparent hover:border-[var(--border)]"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[14px] font-extrabold uppercase tracking-[0.3em] bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent opacity-90">
                {assistantType === 'permit' ? t('assistant_permit') : assistantType === 'student' ? t('assistant_student') : t('assistant_lawyer')} Agent
              </span>
              <ChevronDown size={14} className={`text-indigo-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </div>
            <span className="text-xl font-bold text-[var(--text)] opacity-95 tracking-tight leading-none">
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
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.95 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="fixed top-16 md:top-28 left-1/2 -translate-x-1/2 bg-[var(--surface-1)] border border-[var(--border)] rounded-[32px] md:rounded-[48px] shadow-[0_32px_80px_rgba(0,0,0,0.6)] p-4 md:p-6 w-[90vw] max-w-[420px] z-[100] flex flex-col gap-4 md:gap-5 overflow-hidden"
              >
                <div className="px-4 md:px-5 pb-2 md:pb-3 border-b border-[var(--border)]/50 mb-1">
                  <p className="text-base md:text-lg font-bold tracking-tight bg-gradient-to-r from-[#4285f4] via-[#9b72cb] to-[#d96570] bg-clip-text text-transparent text-center">
                    {t('chat_switch_assistant')}
                  </p>
                </div>

                <div className="flex flex-col gap-2 md:gap-3">
                  <button
                    onClick={() => switchAssistant('permit')}
                    className={`flex items-center gap-4 md:gap-5 px-5 md:px-8 py-4 md:py-5 w-full rounded-full transition-all duration-300 group relative overflow-hidden ${assistantType === 'permit' ? 'glass-mesh mesh-indigo border-indigo-500/50 text-[var(--text)] shadow-[0_0_30px_rgba(99,102,241,0.2)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent hover:border-white/10'}`}
                  >
                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-300">
                      <Building2 size={isMobile ? 24 : 28} className="text-indigo-500" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[17px] md:text-[20px] font-bold tracking-tight leading-none mb-1">{t('assistant_permit')} AI Agent</span>
                      <span className="text-[12px] md:text-[13px] opacity-60 font-medium">{t('chat_permit_desc')}</span>
                    </div>
                    {assistantType === 'permit' && <div className="ml-auto w-2.5 h-2.5 rounded-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('student')}
                    className={`flex items-center gap-4 md:gap-5 px-5 md:px-8 py-4 md:py-5 w-full rounded-full transition-all duration-300 group relative overflow-hidden ${assistantType === 'student' ? 'glass-mesh mesh-purple border-purple-500/50 text-[var(--text)] shadow-[0_0_30px_rgba(168,85,247,0.2)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent hover:border-white/10'}`}
                  >
                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-full bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-300">
                      <GraduationCap size={isMobile ? 24 : 28} className="text-purple-500" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[17px] md:text-[20px] font-bold tracking-tight leading-none mb-1">{t('assistant_student')} AI Agent</span>
                      <span className="text-[12px] md:text-[13px] opacity-60 font-medium">{t('chat_student_desc')}</span>
                    </div>
                    {assistantType === 'student' && <div className="ml-auto w-2.5 h-2.5 rounded-full bg-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.8)]" />}
                  </button>

                  <button
                    onClick={() => switchAssistant('lawyer')}
                    className={`flex items-center gap-4 md:gap-5 px-5 md:px-8 py-4 md:py-5 w-full rounded-full transition-all duration-300 group relative overflow-hidden ${assistantType === 'lawyer' ? 'glass-mesh mesh-indigo border-indigo-500/50 text-[var(--text)] shadow-[0_0_30px_rgba(59,130,246,0.2)]' : 'text-[var(--muted)] hover:bg-[var(--surface-2)] border border-transparent hover:border-white/10'}`}
                  >
                    <div className="w-11 h-11 md:w-14 md:h-14 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-inner group-hover:scale-110 transition-transform duration-300">
                      <Scale size={isMobile ? 24 : 28} className="text-blue-500" />
                    </div>
                    <div className="flex flex-col text-left">
                      <span className="text-[17px] md:text-[20px] font-bold tracking-tight leading-none mb-1">{t('assistant_lawyer')} AI Agent</span>
                      <span className="text-[12px] md:text-[13px] opacity-60 font-medium">{t('chat_lawyer_desc')}</span>
                    </div>
                    {assistantType === 'lawyer' && <div className="ml-auto w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.8)]" />}
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 flex flex-col min-h-0 relative">

          {isEmpty ? (
            <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-5 md:px-6">
              {/* Welcome Text — top on mobile, centered on desktop */}
              <motion.div
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
                className="w-full text-left mt-6 md:mt-0 md:flex-1 md:flex md:flex-col md:justify-center"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-3xl md:text-6xl font-medium bg-gradient-to-r from-[#4285f4] via-[#9b72cb] to-[#d96570] bg-clip-text text-transparent">
                    {t('chat_welcome').replace('{name}', user?.fullName || (user?.email ? user.email.split('@')[0] : 'there'))}
                  </span>
                </div>
                <h1 className="text-3xl md:text-6xl font-medium tracking-tight text-[#c4c7c5] dark:text-[#444746]">
                  {t('chat_begin')}
                </h1>
              </motion.div>

              {/* Suggestion Chips — Gemini style: left-aligned simple pills on mobile, fancy chips on desktop */}
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                className="flex flex-col md:flex-row md:flex-wrap md:justify-center gap-2 md:gap-2.5 mt-6 md:mt-0 md:mb-8"
              >
                {(assistantType === 'student' ? [
                   { emoji: "🪪", label: t('chat_sug_renew'), mesh: 'mesh-indigo' },
                   { emoji: "🏛️", label: t('chat_sug_uni'), mesh: 'mesh-purple' },
                   { emoji: "🗺️", label: t('chat_sug_roadmap'), mesh: 'mesh-emerald' },
                   { emoji: "📅", label: t('chat_sug_deadlines'), mesh: 'mesh-amber' },
                   { emoji: "🛂", label: t('chat_sug_visas'), mesh: 'mesh-amber' },
                   { emoji: "🆘", label: t('chat_sug_shelp'), mesh: 'mesh-indigo' }
                 ] : assistantType === 'lawyer' ? [
                   { emoji: "📑", label: t('chat_sug_contract'), mesh: 'mesh-indigo' },
                   { emoji: "🏗️", label: t('chat_sug_formation'), mesh: 'mesh-purple' },
                   { emoji: "🤝", label: t('chat_sug_employ'), mesh: 'mesh-emerald' },
                   { emoji: "📊", label: t('chat_sug_times'), mesh: 'mesh-amber' },
                   { emoji: "🏠", label: t('chat_sug_resid'), mesh: 'mesh-amber' },
                   { emoji: "⚖️", label: t('chat_sug_dispute'), mesh: 'mesh-indigo' }
                 ] : [
                   { emoji: "🏢", label: t('chat_suggestion_business'), mesh: 'mesh-indigo' },
                   { emoji: "📜", label: t('chat_suggestion_permit'), mesh: 'mesh-purple' },
                   { emoji: "📍", label: t('chat_suggestion_location'), mesh: 'mesh-emerald' },
                   { emoji: "⏳", label: t('chat_suggestion_duration'), mesh: 'mesh-amber' },
                   { emoji: "💰", label: t('chat_suggestion_cost'), mesh: 'mesh-amber' },
                   { emoji: "❓", label: t('chat_suggestion_help'), mesh: 'mesh-indigo' }
                 ]).map((chip, i) => (
                   <div
                    key={i}
                    onClick={() => send(chip.label)}
                    className={`md:glass-mesh md:${chip.mesh} text-[var(--text)] text-[15px] md:text-[16px] py-3 md:py-4 px-5 md:px-6 rounded-full md:rounded-[28px] flex items-center gap-3 md:gap-4 font-medium md:font-bold select-none md:backdrop-blur-xl transition-all hover:scale-[1.02] md:hover:scale-105 active:scale-95 cursor-pointer border border-[var(--border)] md:border-white/10 bg-[var(--surface-1)] md:bg-transparent md:opacity-95 md:shadow-[0_8px_30px_rgba(0,0,0,0.12)] group w-fit`}
                   >
                     <div className="w-9 h-9 md:w-12 md:h-12 rounded-full bg-white/5 md:bg-white/10 border border-white/10 md:border-white/20 flex items-center justify-center md:shadow-inner group-hover:bg-white/20 transition-colors shrink-0">
                       <span className="text-lg md:text-2xl filter drop-shadow-sm">{chip.emoji}</span>
                     </div>
                     {chip.label}
                   </div>
                 ))}
              </motion.div>

              {/* Spacer on mobile to push input down */}
              <div className="flex-1 md:hidden" />

              {/* Chat Input Pill (empty state) */}
              <div className="w-full max-w-3xl mx-auto mb-4 md:mb-12 mt-4 md:mt-0">
                <div className="rounded-[28px] p-2 pr-3 min-h-[56px] md:min-h-[140px] flex flex-col glass-mesh mesh-indigo hover:border-[var(--border-2)] transition-all shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-none">
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
                    placeholder={t('chat_placeholder_alt')}
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
                      <div className={`h-8 w-8 rounded-full bg-gradient-to-r from-[#4285f4] to-[#9b72cb] flex items-center justify-center text-white shrink-0 mt-1 shadow-lg ${isRTL ? 'ml-4' : 'mr-4'}`}>
                        <Sparkles size={16} />
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
                              <div className={`prose prose-invert max-w-none ${isRTL ? 'text-right' : 'text-left'}`} dir={isRTL ? 'rtl' : 'ltr'}>
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
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex w-full items-center justify-start"
                >
                  <div className={`relative h-8 w-8 shrink-0 ${isRTL ? 'ml-4' : 'mr-4'}`}>
                    {/* Glowing rotating ring */}
                    <div className="absolute inset-[-4px] rounded-full border-2 border-transparent border-t-indigo-500 border-r-purple-500 animate-spin opacity-70" />
                    <div className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 backdrop-blur-md flex items-center justify-center border border-[var(--border)] shadow-[0_0_15px_rgba(168,85,247,0.2)]">
                      <Sparkles size={14} className="text-purple-500 dark:text-purple-300 animate-pulse" />
                    </div>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[14px] font-medium bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent animate-pulse italic">
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
                    placeholder={t('chat_placeholder_alt') || "Ask anything..."}
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
