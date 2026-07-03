import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, MessageSquare, Trash2, Menu, Settings, HelpCircle, History, Zap, Search, X, Star, MoreVertical, ChevronRight, LayoutDashboard, Home, LogOut, Building2, GraduationCap, Scale, Briefcase, Download, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from './ThemeToggle';
import { apiFetch } from '../utils/api';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  assistant_type?: string;
  is_favorite?: boolean;
}

interface SidebarProps {
  currentSessionId: string | null;
  onSessionSelect: (id: string, title: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
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
  onToggleFavorite = () => { },
}: SidebarProps) {
  const { t, isRTL, language } = useLanguage();
  const { logout, isAuthenticated, setIsLoginModalOpen } = useAuth();
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
          animate={{ width: isExpanded ? 'clamp(220px, 19vw, 265px)' : 'clamp(52px, 5vw, 68px)' }}
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
            onToggleFavorite={onToggleFavorite}
            getDisplayTitle={getDisplayTitle}
            filteredSessions={filteredSessions}
            isAuthenticated={isAuthenticated}
            logout={logout}
            language={language}
            setIsLoginModalOpen={setIsLoginModalOpen}
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
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="fixed inset-0 bg-black/50 z-[200] md:hidden"
              onClick={onMobileClose}
            />
            <motion.div
              key="mobile-drawer"
              initial={{ x: isRTL ? '100%' : '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: isRTL ? '100%' : '-100%' }}
              transition={{ type: 'spring', stiffness: 460, damping: 42, mass: 0.8 }}
              className={`fixed top-0 ${isRTL ? 'right-0' : 'left-0'} h-full w-[85vw] max-w-[340px] z-[210] md:hidden shadow-2xl overflow-hidden backdrop-blur-sm will-change-transform`}
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
                onToggleFavorite={onToggleFavorite}
                getDisplayTitle={getDisplayTitle}
                filteredSessions={filteredSessions}
                isAuthenticated={isAuthenticated}
                logout={logout}
                language={language}
                setIsLoginModalOpen={setIsLoginModalOpen}
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
  onToggleFavorite,
  getDisplayTitle,
  filteredSessions,
  isAuthenticated,
  logout,
  language,
  setIsLoginModalOpen
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
  onToggleFavorite: (id: string) => void,
  getDisplayTitle: (title: string, sType?: string) => string,
  filteredSessions: any[],
  isAuthenticated: boolean,
  logout: () => void,
  language: string,
  setIsLoginModalOpen: (open: boolean) => void;
}) => {
  const showLabels = isMobile || isExpanded;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: isMobile ? 0 : 0.05,
        delayChildren: 0,
        duration: 0.15,
      }
    },
    exit: {
      opacity: 0,
      transition: {
        duration: 0.12,
        ease: 'easeIn' as const
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { duration: isMobile ? 0.15 : 0.3 }
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.1 }
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
      {isMobile ? null : (
        <div className="p-2.5 mb-0 shrink-0">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 rounded-full hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors"
            title="Toggle menu"
          >
            <Menu size={20} />
          </button>
        </div>
      )}

      {/* New Chat — desktop (stays at top) */}
      {!isMobile && (
        <motion.div variants={itemVariants} className="px-3 mb-2 shrink-0">
          <button
            onClick={() => { onNewChat(); }}
            title={t('sidebar_new_chat')}
            className={`group flex items-center justify-start gap-3 transition-all duration-300 h-12 rounded-2xl bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] shadow-sm hover:shadow-md overflow-hidden ${isExpanded ? 'w-full px-5' : 'w-11 px-3'}`}
          >
            <Plus size={22} className="text-[var(--accent)] shrink-0" />
            {showLabels && (
              <span className="text-[15px] font-semibold text-[var(--text)] whitespace-nowrap">
                {t('sidebar_new_chat')}
              </span>
            )}
          </button>
        </motion.div>
      )}

      {/* Mobile nav group: Home → Dashboard → Services → Download → New Chat */}
      {isMobile && (
        <motion.div variants={itemVariants} className="px-3 pt-1 pb-1 shrink-0 space-y-1">
          <Link href="/" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <Home size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_home')}</span>
            </button>
          </Link>

          <Link href="/dashboard" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <LayoutDashboard size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_dashboard')}</span>
            </button>
          </Link>

          <Link href="/services" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <Briefcase size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('navbar_services') || 'Services'}</span>
            </button>
          </Link>

          <Link href="/download" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <Download size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('navbar_download') === 'navbar_download' ? 'Download' : t('navbar_download')}</span>
            </button>
          </Link>

          <Link href="/pricing" className="block">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <CreditCard size={20} className="text-[var(--text)] shrink-0" />
              <span className={`text-[15px] font-medium text-[var(--text)] ${isRTL ? 'text-right' : 'text-left'}`}>{t('navbar_pricing') || 'Prices'}</span>
            </button>
          </Link>

          {/* New Chat — mobile (placed under the nav links, desktop card effect) */}
          <button
            onClick={() => { onNewChat(); onMobileClose?.(); }}
            title={t('sidebar_new_chat')}
            className="group flex items-center gap-3 w-full h-12 px-5 rounded-2xl bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] shadow-sm hover:shadow-md overflow-hidden transition-all duration-300 mt-1"
          >
            <Plus size={22} className="text-[var(--accent)] shrink-0" />
            <span className={`text-[15px] font-semibold text-[var(--text)] whitespace-nowrap ${isRTL ? 'text-right' : 'text-left'}`}>{t('sidebar_new_chat')}</span>
          </button>
        </motion.div>
      )}

      {/* Agent Tabs */}
      {showLabels && (
        <motion.div variants={itemVariants} className="flex bg-[var(--surface-2)] p-1 rounded-xl mx-3 mb-1 mt-2 shrink-0">
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
              className={`flex-1 py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all outline-none ${assistantType === tab.id ? 'bg-[var(--surface-1)] shadow-sm text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <tab.icon size={13} className={assistantType === tab.id ? tab.color : 'opacity-50'} />
              <span className="text-[9px] font-bold whitespace-nowrap leading-none">{tab.label}</span>
            </button>
          ))}
        </motion.div>
      )}

      <motion.div variants={itemVariants} className="flex-1 overflow-y-auto px-3 space-y-0.5 slim-scroll pr-1">
        {!token && showLabels ? (
          <div className="mx-1 p-3 rounded-2xl bg-[var(--surface-2)]/60 border border-[var(--border)] space-y-2 mt-2">
            <p className="text-[12px] font-semibold text-[var(--text)]">{t('sidebar_sign_in_prompt')}</p>
            <p className="text-[11px] text-[var(--muted)] leading-relaxed">{t('sidebar_sign_in_desc')}</p>
            <button 
              onClick={() => setIsLoginModalOpen(true)}
              className="text-[var(--accent)] text-[12px] font-bold hover:underline"
            >
              {t('navbar_login')}
            </button>
          </div>
        ) : loading && sessions.length === 0 ? (
          <div className="space-y-4 px-3 py-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-2 bg-[var(--border)] animate-pulse rounded-full w-full" />
            ))}
          </div>
        ) : (
          <>
            {showLabels && (
              <div className="px-3 py-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest flex items-center gap-2 opacity-60">
                <Star size={9} className="text-amber-500 fill-amber-500" />
                {t('sidebar_favorites')}
              </div>
            )}
            {filteredSessions.filter(s => s.is_favorite).length === 0 && showLabels && (
              <div className="px-7 py-1 text-[11px] text-[var(--muted)] italic opacity-50">
                {t('sidebar_no_favorites')}
              </div>
            )}
            {filteredSessions.filter(s => s.is_favorite).map((s) => (
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
                  <div className={`absolute right-3 flex items-center gap-1 transition-all ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(s.id);
                      }}
                      title={language === 'ar' ? 'تفضيل' : language === 'tr' ? 'Favorilere Ekle' : 'Favorite'}
                      className={`p-1.5 rounded-lg transition-all ${s.is_favorite ? 'text-amber-500 bg-amber-500/10' : 'text-[var(--muted)] hover:text-amber-500 hover:bg-amber-500/10'}`}
                    >
                      <Star size={16} fill={s.is_favorite ? "currentColor" : "none"} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                      title={language === 'ar' ? 'حذف الدردشة' : language === 'tr' ? 'Sohbeti Sil' : 'Delete Chat'}
                      className="p-1.5 rounded-lg transition-all text-[var(--muted)] hover:text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </motion.div>
            ))}

            {filteredSessions.some(s => s.is_favorite) && filteredSessions.some(s => !s.is_favorite) && showLabels && (
               <div className="h-px bg-[var(--border)] mx-3 my-2 opacity-50" />
            )}

            {showLabels && filteredSessions.some(s => !s.is_favorite) && (
              <div className="px-3 py-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-widest flex items-center gap-2 opacity-60">
                <History size={9} className="text-[var(--muted)]" />
                {t('sidebar_recent')}
              </div>
            )}

            {filteredSessions.filter(s => !s.is_favorite).map((s) => (
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
                <div className={`absolute right-3 flex items-center gap-1 transition-all ${isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(s.id);
                    }}
                    title={language === 'ar' ? 'تفضيل' : language === 'tr' ? 'Favorilere Ekle' : 'Favorite'}
                    className={`p-1.5 rounded-lg transition-all ${s.is_favorite ? 'text-amber-500 bg-amber-500/10' : 'text-[var(--muted)] hover:text-amber-500 hover:bg-amber-500/10'}`}
                  >
                    <Star size={16} fill={s.is_favorite ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    title={language === 'ar' ? 'حذف الدردشة' : language === 'tr' ? 'Sohbeti Sil' : 'Delete Chat'}
                    className="p-1.5 rounded-lg transition-all text-[var(--muted)] hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </motion.div>
          ))}
          </>
        )}
      </motion.div>

      {/* Bottom */}
      <motion.div variants={itemVariants} className="px-2 py-2 space-y-0.5 mt-auto border-t border-[var(--border)] bg-[var(--surface)]/50 shrink-0">

        {isMobile && (
          <div className="flex items-center justify-end pb-2 mb-2 border-b border-[var(--border)] px-2">
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
          <div 
            onClick={() => { setIsLoginModalOpen(true); if (onMobileClose) onMobileClose(); }}
            className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all mb-1"
          >
            <span className="text-sm font-bold text-[var(--text)]">Login</span>
          </div>
        )}

        {/* Help */}
        {isMobile && (
          <Link href="/help" className="block" onClick={onMobileClose}>
            <div className="group flex items-center gap-3 py-2 px-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all" title={t('sidebar_help')}>
              <HelpCircle size={17} className="text-[var(--text)] group-hover:text-[var(--text)] transition-all shrink-0" />
              {showLabels && (
                <span className="text-[13px] font-semibold text-[var(--text)]">{t('sidebar_help')}</span>
              )}
            </div>
          </Link>
        )}

        {/* Settings & help */}
        <Link href="/settings" className="block" onClick={isMobile ? onMobileClose : undefined}>
          <div className="group flex items-center gap-3 py-2 px-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all" title={t('sidebar_settings')}>
            <Settings size={17} className="text-[var(--text)] group-hover:scale-110 transition-all shrink-0" />
            {showLabels && (
              <span className="text-[13px] font-semibold text-[var(--text)]">{t('settings_title')}</span>
            )}
          </div>
        </Link>

        {/* Upgrade button */}
        <Link href="/pricing" className="block" onClick={isMobile ? onMobileClose : undefined}>
          <div className={`group flex items-center gap-3 py-2 px-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 cursor-pointer transition-all hover:bg-indigo-500/20 ${!showLabels ? 'justify-center' : ''}`}>
            <Zap size={17} className="text-indigo-600 shrink-0" fill="currentColor" />
            {showLabels && <span className="text-[13px] font-black text-indigo-600">{t('sidebar_upgrade')}</span>}
          </div>
        </Link>

        {!isMobile && (
          <>
            {[
              { icon: HelpCircle, label: t('sidebar_help'), color: 'text-[var(--muted)]', href: '/help' },
            ].map((item, idx) => (
              <Link href={item.href} key={idx} className="block">
                <div
                  className="group flex items-center gap-3 py-2 px-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all"
                  title={item.label}
                >
                  <item.icon size={17} className={`${item.color} group-hover:text-[var(--text)] transition-colors`} />
                  {isExpanded && (
                    <span className="text-[13px] font-medium text-[var(--text)] opacity-70 group-hover:opacity-100">{item.label}</span>
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
