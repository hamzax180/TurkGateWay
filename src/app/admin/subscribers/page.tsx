'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Users, Search, ShieldCheck, Mail, User, 
  ArrowLeft, RefreshCw, Star, AlertCircle, Ban, 
  CheckCircle2, Filter, Download, ExternalLink, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '../../utils/api';
import Navbar from '../../components/Navbar';

interface Subscriber {
  id: number;
  email: string;
  full_name: string;
  subscription_status: string;
  subscription_reference_code: string | null;
  is_admin: boolean;
}

export default function AdminSubscribersPage() {
  const router = useRouter();
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('permitops_token');
        if (!token) {
          router.push('/login');
          return;
        }

        const res = await apiFetch(`/admin/subscribers?token=${token}`);
        if (res && res.ok) {
          const data = await res.json();
          setSubscribers(data);
          setAuthorized(true);
        } else if (res?.status === 403) {
          router.push('/dashboard');
        } else {
          router.push('/login');
        }
      } catch (e) {
        console.error("Auth check failed", e);
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [router]);

  const refreshData = async () => {
    setLoading(true);
    const token = localStorage.getItem('permitops_token');
    const res = await apiFetch(`/admin/subscribers?token=${token}`);
    if (res && res.ok) {
      setSubscribers(await res.json());
    }
    setLoading(false);
  };

  const filteredSubscribers = subscribers.filter(s => {
    const matchesSearch = (s.email?.toLowerCase().includes(search.toLowerCase()) || 
                           s.full_name?.toLowerCase().includes(search.toLowerCase()));
    
    if (filter === 'all') return matchesSearch;
    if (filter === 'active') return matchesSearch && s.subscription_status === 'active';
    if (filter === 'free') return matchesSearch && s.subscription_status === 'free';
    if (filter === 'other') return matchesSearch && !['active', 'free'].includes(s.subscription_status);
    return matchesSearch;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">Active</span>;
      case 'free':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-gray-500/10 text-gray-400 border border-gray-500/20">Free</span>;
      case 'past_due':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">Past Due</span>;
      case 'canceled':
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-500/10 text-red-500 border border-red-500/20">Canceled</span>;
      default:
        return <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">{status}</span>;
    }
  };

  if (loading && !authorized) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <RefreshCw className="animate-spin text-purple-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] relative overflow-hidden">
      <Navbar />
      
      {/* Background Mesh */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20 dark:opacity-40">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-600/20 blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/20 blur-[120px] animate-pulse [animation-delay:2s]" />
      </div>

      <div className="relative z-10 pt-28 pb-20 px-6 max-w-7xl mx-auto">
        <header className="mb-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                  <ShieldCheck size={20} className="text-indigo-500" />
                </div>
                <h1 className="text-3xl font-black tracking-tight">Admin Console</h1>
              </div>
              <p className="text-[var(--muted)] font-medium">Manage and monitor all platform subscribers</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="glass-card flex items-center gap-3 px-4 py-2">
                 <div className="text-right">
                    <p className="text-[10px] text-[var(--muted)] font-black uppercase tracking-widest">Total Recurring</p>
                    <p className="text-xl font-black text-emerald-500">₺{subscribers.filter(s => s.subscription_status === 'active').length * 299}</p>
                 </div>
                 <div className="h-8 w-px bg-[var(--border)]" />
                 <div className="text-right">
                    <p className="text-[10px] text-[var(--muted)] font-black uppercase tracking-widest">Premium Users</p>
                    <p className="text-xl font-black text-indigo-500">{subscribers.filter(s => s.subscription_status === 'active').length}</p>
                 </div>
              </div>
              <button 
                onClick={refreshData}
                className="h-10 w-10 btn btn-outline !p-0 flex items-center justify-center !rounded-xl"
              >
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)] group-focus-within:text-indigo-500 transition-colors" size={18} />
              <input 
                type="text" 
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-2xl pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-indigo-500 transition-all outline-none shadow-sm"
              />
            </div>

            <div className="flex items-center gap-3 overflow-x-auto pb-2 lg:pb-0">
               <button 
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'all' ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-indigo-500/40'}`}
               >
                 All Users
               </button>
               <button 
                onClick={() => setFilter('active')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'active' ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-emerald-500/40'}`}
               >
                 Active
               </button>
               <button 
                onClick={() => setFilter('free')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'free' ? 'bg-gray-700 text-white border-gray-700 shadow-lg' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-gray-500/40'}`}
               >
                 Free
               </button>
               <button 
                onClick={() => setFilter('other')}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filter === 'other' ? 'bg-amber-600 text-white border-amber-600 shadow-lg' : 'bg-[var(--surface)] border-[var(--border)] text-[var(--muted)] hover:border-amber-500/40'}`}
               >
                 Other
               </button>
            </div>
          </div>

          {/* Table */}
          <div className="glass-card overflow-hidden shadow-2xl border-[var(--border)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">User</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">Status</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--muted)]">Reference Code</th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[var(--muted)] text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredSubscribers.length > 0 ? (
                    filteredSubscribers.map((s) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        key={s.id} 
                        className="hover:bg-white/5 dark:hover:bg-white/[0.02] transition-colors group"
                      >
                        <td className="px-6 py-5">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-xs shadow-md">
                              {s.full_name?.charAt(0) || s.email.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-sm flex items-center gap-1.5">
                                {s.full_name || 'Unnamed User'}
                                {s.is_admin && <Zap size={10} className="text-amber-500" fill="currentColor" />}
                              </p>
                              <p className="text-xs text-[var(--muted)] font-medium">{s.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-5">
                          {getStatusBadge(s.subscription_status)}
                        </td>
                        <td className="px-6 py-5">
                          <code className="text-[11px] font-mono text-[var(--muted)] bg-[var(--surface-2)] px-2 py-1 rounded">
                            {s.subscription_reference_code || 'N/A'}
                          </code>
                        </td>
                        <td className="px-6 py-5 text-right">
                          <button className="h-8 w-8 rounded-lg flex items-center justify-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-all ml-auto">
                            <ExternalLink size={14} />
                          </button>
                        </td>
                      </motion.tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-20 text-center">
                        <div className="flex flex-col items-center gap-3 text-[var(--muted)]">
                          <Search size={32} className="opacity-20" />
                          <p className="font-medium">No subscribers found matching your search.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
