'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Menu, X, FileCheck, Sun, Moon, ShieldCheck } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import Sidebar from './Sidebar';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

export default function Navbar({ isAppPage = false }: { isAppPage?: boolean }) {
  const pathname = usePathname();
  const { user, logout, isAuthenticated } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

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
        const res = await fetch(`http://localhost:8003/auth/me?token=${token}`);
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
    { href: '/dashboard', label: t('navbar_dashboard') },
    { href: '/pricing', label: t('navbar_pricing') || 'Pricing' },
    ...(isAdmin ? [{ href: '/admin/subscribers', label: 'Subscribers' }] : []),
  ];


  return (
    <>
    <header
      className={`${isAppPage ? 'relative z-[20] w-full shrink-0' : 'fixed inset-x-0 top-0 z-[100]'} transition-all duration-300 ${scrolled ? 'bg-[var(--surface)]/95 backdrop-blur-xl border-b border-[var(--border)] shadow-md' : 'bg-[var(--bg)]/90 backdrop-blur-md border-b border-[var(--border)]/30'
        }`}
    >
      <div className="w-full pl-20 pr-6 md:pr-12 h-16 flex items-center justify-between">

        {/* Logo removed */}

        {/* Desktop Nav - Left Aligned */}
        <nav className="hidden md:flex items-center gap-1">
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-colors ${active ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
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

        {/* Right CTA */}
        <div className="hidden md:flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
          {isAuthenticated ? (
            <>
              <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{user?.fullName || user?.email}</span>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link href="/login">
                <button className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">
                  Login
                </button>
              </Link>
              <Link href="/signup">
                <button className="bg-white text-black hover:bg-gray-200 px-5 py-2 rounded-full text-sm font-bold shadow-lg transition-all active:scale-95">
                  Sign Up
                </button>
              </Link>
            </>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>

    {/* Mobile Drawer (Universal Sidebar) — rendered OUTSIDE header */}
    <Sidebar
      currentSessionId={null}
      assistantType={typeof window !== 'undefined' ? (localStorage.getItem('permitops_active_agent') || 'permit') : 'permit'}
      onSessionSelect={(id: string) => {
        localStorage.setItem('permitops_active_session_id', id);
        window.location.href = '/chat';
      }}
      onNewChat={() => { window.location.href = '/chat'; }}
      onDeleteSession={() => {}}
      onSwitchAssistant={(t: any) => {
        localStorage.setItem('permitops_active_agent', t);
        window.location.href = '/chat';
      }}
      token={typeof window !== 'undefined' ? localStorage.getItem('permitops_token') : null}
      mobileOpen={open}
      onMobileClose={() => setOpen(false)}
      refreshTrigger={0}
      mobileOnly
    />
    </>
  );
}
