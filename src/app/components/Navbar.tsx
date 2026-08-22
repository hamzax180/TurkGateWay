'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { BACKEND_BASE } from '@/app/utils/api';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';

/**
 * Desktop-only top bar.
 *
 * Hidden below `md`: on mobile it rendered as a 64px strip holding nothing but
 * a hamburger, so it is not rendered at all there. `onMobileMenuClick` is kept
 * in the signature because several pages still pass it and own the drawer it
 * used to trigger — this component simply no longer draws that trigger.
 */
export default function Navbar({ isAppPage = false, transparentTop = false, extraContent }: { isAppPage?: boolean; transparentTop?: boolean; onMobileMenuClick?: () => void; extraContent?: React.ReactNode }) {
  const pathname = usePathname();
  const { user, logout, isAuthenticated, setIsLoginModalOpen } = useAuth();
  const [scrolled, setScrolled] = useState(false);
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
        const res = await fetch(`${BACKEND_BASE}/auth/me`, {
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
    // /dashboard is gone. Login, signup, payment success and the roadmap
    // hand-off all land on /applications now.
    { href: '/pricing', label: t('navbar_pricing'), hideOnSmallLaptop: true },
    ...(isAdmin ? [{ href: '/admin', label: t('navbar_subscribers') }] : []),
    { href: '/download', label: t('navbar_download') === 'navbar_download' ? 'Download App' : t('navbar_download') || 'Download App', hideOnSmallLaptop: true },
  ];


  return (
    <>
    <header
      className={`hidden md:block ${isAppPage ? 'relative z-[40] w-full shrink-0 border-b border-[var(--border)]/50' : 'fixed inset-x-0 top-0 z-[100] transition-all duration-300'} ${(transparentTop && !scrolled)
          ? 'bg-transparent border-transparent shadow-none'
          : (isAppPage || scrolled) 
          ? 'bg-[var(--nav-bg)] backdrop-blur-xl border-b border-[var(--border)] shadow-2xl' 
          : 'bg-transparent'
        }`}
    >
      <div className="w-full px-4 md:px-6 flex items-center" style={{ height: '64px', gap: 0 }}>
        {/* LEFT: Desktop Nav */}
        <div className="flex-1 hidden md:flex items-center justify-start">
          <nav className="flex items-center gap-0">
            {links.map(({ href, label, hideOnSmallLaptop }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative rounded-lg transition-colors ${hideOnSmallLaptop ? 'hidden xl:flex' : 'flex'} items-center ${active ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
                  style={{ padding: 'clamp(4px, 0.4vw, 8px) clamp(5px, 0.55vw, 12px)', fontSize: 'clamp(11px, 0.8vw, 14px)', fontWeight: 500 }}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 rounded-lg bg-[var(--surface-2)]"
                      transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
                    />
                  )}
                  <span className="relative whitespace-nowrap">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* CENTER: Agent badge — standard flex now that left menu is responsive */}
        <div className="flex items-center justify-center z-40 px-2 shrink-0">
          {extraContent}
        </div>


        {/* RIGHT: User Actions */}
        <div className="flex-1 hidden md:flex items-center justify-end gap-2 relative z-50">
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
              {/* Signed-in only, and sitting next to sign out rather than in
                  the public nav — it is account content, not a landing page. */}
              <Link
                href="/applications"
                className={`px-3 py-2 text-sm font-medium no-underline transition-colors ${
                  pathname === '/applications'
                    ? 'text-[var(--text)]'
                    : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
              >
                {t('navbar_applications')}
              </Link>
              <button
                onClick={logout}
                className="px-4 py-2 text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
              >
                {t('navbar_logout')}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/pricing"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/5 border border-blue-500/20 text-blue-400/80 text-[11px] font-medium transition-all hover:border-blue-500/40 hover:bg-blue-500/10 no-underline shadow-sm"
              >
                <span>Free Plan</span>
                <span className="opacity-40">•</span>
                <span className="font-bold text-blue-500">Upgrade</span>
              </Link>
              <button
                onClick={() => setIsLoginModalOpen(true)}
                className="font-medium text-[var(--muted)] hover:text-[var(--text)] transition-colors"
                style={{ padding: 'clamp(4px, 0.4vw, 8px) clamp(8px, 0.8vw, 16px)', fontSize: 'clamp(11px, 0.85vw, 14px)' }}
              >
                {t('navbar_login')}
              </button>
              <Link href="/signup">
                <button
                  className="bg-[var(--text)] text-[var(--bg)] hover:opacity-90 rounded-full font-bold shadow-lg transition-all active:scale-95 whitespace-nowrap"
                  style={{ padding: 'clamp(5px, 0.45vw, 9px) clamp(10px, 1vw, 20px)', fontSize: 'clamp(11px, 0.85vw, 14px)' }}
                >
                  {t('signup_free')}
                </button>
              </Link>
            </>
          )}
        </div>


      </div>
    </header>

    </>
  );
}
