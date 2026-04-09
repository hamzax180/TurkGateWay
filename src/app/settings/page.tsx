'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Settings, User, Moon, Sun, Languages, History, Shield, LogOut, ChevronRight, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';

export default function SettingsPage() {
  const { t, language, setLanguage, isRTL } = useLanguage();
  const { user, logout, isAuthenticated, token } = useAuth();
  
  const [activeTab, setActiveTab] = useState('general');
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const tabs = [
    { id: 'general', icon: Settings, label: t('settings_appearance') },
    { id: 'profile', icon: User, label: t('settings_profile') },
    { id: 'history', icon: History, label: t('settings_history') },
    { id: 'security', icon: Shield, label: 'Security' },
  ];

  const containerVariants = {
    hidden: { opacity: 0, scale: 0.98 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } }
  };

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--text)] transition-colors duration-500 overflow-hidden">
      <Sidebar 
        currentSessionId={null}
        assistantType="permit"
        onSessionSelect={(id) => {
          localStorage.setItem('permitops_active_session_id', id);
          window.location.href = '/chat';
        }}
        onNewChat={() => {
          window.location.href = '/chat?new=true';
        }}
        onDeleteSession={() => {}}
        token={token}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 transition-colors duration-300 relative overflow-y-auto slim-scroll">
        <Navbar isAppPage onMobileMenuClick={() => setMobileMenuOpen(true)} />

        <div className="w-full px-6 md:px-12 py-8 md:py-12 relative z-10">
          <div className="flex flex-col md:flex-row gap-8">
            
            {/* Sidebar Tabs */}
            <nav className="w-full md:w-64 space-y-1 shrink-0">
              <div className="px-4 py-2 mb-2">
                <h1 className="text-xl font-black md:text-2xl tracking-tight">{t('settings_title')}</h1>
              </div>
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all ${
                    activeTab === tab.id 
                      ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold shadow-sm' 
                      : 'text-[var(--muted)] hover:bg-[var(--surface-2)]/50 hover:text-[var(--text)]'
                  }`}
                >
                  <tab.icon size={20} />
                  <span>{tab.label}</span>
                </button>
              ))}
              
              <div className="mt-8 pt-4 border-t border-[var(--border)] md:hidden">
                {isAuthenticated && (
                  <button 
                    onClick={logout}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-red-500 hover:bg-red-500/10 transition-all font-bold"
                  >
                    <LogOut size={20} />
                    <span>{t('sidebar_logout')}</span>
                  </button>
                )}
              </div>
            </nav>

            {/* Content Area */}
            <div className="flex-1 pb-20">
              <motion.div
                key={activeTab}
                initial="hidden"
                animate="visible"
                variants={containerVariants}
                className="space-y-6"
              >
              {activeTab === 'general' && (
                <div className="space-y-6">
                  {/* Appearance Card */}
                  <div className="glass-mesh mesh-indigo rounded-[32px] p-5 border border-[var(--border)] shadow-xl overflow-hidden">
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <Settings className="text-indigo-500" size={20} />
                      {t('settings_appearance')}
                    </h2>
                    
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                        <div>
                          <p className="font-bold">{t('settings_theme')}</p>
                          <p className="text-xs text-[var(--muted)]">Switch between light and dark mode</p>
                        </div>
                        <ThemeToggle />
                      </div>

                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                        <div>
                          <p className="font-bold">{t('settings_lang')}</p>
                          <p className="text-xs text-[var(--muted)]">Choose your preferred interface language</p>
                        </div>
                        <LanguageSwitcher />
                      </div>
                    </div>
                  </div>

                  {/* Beta Card */}
                  <div className="bg-[var(--surface-2)]/30 rounded-[32px] p-5 border border-[var(--border)]">
                    <h3 className="font-bold mb-1">Beta Features</h3>
                    <p className="text-xs text-[var(--muted)] mb-3">Try out new experimental features before they are released globally.</p>
                    <button className="px-5 py-2 rounded-full bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-500/25 hover:scale-105 transition-all">
                      Enroll in Beta
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'profile' && (
                <div className="space-y-6">
                  <div className="glass-mesh mesh-purple rounded-[32px] p-8 border border-[var(--border)] shadow-xl text-center">
                    <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-black shadow-2xl mb-4">
                      {user?.fullName?.charAt(0) || user?.email?.charAt(0) || '?'}
                    </div>
                    <h2 className="text-2xl font-black tracking-tight">{user?.fullName || 'User'}</h2>
                    <p className="text-[var(--muted)]">{user?.email}</p>
                    <div className="mt-6 flex justify-center gap-3">
                      <button className="px-6 py-2 rounded-full border border-[var(--border)] font-bold text-sm hover:bg-[var(--surface-2)] transition-all">Edit Profile</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-6 rounded-[28px] bg-[var(--surface-2)]/30 border border-[var(--border)]">
                      <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)] mb-1">Plan</p>
                      <p className="text-lg font-bold">{t('dashboard_free_plan')}</p>
                      <Link href="/pricing">
                        <button className="mt-4 text-[var(--accent)] font-bold text-sm hover:underline">{t('dashboard_upgrade')}</button>
                      </Link>
                    </div>
                    <div className="p-6 rounded-[28px] bg-[var(--surface-2)]/30 border border-[var(--border)]">
                      <p className="text-xs font-black uppercase tracking-widest text-[var(--muted)] mb-1">Account ID</p>
                      <p className="text-sm font-mono opacity-50 truncate">UID_5928347201</p>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="space-y-6">
                  <div className="p-8 rounded-[32px] bg-[var(--surface-2)]/30 border border-[var(--border)] text-center">
                    <History size={48} className="mx-auto text-[var(--muted)] mb-4 opacity-50" />
                    <h2 className="text-xl font-bold mb-2">{t('settings_history')}</h2>
                    <p className="text-[var(--muted)] max-w-sm mx-auto mb-8">
                      Manage your chat history and stored documents across all of your specialized AI agents.
                    </p>
                    <button className="px-8 py-3 rounded-full bg-red-500/10 text-red-500 border border-red-500/20 font-bold hover:bg-red-500 hover:text-white transition-all">
                      {t('settings_clear_history')}
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'security' && (
                <div className="space-y-6">
                  <div className="glass-mesh mesh-emerald rounded-[32px] p-6 border border-[var(--border)] shadow-xl">
                    <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                      <Shield className="text-emerald-500" size={20} />
                      Security & Privacy
                    </h2>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                        <div>
                          <p className="font-bold">Two-Factor Authentication</p>
                          <p className="text-xs text-[var(--muted)]">Add an extra layer of security to your account</p>
                        </div>
                        <button className="px-4 py-1.5 rounded-full border border-[var(--border)] text-xs font-bold hover:bg-[var(--surface-2)]">Enable</button>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                        <div>
                          <p className="font-bold">Active Sessions</p>
                          <p className="text-xs text-[var(--muted)]">Log out from all other devices</p>
                        </div>
                        <button className="px-4 py-1.5 rounded-full border border-[var(--border)] text-xs font-bold hover:bg-[var(--surface-2)]">Log out others</button>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 rounded-[32px] border border-red-500/20 bg-red-500/5 mt-12">
                    <h3 className="font-bold text-red-500 mb-2">Danger Zone</h3>
                    <p className="text-sm text-[var(--muted)] mb-4">Once you delete your account, there is no going back. Please be certain.</p>
                    <button className="px-5 py-2.5 rounded-full bg-white text-red-600 border border-red-200 font-bold text-sm hover:bg-red-50 shadow-sm transition-all">
                      {t('settings_delete_account')}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
          </div>
        </div>

        <footer className="py-12 mt-auto text-center opacity-30 text-xs font-medium tracking-widest uppercase">
          PermitOps AI Advisor • Settings Engine v1.0
        </footer>
      </main>
    </div>
  );
}
