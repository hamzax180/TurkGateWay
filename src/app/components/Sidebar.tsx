import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Plus, MessageSquare, Trash2, Menu, Settings, HelpCircle, History, Zap, Search, X, Star, MoreVertical, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../context/LanguageContext';
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
}: SidebarProps) {
  const { t } = useLanguage();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [isExpanded, setIsExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchSessions = async () => {
    if (!token) return;
    try {
      setLoading(true);
      const res = await apiFetch(`/chat/sessions?token=${token}`);
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
  }, [token, currentSessionId]);

  const filteredSessions = sessions.filter(s => {
    const typeMatch = (s.assistant_type || 'permit') === assistantType;
    const searchMatch = !searchQuery || s.title.toLowerCase().includes(searchQuery.toLowerCase());
    return typeMatch && searchMatch;
  });

  /* ─── Shared Sidebar Content ────────────────── */
  const SidebarInner = ({ isMobile = false }: { isMobile?: boolean }) => {
    const showLabels = isMobile || isExpanded;

    return (
      <div className="h-full flex flex-col bg-[var(--surface)]">
        {/* Search bar */}
        {isMobile ? (
          <div className="p-3 shrink-0">
            <div className="flex items-center gap-2.5 bg-[var(--surface-2)] rounded-full px-4 py-2.5 border border-[var(--border)]">
              <Search size={16} className="text-[var(--muted)] shrink-0" />
              <input
                type="text"
                placeholder="Search for chats"
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
          </div>
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
        <div className={`${isMobile ? 'px-3 mb-1' : 'px-4 mb-6'} shrink-0`}>
          <button
            onClick={() => { onNewChat(); if (isMobile) onMobileClose?.(); }}
            className={`group flex items-center justify-start gap-3 transition-all duration-300 ${
              isMobile
                ? 'w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)]'
                : `h-14 rounded-2xl bg-[var(--surface-1)] hover:bg-[var(--surface-2)] border border-[var(--border)] shadow-sm hover:shadow-md overflow-hidden ${isExpanded ? 'w-full px-5' : 'w-12 px-3.5'}`
            }`}
          >
            <Plus size={isMobile ? 20 : 22} className={isMobile ? "text-[var(--text)] shrink-0" : "text-indigo-500 shrink-0"} />
            {showLabels && (
              <span className="text-[15px] font-semibold text-[var(--text)] whitespace-nowrap">
                {isMobile ? 'New chat' : t('sidebar_new_chat')}
              </span>
            )}
          </button>
        </div>

        {/* My stuff (mobile Gemini style) */}
        {isMobile && (
          <div className="px-3 mb-1 shrink-0">
            <button className="group flex items-center gap-3 w-full px-4 py-3 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <Star size={20} className="text-[var(--text)] shrink-0" />
              <span className="text-[15px] font-medium text-[var(--text)]">My stuff</span>
            </button>
          </div>
        )}

        {/* Gems (mobile Gemini style) */}
        {isMobile && (
          <div className="px-3 mb-1 shrink-0">
            <button className="group flex items-center justify-between w-full px-4 py-2.5 rounded-xl hover:bg-[var(--surface-2)] transition-all">
              <span className="text-[15px] font-bold text-[var(--text)]">Gems</span>
              <ChevronRight size={16} className="text-[var(--muted)]" />
            </button>
          </div>
        )}

        {/* Chats heading */}
        {showLabels && (
          <h3 className="text-[13px] font-bold text-[var(--text)] opacity-70 px-7 mb-2 mt-3 shrink-0">
            {isMobile ? 'Chats' : (t('sidebar_recent') || 'Recent')}
          </h3>
        )}

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto px-3 space-y-0.5 slim-scroll pr-1">
          {!token && showLabels ? (
            <div className="mx-1 p-4 rounded-2xl bg-[var(--surface-2)]/60 border border-[var(--border)] space-y-3 mt-2">
              <p className="text-[13px] font-semibold text-[var(--text)]">Sign in to start saving your chats</p>
              <p className="text-[12px] text-[var(--muted)] leading-relaxed">Once you're signed in, you can access your recent chats here.</p>
              <Link href="/login">
                <button className="text-[var(--accent)] text-[13px] font-bold hover:underline">Sign in</button>
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
              <div
                key={s.id}
                className={`group relative flex items-center gap-3 p-3.5 rounded-xl transition-all cursor-pointer ${currentSessionId === s.id
                    ? 'bg-[var(--surface-1)] border border-[var(--border)] text-[var(--text)] shadow-sm'
                    : 'hover:bg-[var(--surface-2)]/50 text-[var(--text)] opacity-80 hover:opacity-100'
                  }`}
                onClick={() => {
                  onSessionSelect(s.id, s.title);
                  if (isMobile) onMobileClose?.();
                }}
                title={s.title}
              >
                {!showLabels && (
                  <MessageSquare size={18} className={currentSessionId === s.id ? "text-indigo-500" : "text-[var(--muted)]"} />
                )}
                {showLabels && (
                  <span className={`text-sm tracking-tight truncate flex-1 pr-6 ${currentSessionId === s.id ? 'font-bold' : 'font-medium opacity-90'}`}>{s.title}</span>
                )}
                {showLabels && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    className="absolute right-3 opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <MoreVertical size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {/* Bottom */}
        <div className="p-3 space-y-1 mt-auto border-t border-[var(--border)] bg-[var(--surface)]/50 shrink-0">
          {/* Settings & help */}
          <div className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all" title="Settings & help">
            <Settings size={18} className="text-[var(--muted)] group-hover:text-[var(--text)] transition-colors shrink-0" />
            {showLabels && (
              <span className="text-sm font-medium text-[var(--text)] opacity-70 group-hover:opacity-100">Settings &amp; help</span>
            )}
          </div>

          {/* Upgrade button */}
          <Link href="/pricing" className="block">
            <div className={`group flex items-center gap-3 p-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 cursor-pointer transition-all hover:bg-indigo-500/20 ${!showLabels ? 'justify-center' : ''}`}>
              <Zap size={18} className="text-indigo-600 shrink-0" fill="currentColor" />
              {showLabels && <span className="text-sm font-black text-indigo-600">Upgrade</span>}
            </div>
          </Link>

          {!isMobile && (
            <>
              {[
                { icon: HelpCircle, label: t('sidebar_help'), color: 'text-[var(--muted)]' },
                { icon: History, label: t('sidebar_activity'), color: 'text-[var(--muted)]' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="group flex items-center gap-3 p-3 rounded-full hover:bg-[var(--surface-2)] cursor-pointer transition-all"
                  title={item.label}
                >
                  <item.icon size={18} className={`${item.color} group-hover:text-[var(--text)] transition-colors`} />
                  {isExpanded && (
                    <span className="text-sm font-medium text-[var(--text)] opacity-70 group-hover:opacity-100">{item.label}</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ─── Desktop Sidebar (hidden on mobile) ─── */}
      <motion.aside
        initial={false}
        animate={{ width: isExpanded ? 280 : 68 }}
        className="hidden md:flex h-full flex-col shrink-0 transition-all duration-300 ease-in-out relative z-50 border-r border-[var(--border)] overflow-hidden"
      >
        <SidebarInner isMobile={false} />
      </motion.aside>

      {/* ─── Mobile Drawer Overlay ─── */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-[200] md:hidden"
              onClick={onMobileClose}
            />
            <motion.div
              key="mobile-drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed top-0 left-0 h-full w-[85vw] max-w-[340px] z-[210] md:hidden shadow-2xl overflow-hidden"
            >
              <SidebarInner isMobile={true} />
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
