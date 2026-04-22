import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, MessageSquare, Trash2, Menu, Settings, HelpCircle, History, Zap, Search, X, Star, MoreVertical, ChevronRight, LayoutDashboard, Home, LogOut, Building2, GraduationCap, Scale } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import { apiFetch } from '../utils/api';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  assistant_type?: string;
}

interface SidebarProps {
  currentSessionId: string | null;
  onSessionSelect: (id: string, title: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  token: string | null;
  assistantType: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  refreshTrigger?: number;
  showAllTypes?: boolean;
  onSwitchAssistant?: (type: 'permit' | 'student' | 'lawyer') => void;
  mobileOnly?: boolean;
}

export default function Sidebar({
  currentSessionId,
  onSessionSelect,
  onNewChat,
  onDeleteSession,
  token,
  assistantType,
  mobileOpen = false,
  onMobileClose,
  refreshTrigger = 0,
  showAllTypes = false,
  onSwitchAssistant = () => { },
  mobileOnly = false,
}: SidebarProps) {
  const { t, isRTL, language } = useLanguage();
  const { logout, isAuthenticated } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSessions = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/chat/sessions`);
      if (res?.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (e) {
      console.error("Failed to fetch sessions", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [token, currentSessionId, refreshTrigger]);

  const getDisplayTitle = (title: string, sType?: string) => {
    if (!title) return t('chat_new');
    if (title === 'New Chat') return t('chat_new');
    if (title === 'Document Analysis') return t('chat_suggestion_permit').replace('?', '');

    const lowerTitle = title.toLowerCase();

    // Pattern: "[Business] in [District]" — restricted to permit mode
    const match = (sType === 'permit' || !sType) ? lowerTitle.match(/^(.+?)\s+in\s+(.+)$/) : null;
    if (match) {
      const businessRaw = match[1].trim();
      const districtRaw = match[2].trim().replace(/\s/g, ''); // normalize for keys

      const bizKey = `biz_${businessRaw}`;
      const distKey = `dist_${districtRaw}`;

      const localizedBiz = t(bizKey);
      const localizedDist = t(distKey);

      // If we found both in our dictionary
      if (localizedBiz !== bizKey && localizedDist !== distKey) {
        return isRTL
          ? `${localizedBiz} ${t('connect_in')} ${localizedDist}`
          : `${localizedBiz} ${t('connect_in')} ${localizedDist}`;
      }
    }

    return title;
  };

  const filteredSessions = sessions.filter(s => {
    const typeMatch = showAllTypes || (s.assistant_type || 'permit') === assistantType;
    const searchMatch = !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase());
    return typeMatch && searchMatch;
  });

  return (
    <>
      {/* ─── Desktop Sidebar (hidden on mobile) ─── */}
      {!mobileOnly && (
        <motion.aside
          initial={false}
          animate={{ width: isExpanded ? 280 : 68 }}
          transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          className="hidden md:flex h-full flex-col shrink-0 relative z-50 border-r border-[var(--border)] overflow-hidden"
        >
          <SidebarInner
            isMobile={false}
            isExpanded={isExpanded}
            setIsExpanded={setIsExpanded}
            isRTL={isRTL}
            t={t}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            onNewChat={onNewChat}
            assistantType={assistantType}
            onSwitchAssistant={onSwitchAssistant}
            token={token}
            loading={loading}
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            getDisplayTitle={getDisplayTitle}
            filteredSessions={filteredSessions}
            isAuthenticated={isAuthenticated}
            logout={logout}
            language={language}
          />
        </motion.aside>
      )}

      {/* ─── Mobile Drawer Overlay ─── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className="fixed inset-0 bg-black/50 z-[200] md:hidden"
              onClick={onMobileClose}
            />
            <motion.div
              key="mobile-drawer"
              initial={{ x: isRTL ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: isRTL ? '100%' : '-100%' }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
              className={`fixed top-0 ${isRTL ? 'right-0' : 'left-0'} h-full w-[85vw] max-w-[340px] z-[210] md:hidden shadow-2xl overflow-hidden backdrop-blur-sm`}
            >
              <SidebarInner
                isMobile
                isExpanded={isExpanded}
                setIsExpanded={setIsExpanded}
                isRTL={isRTL}
                t={t}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onNewChat={onNewChat}
                onMobileClose={onMobileClose}
                assistantType={assistantType}
                onSwitchAssistant={onSwitchAssistant}
                token={token}
                loading={loading}
                sessions={sessions}
                currentSessionId={currentSessionId}
                onSessionSelect={onSessionSelect}
                onDeleteSession={onDeleteSession}
                getDisplayTitle={getDisplayTitle}
                filteredSessions={filteredSessions}
                isAuthenticated={isAuthenticated}
                logout={logout}
                language={language}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .slim-scroll::-webkit-scrollbar { width: 4px; }
        .slim-scroll::-webkit-scrollbar-track { background: transparent; }
        .slim-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
      `}</style>
    </>
  );
}

/* ─── Shared Sidebar Content ────────────────── */
const SidebarInner = React.memo(({
  isMobile = false,
  isExpanded,
  setIsExpanded,
  isRTL,
  t,
  searchQuery,
  setSearchQuery,
  onNewChat,
  onMobileClose,
  assistantType,
  onSwitchAssistant,
  token,
  loading,
  sessions,
  currentSessionId,
  onSessionSelect,
  onDeleteSession,
  getDisplayTitle,
  filteredSessions,
  isAuthenticated,
  logout,
  language,
}: {
  isMobile?: boolean,
  isExpanded: boolean,
  setIsExpanded: (v: boolean) => void,
  isRTL: boolean,
  t: (k: string) => string,
  searchQuery: string,
  setSearchQuery: (v: string) => void,
  onNewChat: () => void,
  onMobileClose?: () => void,
  assistantType: string,
  onSwitchAssistant: (type: any) => void,
  token: string | null,
  loading: boolean,
  sessions: any[],
  currentSessionId: string | null,
  onSessionSelect: (id: string, title: string) => void,
  onDeleteSession: (id: string) => void,
  getDisplayTitle: (title: string) => string,
  filteredSessions: any[],
  isAuthenticated: boolean,
  logout: () => void,
  language: string,
}) => {
  const showLabels = isMobile || isExpanded;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1,
      }
    },
    exit: {
      opacity: 0,
      transition: {
        duration: 0.2,
        ease: 'easeIn' as const
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: 0.3 }
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.15 }
    }
  };

  return (
    <motion.nav
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={containerVariants}
      className="h-full flex flex-col bg-[var(--surface)] dark:bg-[var(--surface)]/80 dark:backdrop-blur-xl border-r border-[var(--border)]"
    >
      {/* Search bar */}
      {isMobile ? (
        <motion.div variants={itemVariants} className="p-3 shrink-0">
          <div className="flex items-center gap-2.5 bg-[var(--surface-2)] rounded-full px-4 py-2.5 border border-[var(--border)]">
            <Search size={16} className="text-[var(--muted)] shrink-0" />
            <input
              type="text"
              placeholder={t('chat_placeholder_alt')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-[var(--muted)]">
                <X size={14} />
              </button>
            )}
          </div>
        </motion.div>
      ) : (
        <div className="p-4 mb-1 shrink-0">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2.5 rounded-full hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors"
            title="Toggle menu"
          >
            <Menu size={20} />
          </button>
        </div>
      )}

      {/* New Chat */}
      <motion.div variants={itemVariants} className={`${isMobile ? 'px-3 mb-1' : 'px-4 mb-6'} shrink-0`}>
        <button
          onClick={() => { onNewChat(); if (isMobile) onMobileClose?.(); }}
          title={t('sidebar_new_chat')}
          className={`group flex items-center justify-start gap-3 transition-all duration-300 ${isMobile
            ? 'w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)]'
            : `h-14 rounded-2xl bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] shadow-sm hover:shadow-md overflow-hidden ${isExpanded ? 'w-full px-5' : 'w-12 px-3.5'}`
            }`}
        >
          <Plus size={isMobile ? 20 : 22} className={isMobile ? "text-[var(--text)] shrink-0" : "text-[var(--accent)] shrink-0"} />
          {showLabels && (
            <span className="text-[15px] font-semibold text-[var(--text)] whitespace-nowrap">
              {t('sidebar_new_chat')}
            </span>
          )}
        </button>
      </motion.div>

      {/* Home (mobile Gemini style) */}
      {isMobile && (
        <motion.div variants={itemVariants} className="px-3 mb-1 shrink-0">
          <Link href="/" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <Home size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_home')}</span>
            </button>
          </Link>
        </motion.div>
      )}

      {/* Dashboard (mobile Gemini style) */}
      {isMobile && (
        <motion.div variants={itemVariants} className="px-3 mb-1 shrink-0">
          <Link href="/dashboard" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <LayoutDashboard size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_dashboard')}</span>
            </button>
          </Link>
        </motion.div>
      )}

      {/* My stuff (mobile Gemini style) */}
      {isMobile && (
        <motion.div variants={itemVariants} className="px-3 mb-1 shrink-0">
          <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
            <Star size={20} className="text-[var(--text)] shrink-0" />
            <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_my_stuff')}</span>
          </button>
        </motion.div>
      )}

      {/* Gems (mobile Gemini style) */}
      {isMobile && (
        <motion.div variants={itemVariants} className="px-3 mb-1 shrink-0">
          <button className="group flex items-center justify-between w-full px-4 py-2.5 rounded-xl hover:bg-[var(--surface-2)] transition-all">
            <span className="text-[15px] font-bold text-[var(--text)]">{t('sidebar_gems')}</span>
            <ChevronRight size={16} className={`${isRTL ? 'rotate-180' : ''} text-[var(--muted)]`} />
          </button>
        </motion.div>
      )}

      {/* Agent Tabs */}
      {showLabels && (
        <motion.div variants={itemVariants} className="flex bg-[var(--surface-2)] p-1 rounded-xl mx-3 mb-2 mt-3 shrink-0">
          {[
            { id: 'permit', label: t('assistant_permit'), icon: Building2, color: 'text-[var(--accent)]' },
            { id: 'student', label: t('assistant_student'), icon: GraduationCap, color: 'text-[var(--accent)]' },
            { id: 'lawyer', label: t('assistant_lawyer'), icon: Scale, color: 'text-[var(--accent)]' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                if (typeof onSwitchAssistant === 'function') {
                  onSwitchAssistant(tab.id as any);
                }
              }}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-lg flex flex-col items-center justify-center gap-1 transition-all outline-none ${assistantType === tab.id ? 'bg-[var(--surface-1)] shadow-sm text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <tab.icon size={14} className={assistantType === tab.id ? tab.color : 'opacity-50'} />
              {tab.label} {t('agent_badge')}
            </button>
          ))}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="flex-1 overflow-y-auto px-3 space-y-0.5 slim-scroll pr-1">
        {!token && showLabels ? (
          <div className="mx-1 p-4 rounded-2xl bg-[var(--surface-2)]/60 border border-[var(--border)] space-y-3 mt-2">
            <p className="text-[13px] font-semibold text-[var(--text)]">{t('sidebar_sign_in_prompt')}</p>
            <p className="text-[12px] text-[var(--muted)] leading-relaxed">{t('sidebar_sign_in_desc')}</p>
            <Link href="/login">
              <button className="text-[var(--accent)] text-[13px] font-bold hover:underline">{t('navbar_login')}</button>
            </Link>
          </div>
        ) : loading && sessions.length === 0 ? (
          <div className="space-y-4 px-3 py-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-2 bg-[var(--border)] animate-pulse rounded-full w-full" />
            ))}
          </div>
        ) : (
          filteredSessions.map((s) => (
            <motion.div
              key={s.id}
              variants={itemVariants}
              className={`group relative flex items-center gap-3 p-3.5 rounded-xl transition-all cursor-pointer ${currentSessionId === s.id
                ? 'bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text)] shadow-sm'
                : 'hover:bg-[var(--surface-2)]/50 text-[var(--text)] opacity-100'
                }`}
              onClick={() => {
                onSessionSelect(s.id, s.title);
                if (isMobile) onMobileClose?.();
              }}
            >
              {!showLabels && (
                <MessageSquare size={18} className={currentSessionId === s.id ? "text-[var(--accent)]" : "text-[var(--muted)]"} />
              )}
              {showLabels && (
                <span
                  title={s.title}
                  className={`text-sm tracking-tight truncate flex-1 pr-8 ${currentSessionId === s.id ? 'font-bold' : 'font-semibold text-[var(--text)]'}`}
                >
                  {getDisplayTitle(s.title, s.assistant_type)}
                </span>
              )}
              {showLabels && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSession(s.id);
                  }}
                  title={language === 'ar' ? 'حذف الدردشة' : language === 'tr' ? 'Sohbeti Sil' : 'Delete Chat'}
                  className={`absolute right-3 p-1.5 rounded-lg transition-all hover:text-red-500 hover:bg-red-500/10 ${isMobile ? 'opacity-100 text-[var(--muted)]' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </motion.div>
          ))
        )}
      </motion.div>

      {/* Bottom */}
      <motion.div variants={itemVariants} className="p-3 space-y-1 mt-auto border-t border-[var(--border)] bg-[var(--surface)]/50 shrink-0">

        {isMobile && (
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[var(--border)] px-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        )}

        {isMobile && isAuthenticated && (
          <div
            onClick={() => { logout(); if (onMobileClose) onMobileClose(); }}
            className="group flex items-center gap-3 p-3 rounded-full hover:bg-red-500/10 cursor-pointer transition-all mb-1"
          >
            <LogOut size={18} className="text-red-500 shrink-0" />
            <span className="text-sm font-bold text-red-500">Logout</span>
          </div>
        )}

        {isMobile && !isAuthenticated && (
          <Link href="/login" className="block" onClick={onMobileClose}>
            <div className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all mb-1">
              <span className="text-sm font-bold text-[var(--text)]">Login</span>
            </div>
          </Link>
        )}

        {/* Settings & help */}
        <Link href="/settings" className="block" onClick={isMobile ? onMobileClose : undefined}>
          <div className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all" title={t('sidebar_settings')}>
            <Settings size={18} className="text-[var(--text)] group-hover:scale-110 transition-all shrink-0" />
            {showLabels && (
              <span className="text-sm font-semibold text-[var(--text)]">{t('settings_title')}</span>
            )}
          </div>
        </Link>

        {/* Upgrade button */}
        <Link href="/pricing" className="block" onClick={isMobile ? onMobileClose : undefined}>
          <div className={`group flex items-center gap-3 p-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 cursor-pointer transition-all hover:bg-indigo-500/20 ${!showLabels ? 'justify-center' : ''}`}>
            <Zap size={18} className="text-indigo-600 shrink-0" fill="currentColor" />
            {showLabels && <span className="text-sm font-black text-indigo-600">{t('sidebar_upgrade')}</span>}
          </div>
        </Link>

        {!isMobile && (
          <>
            {[
              { icon: HelpCircle, label: t('sidebar_help'), color: 'text-[var(--muted)]', href: '/help' },
              { icon: History, label: t('sidebar_activity'), color: 'text-[var(--muted)]', href: '/dashboard' },
            ].map((item, idx) => (
              <Link href={item.href} key={idx} className="block">
                <div
                  className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all"
                  title={item.label}
                >
                  <item.icon size={18} className={`${item.color} group-hover:text-[var(--text)] transition-colors`} />
                  {isExpanded && (
                    <span className="text-sm font-medium text-[var(--text)] opacity-70 group-hover:opacity-100">{item.label}</span>
                  )}
                </div>
              </Link>
            ))}
          </>
        )}
      </motion.div>
    </motion.nav>
  );
});

SidebarInner.displayName = 'SidebarInner';
