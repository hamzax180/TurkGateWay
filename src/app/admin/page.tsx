'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import {
  Users, Search, ShieldCheck, BarChart3, MessageSquare,
  RefreshCw, Zap, TrendingUp, Database, BookOpen,
  ChevronRight, X, Trash2, Eye, GraduationCap, Scale,
  Building2, Star, CheckCircle2, XCircle, Clock, Filter,
  ArrowUpRight, Hash, Globe, ChevronLeft, ChevronDown, Headset, LifeBuoy, Coins, ArrowDownLeft,
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import TokensPanel from './TokensPanel';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';

// ── Types ──────────────────────────────────────────────────────────────────
interface Stats {
  total_users: number;
  premium_users: number;
  free_users: number;
  mrr: number;
  total_sessions: number;
  total_messages: number;
  sessions_by_type: { permit: number; student: number; lawyer: number; support: number };
}

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  subscription_status: string;
  subscription_reference_code: string | null;
  token_balance: number;
  is_admin: boolean;
  /** Spendable now — not consumed, not expired. This is what unlocks services. */
  credits: number;
  credits_spent: number;
}

interface SessionRow {
  id: string;
  title: string | null;
  assistant_type: string;
  service_id: string | null;
  service_slots: Record<string, string> | null;
  created_at: string | null;
  updated_at: string | null;
  is_favorite: boolean;
  message_count: number;
  user: { id: number; email: string; full_name: string; subscription_status: string } | null;
}

interface SessionDetail extends SessionRow {
  dashboard_state: any;
  language: string | null;
  messages: { id: number; role: string; content: string; timestamp: string | null }[];
  user: {
    id: number; email: string; full_name: string;
    subscription_status: string; token_balance: number;
  } | null;
}

type Tab = 'overview' | 'users' | 'sessions' | 'tickets' | 'tokens';

type TicketRow = {
  id: number; ref: string; session_id: string; subject: string;
  status: string; priority: string; category: string;
  agent: string | null; language: string | null;
  created_at: string | null; last_message_at: string | null;
  first_response_at: string | null; resolved_at: string | null;
  rating: number | null; internal_note: string | null;
  user_email: string | null; message_count: number;
};

type TicketStats = {
  open: number; pending: number; resolved: number; closed: number;
  total: number; last24h: number; avgFirstResponseSeconds: number;
};

type TicketDetail = {
  ticket: TicketRow & { user_name: string | null };
  messages: { id: number; role: string; content: string; timestamp: string | null }[];
};

const TICKET_STATUS_STYLE: Record<string, string> = {
  open: 'bg-red-500/10 text-red-400 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  resolved: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  closed: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

const TICKET_PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  normal: 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]',
  low: 'bg-[var(--surface-2)] text-[var(--muted)] border-[var(--border)]',
};

/** "4m 12s" reads faster than 252 at a glance in an ops table. */
function fmtDuration(seconds: number) {
  if (!seconds) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  if (m < 60) return `${m}m ${rem}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    free: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    past_due: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    canceled: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const cls = map[status] ?? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${cls}`}>
      {status}
    </span>
  );
}

function typeBadge(type: string) {
  if (type === 'support') return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
      <Headset size={10} /> Support
    </span>
  );
  if (type === 'student') return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
      <GraduationCap size={10} /> Student
    </span>
  );
  if (type === 'lawyer') return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
      <Scale size={10} /> Lawyer
    </span>
  );
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
      <Building2 size={10} /> Business Agent
    </span>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function avatar(name: string | null, email: string) {
  return (name?.charAt(0) || email.charAt(0)).toUpperCase();
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function AdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');

  // Data
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [ticketsTotal, setTicketsTotal] = useState(0);
  const [ticketStats, setTicketStats] = useState<TicketStats | null>(null);
  const [ticketStatus, setTicketStatus] = useState('all');
  const [ticketPriority, setTicketPriority] = useState('all');
  const [ticketSearch, setTicketSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [sessionModalLoading, setSessionModalLoading] = useState(false);

  // Filters
  const [userSearch, setUserSearch] = useState('');
  const [userFilter, setUserFilter] = useState('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionType, setSessionType] = useState('all');
  const [sessionPage, setSessionPage] = useState(0);
  const SESSION_PAGE_SIZE = 30;

  // Action feedback
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const token = () => localStorage.getItem('permitops_token');

  const loadStats = useCallback(async () => {
    const res = await apiFetch(`/api/admin/stats`);
    if (res?.ok) setStats(await res.json());
  }, []);

  useEffect(() => {
    const init = async () => {
      const t = token();
      if (!t) { router.push('/login'); return; }
      const res = await apiFetch(`/api/admin/subscribers`);
      if (!res || res.status === 403) { router.push('/applications'); return; }
      if (!res.ok) { router.push('/login'); return; }
      const data = await res.json();
      setUsers(data);
      setAuthorized(true);
      setLoading(false);
      loadStats();
    };
    init();
  }, []);

  const loadSessions = useCallback(async () => {
    const params = new URLSearchParams();
    params.set('skip', String(sessionPage * SESSION_PAGE_SIZE));
    params.set('limit', String(SESSION_PAGE_SIZE));
    if (sessionType !== 'all') params.set('assistant_type', sessionType);
    if (sessionSearch.trim()) params.set('search', sessionSearch.trim());
    const res = await apiFetch(`/api/admin/sessions?${params}`);
    if (res?.ok) {
      const d = await res.json();
      setSessions(d.sessions);
      setSessionsTotal(d.total);
    }
  }, [sessionPage, sessionType, sessionSearch]);

  useEffect(() => {
    if (tab === 'sessions') loadSessions();
  }, [tab, sessionPage, sessionType]);

  const loadTickets = useCallback(async () => {
    const params = new URLSearchParams();
    if (ticketStatus !== 'all') params.set('status', ticketStatus);
    if (ticketPriority !== 'all') params.set('priority', ticketPriority);
    if (ticketSearch.trim()) params.set('search', ticketSearch.trim());
    const res = await apiFetch(`/api/admin/tickets?${params}`);
    if (res?.ok) {
      const d = await res.json();
      setTickets(d.tickets);
      setTicketsTotal(d.total);
      setTicketStats(d.stats);
    }
  }, [ticketStatus, ticketPriority, ticketSearch]);

  useEffect(() => {
    if (tab === 'tickets') loadTickets();
  }, [tab, ticketStatus, ticketPriority]);


  const openTicket = async (id: number) => {
    const res = await apiFetch(`/api/admin/tickets/${id}`);
    if (res?.ok) setSelectedTicket(await res.json());
  };

  /** Optimistic — the row updates immediately, the list refreshes behind it. */
  const patchTicket = async (id: number, patch: Record<string, string>) => {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
    setSelectedTicket(prev =>
      prev && prev.ticket.id === id ? { ...prev, ticket: { ...prev.ticket, ...patch } } : prev,
    );
    await apiFetch(`/api/admin/tickets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    loadTickets();
  };

  const refreshAll = async () => {
    setLoading(true);
    const res = await apiFetch(`/api/admin/subscribers`);
    if (res?.ok) setUsers(await res.json());
    await loadStats();
    if (tab === 'sessions') await loadSessions();
    if (tab === 'tickets') await loadTickets();
    setLoading(false);
  };

  // ── User actions ────────────────────────────────────────────────────────
  const upgradeUser = async (id: number) => {
    setActionLoading(id);
    const res = await apiFetch(`/api/admin/users/${id}/upgrade`, { method: 'POST' });
    if (res?.ok) {
      // Take the balances from the SERVER's reply rather than assuming them.
      // The row used to be hand-patched with a status and 100 questions, which
      // silently left the credits the upgrade had just granted off the screen —
      // the grant worked, it simply was not shown, which looked identical to it
      // not happening.
      const body = await res.json().catch(() => null);
      setUsers(prev =>
        prev.map(u =>
          u.id === id
            ? {
                ...u,
                subscription_status: 'active',
                token_balance: 100,
                credits: Number(body?.credits_available ?? u.credits ?? 0),
              }
            : u,
        ),
      );
      loadStats();
    }
    setActionLoading(null);
  };

  const downgradeUser = async (id: number) => {
    setActionLoading(id);
    const res = await apiFetch(`/api/admin/users/${id}/downgrade`, { method: 'POST' });
    if (res?.ok) {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, subscription_status: 'canceled' } : u));
      loadStats();
    }
    setActionLoading(null);
  };

  // ── Session actions ─────────────────────────────────────────────────────
  const openSession = async (id: string) => {
    setSessionModalLoading(true);
    setSelectedSession(null);
    const res = await apiFetch(`/api/admin/sessions/${id}`);
    if (res?.ok) setSelectedSession(await res.json());
    setSessionModalLoading(false);
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this session permanently?')) return;
    const res = await apiFetch(`/api/admin/sessions/${id}`, { method: 'DELETE' });
    if (res?.ok) {
      setSessions(prev => prev.filter(s => s.id !== id));
      setSessionsTotal(t => t - 1);
      if (selectedSession?.id === id) setSelectedSession(null);
    }
  };

  // ── Filtered users ──────────────────────────────────────────────────────
  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    const match = u.email?.toLowerCase().includes(q) || u.full_name?.toLowerCase().includes(q);
    if (userFilter === 'active') return match && u.subscription_status === 'active';
    if (userFilter === 'free') return match && u.subscription_status === 'free';
    if (userFilter === 'other') return match && !['active', 'free'].includes(u.subscription_status);
    return match;
  });

  // ── Loading / Auth guard ────────────────────────────────────────────────
  if (loading && !authorized) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <RefreshCw className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] relative overflow-x-hidden">
      <Navbar />
      <MobileMenuButton />

      {/* Background */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20 dark:opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/20 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/20 blur-[120px] animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative z-10 pt-24 pb-20 px-4 md:px-8 max-w-7xl mx-auto">

        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <ShieldCheck size={20} className="text-indigo-500" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Admin Panel</h1>
              <p className="text-[var(--muted)] text-xs font-medium">Agency management & oversight</p>
            </div>
          </div>
          <button onClick={refreshAll}
            className="h-9 w-9 btn btn-outline !p-0 flex items-center justify-center !rounded-xl self-start md:self-auto">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </header>

        {/* Tab Nav */}
        <div className="flex gap-1 mb-8 border-b border-[var(--border)] pb-0">
          {([
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'tickets', label: 'Tickets', icon: LifeBuoy },
            { id: 'sessions', label: 'Sessions', icon: MessageSquare },
            { id: 'tokens', label: 'Credits', icon: Coins },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-bold transition-all border-b-2 -mb-px ${
                tab === id
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB: OVERVIEW ─────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-8">
            {/* Stats grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: 'Total Users', value: stats?.total_users ?? '—', icon: Users, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20' },
                { label: 'Premium', value: stats?.premium_users ?? '—', icon: Star, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
                { label: 'Free', value: stats?.free_users ?? '—', icon: Globe, color: 'text-gray-400', bg: 'bg-gray-500/10 border-gray-500/20' },
                { label: 'MRR', value: stats ? `₺${stats.mrr}` : '—', icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
                { label: 'Sessions', value: stats?.total_sessions ?? '—', icon: MessageSquare, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
                { label: 'Messages', value: stats?.total_messages ?? '—', icon: Database, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className={`glass-card p-4 border ${bg}`}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">{label}</p>
                    <Icon size={14} className={color} />
                  </div>
                  <p className={`text-2xl font-black ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Sessions by type */}
            {stats && (
              <div className="glass-card p-6">
                <h2 className="text-sm font-black mb-6 uppercase tracking-widest text-[var(--muted)]">Sessions by Agent Type</h2>
                <div className="space-y-4">
                  {([
                    { label: 'Business Agent', key: 'permit', color: 'bg-blue-500', textColor: 'text-blue-400' },
                    { label: 'Student', key: 'student', color: 'bg-emerald-500', textColor: 'text-emerald-400' },
                    { label: 'Lawyer / Legal', key: 'lawyer', color: 'bg-amber-500', textColor: 'text-amber-400' },
                    { label: 'Support', key: 'support', color: 'bg-red-500', textColor: 'text-red-400' },
                  ] as const).map(({ label, key, color, textColor }) => {
                    const count = stats.sessions_by_type[key];
                    const pct = stats.total_sessions > 0 ? Math.round((count / stats.total_sessions) * 100) : 0;
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-semibold">{label}</span>
                          <span className={`text-sm font-black ${textColor}`}>{count} <span className="text-[var(--muted)] font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            className={`h-full rounded-full ${color}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Recent users preview */}
            <div className="glass-card overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <h2 className="text-sm font-black uppercase tracking-widest text-[var(--muted)]">Recent Users</h2>
                <button onClick={() => setTab('users')} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-semibold">
                  View all <ArrowUpRight size={12} />
                </button>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {users.slice(0, 5).map(u => (
                  <div key={u.id} className="px-6 py-3 flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                      {avatar(u.full_name, u.email)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{u.full_name || u.email}</p>
                      <p className="text-xs text-[var(--muted)] truncate">{u.email}</p>
                    </div>
                    {statusBadge(u.subscription_status)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: USERS ────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-5">
            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-sm group">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {['all', 'active', 'free', 'other'].map(f => (
                  <button
                    key={f}
                    onClick={() => setUserFilter(f)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      userFilter === f
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <span className="text-xs text-[var(--muted)] self-center ml-auto shrink-0">
                {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                      {['User', 'Status', 'Free questions', 'Credits', 'Reference', 'Actions'].map(h => (
                        <th key={h} className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-[var(--muted)] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-16 text-center text-[var(--muted)] text-sm">
                          No users match your filter.
                        </td>
                      </tr>
                    ) : filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {avatar(u.full_name, u.email)}
                            </div>
                            <div>
                              <p className="font-semibold text-sm flex items-center gap-1">
                                {u.full_name || 'Unnamed'}
                                {u.is_admin && <Zap size={10} className="text-amber-400" fill="currentColor" />}
                              </p>
                              <p className="text-xs text-[var(--muted)]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">{statusBadge(u.subscription_status)}</td>
                        <td className="px-5 py-4">
                          <span className="text-sm font-bold">{u.token_balance ?? '—'}</span>
                        </td>
                        {/* Credits, not questions. An account can hold 100
                            questions and still be unable to start a placement —
                            only this number unlocks the paid services, so it
                            sits beside the other balance rather than replacing
                            it. Zero is called out because it is the state that
                            makes every paid feature refuse. */}
                        <td className="px-5 py-4">
                          <span
                            className={`text-sm font-bold ${
                              Number(u.credits ?? 0) > 0 ? 'text-emerald-500' : 'text-[var(--muted)]'
                            }`}
                          >
                            {Number(u.credits ?? 0)}
                          </span>
                          {Number(u.credits_spent ?? 0) > 0 && (
                            <span className="text-[11px] text-[var(--muted)]">
                              {' '}· {Number(u.credits_spent)} used
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <code className="text-[11px] font-mono text-[var(--muted)] bg-[var(--surface-2)] px-2 py-0.5 rounded">
                            {u.subscription_reference_code || 'N/A'}
                          </code>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            {u.subscription_status !== 'active' ? (
                              <button
                                onClick={() => upgradeUser(u.id)}
                                disabled={actionLoading === u.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                              >
                                {actionLoading === u.id ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                                Upgrade
                              </button>
                            ) : (
                              <button
                                onClick={() => downgradeUser(u.id)}
                                disabled={actionLoading === u.id}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all disabled:opacity-50"
                              >
                                {actionLoading === u.id ? <RefreshCw size={11} className="animate-spin" /> : <XCircle size={11} />}
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: SESSIONS ─────────────────────────────────────────────── */}
        {/* ── TAB: TICKETS ──────────────────────────────────────────────── */}
        {tab === 'tickets' && (
          <div className="space-y-5">
            {/* Headline numbers — what an operator checks before anything else */}
            {ticketStats && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Open', value: ticketStats.open, tone: 'text-red-400' },
                  { label: 'Pending', value: ticketStats.pending, tone: 'text-amber-400' },
                  { label: 'Resolved', value: ticketStats.resolved, tone: 'text-emerald-400' },
                  { label: 'Last 24h', value: ticketStats.last24h, tone: 'text-[var(--text)]' },
                  {
                    label: 'Avg 1st reply',
                    value: fmtDuration(ticketStats.avgFirstResponseSeconds),
                    tone: 'text-[var(--text)]',
                  },
                ].map(card => (
                  <div key={card.label} className="glass-card p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">{card.label}</p>
                    <p className={`mt-1 text-2xl font-black ${card.tone}`}>{card.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={ticketSearch}
                  onChange={e => setTicketSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadTickets()}
                  placeholder="Search subject or TG-1042…"
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {(['all', 'open', 'pending', 'resolved', 'closed'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setTicketStatus(st)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      ticketStatus === st
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40'
                    }`}
                  >
                    {st.charAt(0).toUpperCase() + st.slice(1)}
                  </button>
                ))}
              </div>
              <select
                value={ticketPriority}
                onChange={e => setTicketPriority(e.target.value)}
                className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2 text-xs font-bold text-[var(--muted)] outline-none"
              >
                {['all', 'urgent', 'high', 'normal', 'low'].map(pr => (
                  <option key={pr} value={pr}>{pr === 'all' ? 'Any priority' : pr}</option>
                ))}
              </select>
              <span className="text-xs text-[var(--muted)] self-center ml-auto shrink-0">
                {ticketsTotal} ticket{ticketsTotal !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                      {['Ref', 'Subject', 'Customer', 'Agent', 'Priority', 'Status', 'Activity', ''].map(h => (
                        <th key={h} className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-[var(--muted)] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tickets.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-10 text-center text-sm text-[var(--muted)]">
                          No tickets yet. One opens whenever a customer starts a live chat.
                        </td>
                      </tr>
                    )}
                    {tickets.map(tk => (
                      <tr key={tk.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]/50 transition-colors">
                        <td className="px-5 py-3.5 text-xs font-black tabular-nums text-[var(--text)] whitespace-nowrap">{tk.ref}</td>
                        <td className="px-5 py-3.5 max-w-xs">
                          <p className="text-sm font-bold text-[var(--text)] truncate">{tk.subject}</p>
                          <p className="text-[11px] text-[var(--muted)]">{tk.category} · {tk.message_count} msg</p>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-[var(--muted)] whitespace-nowrap">{tk.user_email ?? 'Guest'}</td>
                        <td className="px-5 py-3.5 text-xs text-[var(--muted)] whitespace-nowrap">{tk.agent ?? '—'}</td>
                        <td className="px-5 py-3.5">
                          <span className={`badge border ${TICKET_PRIORITY_STYLE[tk.priority] ?? ''}`}>{tk.priority}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <select
                            value={tk.status}
                            onChange={e => patchTicket(tk.id, { status: e.target.value })}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold outline-none cursor-pointer ${TICKET_STATUS_STYLE[tk.status] ?? ''}`}
                          >
                            {['open', 'pending', 'resolved', 'closed'].map(st => (
                              <option key={st} value={st}>{st}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-[var(--muted)] whitespace-nowrap">{fmtDate(tk.last_message_at)}</td>
                        <td className="px-5 py-3.5">
                          <button
                            onClick={() => openTicket(tk.id)}
                            className="btn btn-outline !py-1.5 !px-3 !text-[11px]"
                          >
                            <Eye size={13} /> Open
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'tokens' && <TokensPanel />}

        {tab === 'sessions' && (
          <div className="space-y-5">
            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1 max-w-sm group">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                <input
                  value={sessionSearch}
                  onChange={e => { setSessionSearch(e.target.value); setSessionPage(0); }}
                  onKeyDown={e => e.key === 'Enter' && loadSessions()}
                  placeholder="Search title, user, email…"
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                {(['all', 'permit', 'student', 'lawyer', 'support'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => { setSessionType(t); setSessionPage(0); }}
                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                      sessionType === t
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40'
                    }`}
                  >
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              <button onClick={loadSessions} className="px-3 py-2 rounded-xl text-xs font-bold bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40 transition-all">
                <Search size={14} />
              </button>
              <span className="text-xs text-[var(--muted)] self-center ml-auto shrink-0">
                {sessionsTotal} session{sessionsTotal !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div className="glass-card overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                      {['Session', 'Type', 'User', 'Messages', 'Updated', 'Actions'].map(h => (
                        <th key={h} className="px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-[var(--muted)] whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-16 text-center text-[var(--muted)] text-sm">
                          No sessions found.
                        </td>
                      </tr>
                    ) : sessions.map(s => (
                      <tr key={s.id} className="hover:bg-white/5 transition-colors">
                        <td className="px-5 py-4 max-w-[220px]">
                          <p className="font-semibold text-sm truncate">{s.title || 'Untitled'}</p>
                          <p className="text-[10px] font-mono text-[var(--muted)] truncate">{s.id}</p>
                          {s.service_id && (
                            <p className="text-[10px] text-indigo-400/60 truncate">{s.service_id}</p>
                          )}
                        </td>
                        <td className="px-5 py-4">{typeBadge(s.assistant_type)}</td>
                        <td className="px-5 py-4">
                          {s.user ? (
                            <div>
                              <p className="text-sm font-semibold truncate max-w-[150px]">{s.user.full_name || s.user.email}</p>
                              <p className="text-xs text-[var(--muted)] truncate max-w-[150px]">{s.user.email}</p>
                            </div>
                          ) : <span className="text-xs text-[var(--muted)]">Guest</span>}
                        </td>
                        <td className="px-5 py-4">
                          <span className="text-sm font-bold">{s.message_count}</span>
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          <span className="text-xs text-[var(--muted)]">{fmtDate(s.updated_at)}</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openSession(s.id)}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                              title="View session"
                            >
                              <Eye size={14} />
                            </button>
                            <button
                              onClick={() => deleteSession(s.id)}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                              title="Delete session"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pagination */}
            {sessionsTotal > SESSION_PAGE_SIZE && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSessionPage(p => Math.max(0, p - 1))}
                  disabled={sessionPage === 0}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40 disabled:opacity-40 transition-all"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span className="text-xs text-[var(--muted)]">
                  Page {sessionPage + 1} of {Math.ceil(sessionsTotal / SESSION_PAGE_SIZE)}
                </span>
                <button
                  onClick={() => setSessionPage(p => p + 1)}
                  disabled={(sessionPage + 1) * SESSION_PAGE_SIZE >= sessionsTotal}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-[var(--surface)] border border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40 disabled:opacity-40 transition-all"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Session Detail Modal ──────────────────────────────────────────── */}
      <AnimatePresence>
        {(selectedSession || sessionModalLoading) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) { setSelectedSession(null); } }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 260 }}
              className="relative h-full w-full max-w-2xl bg-[var(--bg)] border-l border-[var(--border)] overflow-hidden flex flex-col"
            >
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
                <div>
                  <p className="font-black text-sm">{selectedSession?.title || 'Session Detail'}</p>
                  {selectedSession && (
                    <p className="text-[10px] font-mono text-[var(--muted)]">{selectedSession.id}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedSession && (
                    <button
                      onClick={() => deleteSession(selectedSession.id)}
                      className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 transition-all"
                      title="Delete session"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedSession(null)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-all"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {sessionModalLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <RefreshCw className="animate-spin text-indigo-400" size={28} />
                </div>
              ) : selectedSession && (
                <div className="flex-1 overflow-y-auto">
                  {/* Meta */}
                  <div className="px-6 py-5 border-b border-[var(--border)] space-y-4">
                    <div className="flex flex-wrap gap-2 items-center">
                      {typeBadge(selectedSession.assistant_type)}
                      {statusBadge(selectedSession.user?.subscription_status ?? 'free')}
                      {selectedSession.is_favorite && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          <Star size={10} fill="currentColor" /> Favourite
                        </span>
                      )}
                      {selectedSession.language && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                          <Globe size={10} /> {selectedSession.language.toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* User info */}
                    {selectedSession.user && (
                      <div className="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {avatar(selectedSession.user.full_name, selectedSession.user.email)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm">{selectedSession.user.full_name || 'Unnamed'}</p>
                          <p className="text-xs text-[var(--muted)]">{selectedSession.user.email}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs text-[var(--muted)]">Free questions</p>
                          <p className="text-sm font-black">{selectedSession.user.token_balance}</p>
                        </div>
                      </div>
                    )}

                    {/* Service slots */}
                    {selectedSession.service_slots && Object.keys(selectedSession.service_slots).length > 0 && (
                      <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)] mb-2">Service Context</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedSession.service_slots)
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                              <span key={k} className="text-xs px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                                <span className="text-[var(--muted)] font-normal">{k}:</span> {v}
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Workflow summary */}
                    {selectedSession.dashboard_state?.combined_result && (
                      <div className="p-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
                        <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)] mb-2">Workflow Summary</p>
                        <p className="text-xs text-[var(--text)] leading-relaxed">
                          {selectedSession.dashboard_state.combined_result.summary || '—'}
                        </p>
                        {selectedSession.dashboard_state.combined_result.timeline_days && (
                          <p className="text-xs text-amber-400 mt-1 font-semibold">
                            <Clock size={10} className="inline mr-1" />
                            Est. {selectedSession.dashboard_state.combined_result.timeline_days} days
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex gap-4 text-xs text-[var(--muted)]">
                      <span><span className="font-bold text-[var(--text)]">{selectedSession.messages.length}</span> messages</span>
                      <span>Created {fmtDate(selectedSession.created_at)}</span>
                      <span>Updated {fmtDate(selectedSession.updated_at)}</span>
                    </div>
                  </div>

                  {/* Chat transcript */}
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">Chat Transcript</p>
                    {selectedSession.messages.length === 0 ? (
                      <p className="text-sm text-[var(--muted)]">No messages.</p>
                    ) : selectedSession.messages.map(m => (
                      <div
                        key={m.id}
                        className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                      >
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                          m.role === 'user'
                            ? 'bg-indigo-500 text-white'
                            : 'bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--border)]'
                        }`}>
                          {m.role === 'user' ? 'U' : 'AI'}
                        </div>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-indigo-600/20 border border-indigo-500/20 text-[var(--text)]'
                            : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]'
                        }`}>
                          <div className="prose prose-sm prose-invert max-w-none text-inherit [&_p]:mb-1 [&_ul]:pl-4 [&_li]:mb-0.5">
                            <ReactMarkdown>{m.content}</ReactMarkdown>
                          </div>
                          {m.timestamp && (
                            <p className="text-[10px] text-[var(--muted)] mt-1">{fmtDate(m.timestamp)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Ticket detail drawer ──────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedTicket && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex justify-end"
            onClick={() => setSelectedTicket(null)}
          >
            <motion.div
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-2xl h-full bg-[var(--bg)] border-l border-[var(--border)] overflow-y-auto slim-scroll"
            >
              {/* Header */}
              <div className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black tabular-nums text-[var(--muted)]">{selectedTicket.ticket.ref}</span>
                      <span className={`badge border ${TICKET_STATUS_STYLE[selectedTicket.ticket.status] ?? ''}`}>
                        {selectedTicket.ticket.status}
                      </span>
                      <span className={`badge border ${TICKET_PRIORITY_STYLE[selectedTicket.ticket.priority] ?? ''}`}>
                        {selectedTicket.ticket.priority}
                      </span>
                    </div>
                    <h3 className="mt-2 text-lg font-black text-[var(--text)] truncate">{selectedTicket.ticket.subject}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {selectedTicket.ticket.user_email ?? 'Guest'}
                      {selectedTicket.ticket.agent ? ` · handled by ${selectedTicket.ticket.agent}` : ''}
                      {selectedTicket.ticket.language ? ` · ${selectedTicket.ticket.language}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="h-8 w-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] shrink-0"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Operator controls */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(['open', 'pending', 'resolved', 'closed'] as const).map(st => (
                    <button
                      key={st}
                      onClick={() => patchTicket(selectedTicket.ticket.id, { status: st })}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                        selectedTicket.ticket.status === st
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                  <select
                    value={selectedTicket.ticket.priority}
                    onChange={e => patchTicket(selectedTicket.ticket.id, { priority: e.target.value })}
                    className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-[var(--muted)] outline-none cursor-pointer"
                  >
                    {['urgent', 'high', 'normal', 'low'].map(pr => (
                      <option key={pr} value={pr}>{pr}</option>
                    ))}
                  </select>
                </div>

                {/* Service levels — the numbers a support lead is judged on */}
                <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-[var(--muted)]">
                  <span>Opened {fmtDate(selectedTicket.ticket.created_at)}</span>
                  <span>
                    First reply{' '}
                    {selectedTicket.ticket.first_response_at && selectedTicket.ticket.created_at
                      ? fmtDuration(
                          (new Date(selectedTicket.ticket.first_response_at).getTime() -
                            new Date(selectedTicket.ticket.created_at).getTime()) / 1000,
                        )
                      : '—'}
                  </span>
                  <span>{selectedTicket.messages.length} messages</span>
                </div>
              </div>

              {/* Transcript */}
              <div className="px-6 py-5 space-y-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">Transcript</p>
                {selectedTicket.messages.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">No messages recorded.</p>
                ) : selectedTicket.messages.map(m => (
                  <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                      m.role === 'user'
                        ? 'bg-indigo-500 text-white'
                        : 'bg-red-500/15 text-red-400 border border-red-500/25'
                    }`}>
                      {m.role === 'user' ? 'U' : 'CS'}
                    </div>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      m.role === 'user'
                        ? 'bg-indigo-600/20 border border-indigo-500/20 text-[var(--text)]'
                        : 'bg-[var(--surface)] border border-[var(--border)] text-[var(--text)]'
                    }`}>
                      <div className="prose prose-sm prose-invert max-w-none text-inherit [&_p]:mb-1 [&_ul]:pl-4 [&_li]:mb-0.5">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                      {m.timestamp && <p className="text-[10px] text-[var(--muted)] mt-1">{fmtDate(m.timestamp)}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Internal note — never shown to the customer */}
              <div className="px-6 pb-8">
                <p className="text-[10px] font-black uppercase tracking-widest text-[var(--muted)] mb-2">Internal note</p>
                <textarea
                  defaultValue={selectedTicket.ticket.internal_note ?? ''}
                  onBlur={e => patchTicket(selectedTicket.ticket.id, { internal_note: e.target.value })}
                  rows={3}
                  placeholder="Only visible to operators…"
                  className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
