'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, User, Moon, Sun, Languages, History, Shield, LogOut, ChevronRight, ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import { apiFetch } from '../utils/api';

export default function SettingsPage() {
  const { t, language, setLanguage, isRTL } = useLanguage();
  const { user, logout, isAuthenticated, token } = useAuth();
  
  const [activeTab, setActiveTab] = useState('general');
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  
  const [securityStatus, setSecurityStatus] = useState<{id: string, message: string, type: 'success' | 'info'} | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const handleClearHistory = async () => {
    if (!token) return;
    try {
      setIsClearing(true);
      const res = await apiFetch(`/chat/sessions/clear?token=${token}`, {
        method: 'DELETE'
      });
      if (res?.ok) {
        setCleared(true);
        setTimeout(() => {
          setCleared(false);
          setShowClearConfirm(false);
          // Refresh to update sidebar and other persistent components
          window.location.reload();
        }, 1500);
      }
    } catch (e) {
      console.error("Failed to clear history", e);
    } finally {
      setIsClearing(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!token) return;
    try {
      setIsDeleting(true);
      const res = await apiFetch(`/auth/account?token=${token}`, {
        method: 'DELETE'
      });
      if (res?.ok) {
        logout();
        window.location.href = '/';
      }
    } catch (e) {
      console.error("Failed to delete account", e);
    } finally {
      setIsDeleting(false);
    }
  };

  const showSecurityTip = (id: string, message: string) => {
    setSecurityStatus({ id, message, type: 'success' });
    setTimeout(() => setSecurityStatus(null), 3000);
  };

  const tabs = [
    { id: 'general', icon: Settings, label: t('settings_appearance') },
    { id: 'profile', icon: User, label: t('settings_profile') },
    { id: 'history', icon: History, label: t('settings_history') },
    { id: 'security', icon: Shield, label: t('settings_security_title') },
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
          localStorage.setItem('active_session_id', id);
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
                  <div className="p-10 rounded-[40px] bg-[var(--surface-2)]/30 border border-[var(--border)] text-center relative overflow-hidden">
                    <History size={48} className="mx-auto text-[var(--muted)] mb-6 opacity-40" />
                    <h2 className="text-2xl font-black mb-3 tracking-tight">{t('settings_history')}</h2>
                    <p className="text-[var(--muted)] max-w-sm mx-auto mb-10 text-sm leading-relaxed">
                      Manage your chat history and stored documents across all of your specialized AI agents.
                    </p>
                    
                    <AnimatePresence mode="wait">
                      {cleared ? (
                        <motion.div
                          key="cleared"
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 1.1 }}
                          className="flex flex-col items-center gap-2 text-emerald-500"
                        >
                          <CheckCircle2 size={32} />
                          <span className="font-bold underline underline-offset-4 decoration-2">History Cleared</span>
                        </motion.div>
                      ) : showClearConfirm ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="flex flex-col items-center gap-6"
                        >
                          <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-500/5 border border-red-500/10 text-red-500 text-sm font-medium">
                            <AlertCircle size={18} />
                            This action cannot be undone. Are you sure?
                          </div>
                          <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs">
                            <button
                              onClick={handleClearHistory}
                              disabled={isClearing}
                              className="w-full px-8 py-3.5 rounded-2xl bg-red-500 text-white font-black shadow-xl shadow-red-500/20 hover:bg-red-600 active:scale-95 transition-all text-sm disabled:opacity-50"
                            >
                              {isClearing ? t('dashboard_processing') : t('settings_confirm_clear')}
                            </button>
                            <button
                              onClick={() => setShowClearConfirm(false)}
                              disabled={isClearing}
                              className="w-full px-8 py-3.5 rounded-2xl bg-[var(--surface-2)] text-[var(--text)] font-black hover:bg-[var(--surface-3)] transition-all text-sm"
                            >
                              {t('settings_cancel')}
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.button
                          key="initial"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          onClick={() => setShowClearConfirm(true)}
                          className="px-10 py-4 rounded-2xl bg-red-500/10 text-red-500 border border-red-500/20 font-black hover:bg-red-500 hover:text-white hover:shadow-2xl hover:shadow-red-500/20 transition-all text-sm active:scale-95"
                        >
                          {t('settings_clear_history')}
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {activeTab === 'security' && (
                <div className="space-y-6">
                  <div className="glass-mesh mesh-emerald rounded-[32px] p-6 border border-[var(--border)] shadow-xl relative overflow-hidden">
                    <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
                      <Shield className="text-emerald-500" size={20} />
                      {t('settings_security_title')}
                    </h2>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)] relative overflow-hidden">
                        <div>
                          <p className="font-bold">{t('settings_2fa_title')}</p>
                          <p className="text-xs text-[var(--muted)]">{t('settings_2fa_desc')}</p>
                        </div>
                        <button 
                          onClick={() => showSecurityTip('2fa', language === 'en' ? '2FA request sent to your email' : (language === 'ar' ? 'تم إرسال طلب تفعيل المصادقة الثنائية لبريدك' : '2FA isteği e-postanıza gönderildi'))}
                          className="px-4 py-1.5 rounded-full border border-[var(--border)] text-xs font-bold hover:bg-[var(--surface-2)] transition-all active:scale-95"
                        >
                          {securityStatus?.id === '2fa' ? <CheckCircle2 size={16} className="text-emerald-500" /> : t('settings_2fa_enable')}
                        </button>
                        {securityStatus?.id === '2fa' && (
                          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="absolute right-20 text-[10px] text-emerald-500 font-bold whitespace-nowrap">
                            {securityStatus.message}
                          </motion.div>
                        )}
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)] relative overflow-hidden">
                        <div>
                          <p className="font-bold">{t('settings_sessions_title')}</p>
                          <p className="text-xs text-[var(--muted)]">{t('settings_sessions_desc')}</p>
                        </div>
                        <button 
                          onClick={() => showSecurityTip('logout', language === 'en' ? 'Other sessions ended' : (language === 'ar' ? 'تم إنهاء الجلسات الأخرى' : 'Diğer oturumlar sonlandırıldı'))}
                          className="px-4 py-1.5 rounded-full border border-[var(--border)] text-xs font-bold hover:bg-[var(--surface-2)] transition-all active:scale-95 text-center"
                        >
                           {securityStatus?.id === 'logout' ? <CheckCircle2 size={16} className="text-emerald-500" /> : t('settings_sessions_logout')}
                        </button>
                        {securityStatus?.id === 'logout' && (
                          <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="absolute right-32 text-[10px] text-emerald-500 font-bold whitespace-nowrap">
                            {securityStatus.message}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-8 rounded-[32px] border border-red-500/20 bg-red-500/5 mt-8 max-w-xl mx-auto text-center relative overflow-hidden">
                    <h3 className="font-bold text-red-500 mb-2">{t('settings_danger_zone')}</h3>
                    <p className="text-xs text-[var(--muted)] mb-6 mx-auto max-w-sm">{t('settings_delete_desc')}</p>
                    
                    <AnimatePresence mode="wait">
                      {showDeleteConfirm ? (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="space-y-5"
                        >
                          <div className="space-y-2">
                            <p className="text-xs font-black text-red-500 uppercase tracking-tight">{t('settings_delete_confirm')}</p>
                            <input
                              type="text"
                              value={deleteConfirmText}
                              onChange={(e) => setDeleteConfirmText(e.target.value)}
                              placeholder={language === 'ar' ? 'اكتب "DELETE" هنا' : (language === 'tr' ? '"DELETE" yazın' : 'Type "DELETE" here')}
                              className="w-full max-w-xs mx-auto block px-4 py-3 rounded-2xl border-2 border-red-500/20 bg-white dark:bg-black/20 text-center font-black text-red-500 placeholder:text-red-500/30 focus:border-red-500 focus:outline-none transition-all shadow-inner"
                            />
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button 
                              onClick={handleDeleteAccount}
                              disabled={isDeleting || deleteConfirmText !== 'DELETE'}
                              className="px-8 py-3 rounded-full bg-red-500 text-white font-black text-xs shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            >
                              {isDeleting ? t('dashboard_processing') : t('settings_delete_yes')}
                            </button>
                            <button 
                              onClick={() => {
                                setShowDeleteConfirm(false);
                                setDeleteConfirmText("");
                              }}
                              disabled={isDeleting}
                              className="px-8 py-3 rounded-full bg-[var(--surface-2)] text-[var(--text)] font-black text-xs hover:bg-[var(--surface-3)] transition-all"
                            >
                              {t('settings_cancel')}
                            </button>
                          </div>
                        </motion.div>
                      ) : (
                        <button 
                          onClick={() => setShowDeleteConfirm(true)}
                          className="px-8 py-2.5 rounded-full bg-white text-red-600 border border-red-200 font-black text-xs hover:bg-red-50 shadow-sm transition-all hover:scale-105"
                        >
                          {t('settings_delete_account')}
                        </button>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
          </div>
        </div>


      </main>
    </div>
  );
}
