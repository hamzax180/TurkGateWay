'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Menu, X, FileCheck, Sun, Moon, ShieldCheck } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import Sidebar from './Sidebar';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ isAppPage = false, onMobileMenuClick, extraContent }: { isAppPage?: boolean; onMobileMenuClick?: () => void; extraContent?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, token, logout, isAuthenticated, setIsLoginModalOpen } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Self-contained admin check — doesn't rely on AuthContext async propagation
  useEffect(() => {
    const checkAdmin = async () => {
      const token = localStorage.getItem('permitops_token');
      if (!token) { setIsAdmin(false); return; }
      // Check localStorage first for instant render
      if (localStorage.getItem('permitops_is_admin') === 'true') {
        setIsAdmin(true);
      }
      // Always sync from backend to get the real-time value
      try {
        const res = await fetch(`http://localhost:8003/auth/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          const admin = !!data.is_admin;
          localStorage.setItem('permitops_is_admin', admin ? 'true' : 'false');
          setIsAdmin(admin);
        }
      } catch {
        // backend offline — keep localStorage value
      }
    };
    checkAdmin();
  }, [isAuthenticated]); // re-run when login/logout state changes

  const { t, isRTL } = useLanguage();

  const links = [
    { href: '/', label: t('navbar_home') },
    { href: '/chat', label: t('navbar_chat') },
    { href: '/services', label: t('navbar_services') || 'Services' },
    { href: '/dashboard', label: t('navbar_dashboard') },
    { href: '/pricing', label: t('navbar_pricing') },
    ...(isAdmin ? [{ href: '/admin/subscribers', label: t('navbar_subscribers') }] : []),
    { href: '/download', label: t('navbar_download') === 'navbar_download' ? 'Download App' : t('navbar_download') || 'Download App' },
  ];


  return (
    <>
    <header
      className={`${isAppPage ? 'relative z-[20] w-full shrink-0 bg-[var(--surface)] border-b border-[var(--border)]/50' : 'fixed inset-x-0 top-0 z-[100] transition-all duration-300'} ${(isAppPage || scrolled) 
          ? 'bg-[var(--nav-bg)] backdrop-blur-xl border-b border-[var(--border)] shadow-2xl' 
          : 'bg-transparent'
        }`}
    >
      <div className="w-full px-4 md:px-12 h-16 flex items-center justify-between">
        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
          onClick={() => {
            if (onMobileMenuClick) onMobileMenuClick();
            else setOpen(!open);
          }}
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Logo removed */}

        {/* Desktop Nav - Left Aligned */}
        <div className="flex items-center gap-8">
          <nav className="hidden md:flex items-center gap-1">
            {links.map(({ href, label }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${active ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
                    }`}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg bg-[var(--surface-2)]"
                      transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <span className="relative">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Center Slot for App Navigation/Tools - Screen Centered */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:flex items-center justify-center z-40">
          {extraContent}
        </div>

        <div className="hidden md:flex items-center gap-3 relative z-50">
          {isAuthenticated ? (
            <>
              {user?.subscriptionStatus === 'free' ? (
                <Link 
                  href="/pricing"
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/5 border border-blue-500/20 text-blue-400/80 text-[11px] font-medium transition-all hover:border-blue-500/40 hover:bg-blue-500/10 no-underline shadow-sm"
                >
                  <span>Free Plan</span>
                  <span className="opacity-40">•</span>
                  <span className="font-bold text-blue-500">Upgrade</span>
                </Link>
              ) : (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/5 border border-emerald-500/20 text-emerald-500 text-[11px] font-bold shadow-sm">
                  <ShieldCheck size={12} className="shrink-0" />
                  <span>Premium Plan</span>
                </div>
              )}
              <span className="text-xs font-bold text-[var(--muted)] uppercase tracking-widest transition-colors duration-500">{user?.fullName || user?.email}</span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
              >
                {t('navbar_logout')}
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => setIsLoginModalOpen(true)}
                className="px-4 py-2 text-sm font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                {t('navbar_login')}
              </button>
              <Link href="/signup">
                <button className="bg-[var(--text)] text-[var(--bg)] hover:opacity-90 px-5 py-2 rounded-full text-sm font-bold shadow-lg transition-all active:scale-95">
                  {t('navbar_signup')}
                </button>
              </Link>
            </>
          )}
        </div>


      </div>
    </header>

    {/* Mobile Drawer (Universal Sidebar) — rendered OUTSIDE header */}
    <Sidebar
      currentSessionId={null}
      assistantType={mounted ? (localStorage.getItem('permitops_active_agent') || 'permit') : 'permit'}
      onSessionSelect={(id: string) => {
        localStorage.setItem('permitops_active_session_id', id);
        router.push('/chat');
      }}
      onNewChat={() => { router.push('/chat'); }}
      onDeleteSession={() => {}}
      onSwitchAssistant={(t: any) => {
        localStorage.setItem('permitops_active_agent', t);
        router.push('/chat');
      }}
      token={token}
      mobileOpen={open}
      onMobileClose={() => setOpen(false)}
      refreshTrigger={0}
      mobileOnly
    />
    </>
  );
}
