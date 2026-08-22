'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, User, Moon, Sun, Languages, History, Shield, LogOut, ChevronRight, ArrowLeft, AlertCircle, CheckCircle2, Coins } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import MobileMenuButton from '../components/MobileMenuButton';
import BackButton from '../components/BackButton';
import UsagePanel from './UsagePanel';
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

  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const loadMfaStatus = async () => {
      try {
        const res = await apiFetch('/auth/mfa');
        if (res?.ok) {
          const json = await res.json();
          setMfaEnabled(Boolean(json.mfa_enabled));
        }
      } catch { /* ignore */ }
    };
    loadMfaStatus();
  }, [isAuthenticated, activeTab]);

  if (!mounted) return null;

  const handleClearHistory = async () => {
    if (!token) return;
    try {
      setIsClearing(true);
      const res = await apiFetch(`/chat/sessions/clear`, {
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
      const res = await apiFetch(`/auth/account`, {
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

  const mfaDone = language === 'ar' ? 'تم تفعيل المصادقة الثنائية بنجاح' : language === 'tr' ? 'İki adımlı doğrulama etkinleştirildi' : language === 'tk' ? 'Iki basgançakly tassyklama açyldy' : 'Two-factor authentication enabled';
  const mfaOff = language === 'ar' ? 'تم إيقاف المصادقة الثنائية' : language === 'tr' ? 'İki adımlı doğrulama kapatıldı' : language === 'tk' ? 'Iki basgançakly tassyklama ýapyldy' : 'Two-factor authentication disabled';

  const handleMfaEnable = async () => {
    setMfaBusy(true);
    setMfaError('');
    try {
      const res = await apiFetch('/auth/mfa/setup', { method: 'POST' });
      if (res?.ok) {
        const json = await res.json();
        setMfaSecret(json.secret);
      } else {
        const json = await res?.json().catch(() => ({}));
        setMfaError(json?.detail || 'Error');
      }
    } catch {
      setMfaError('Error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaVerify = async () => {
    setMfaBusy(true);
    setMfaError('');
    try {
      const res = await apiFetch('/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (res?.ok) {
        setMfaEnabled(true);
        setMfaSecret(null);
        setMfaCode('');
        showSecurityTip('2fa', mfaDone);
      } else {
        const json = await res?.json().catch(() => ({}));
        setMfaError(json?.detail || 'Invalid code');
      }
    } catch {
      setMfaError('Error');
    } finally {
      setMfaBusy(false);
    }
  };

  const handleMfaDisable = async () => {
    setMfaBusy(true);
    setMfaError('');
    try {
      const res = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (res?.ok) {
        setMfaEnabled(false);
        setMfaCode('');
        showSecurityTip('2fa', mfaOff);
      } else {
        const json = await res?.json().catch(() => ({}));
        setMfaError(json?.detail || 'Invalid code');
      }
    } catch {
      setMfaError('Error');
    } finally {
      setMfaBusy(false);
    }
  };

  const tabs = [
    { id: 'general', icon: Settings, label: t('settings_appearance') },
    { id: 'profile', icon: User, label: t('settings_profile') },
    { id: 'history', icon: History, label: t('settings_history') },
    { id: 'usage', icon: Coins, label: t('settings_usage') || 'Usage' },
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
        <MobileMenuButton onClick={() => setMobileMenuOpen(true)} />

        <div className="w-full px-4 md:px-12 py-6 md:py-12 relative z-10">
          <BackButton className="mb-5 ml-2 md:ml-0" />

          {/* Mobile: Header + Horizontal pill tabs */}
          <div className="md:hidden mb-6">
            <h1 className="text-2xl font-black tracking-tight px-2 mb-5">{t('settings_title')}</h1>
            <div className="flex gap-2 overflow-x-auto no-scrollbar px-1 pb-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                    activeTab === tab.id
                      ? 'bg-[var(--surface-2)] text-[var(--text)] shadow-sm'
                      : 'text-[var(--muted)] hover:text-[var(--text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-8">

            {/* Desktop: Sidebar Tabs */}
            <nav className="hidden md:block w-64 space-y-1 shrink-0">
              <div className="px-4 py-2 mb-2">
                <h1 className="text-2xl font-black tracking-tight">{t('settings_title')}</h1>
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
                    
                      <div className="space-y-4">
                        <p className="font-bold text-sm px-1">{t('settings_theme')}</p>
                        <div className="grid grid-cols-2 gap-4">
                          {/* Light Theme Card */}
                          <button 
                            onClick={() => {
                              document.documentElement.classList.remove('dark');
                              localStorage.setItem('theme', 'light');
                              window.dispatchEvent(new Event('storage')); // Update other components
                              setTimeout(() => window.location.reload(), 10); // Force refresh for full effect
                            }}
                            className={`group relative flex flex-col items-center p-4 rounded-3xl border-2 transition-all duration-300 ${
                              mounted && !document.documentElement.classList.contains('dark')
                                ? 'bg-white border-blue-500 shadow-xl shadow-blue-500/10 scale-[1.02]' 
                                : 'bg-gray-50 border-transparent hover:border-gray-200'
                            }`}
                          >
                            <div className="w-full aspect-[4/3] rounded-2xl bg-white border border-gray-100 mb-3 shadow-inner flex flex-col p-2 gap-2 overflow-hidden">
                              <div className="h-2 w-2/3 bg-gray-100 rounded-full" />
                              <div className="h-2 w-1/2 bg-gray-50 rounded-full" />
                              <div className="mt-auto flex gap-2">
                                <div className="h-4 w-4 rounded-full bg-blue-500" />
                                <div className="h-4 flex-1 bg-gray-100 rounded-md" />
                              </div>
                            </div>
                            <span className={`text-sm font-bold ${mounted && !document.documentElement.classList.contains('dark') ? 'text-blue-600' : 'text-gray-500'}`}>
                              {language === 'ar' ? 'فاتح' : language === 'tr' ? 'Açık' : language === 'tk' ? 'Açyk' : 'Light'}
                            </span>
                            {mounted && !document.documentElement.classList.contains('dark') && (
                              <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white">
                                <CheckCircle2 size={12} strokeWidth={4} />
                              </div>
                            )}
                          </button>

                          {/* Dark Theme Card */}
                          <button 
                            onClick={() => {
                              document.documentElement.classList.add('dark');
                              localStorage.setItem('theme', 'dark');
                              window.dispatchEvent(new Event('storage')); // Update other components
                              setTimeout(() => window.location.reload(), 10); // Force refresh for full effect
                            }}
                            className={`group relative flex flex-col items-center p-4 rounded-3xl border-2 transition-all duration-300 ${
                              mounted && document.documentElement.classList.contains('dark')
                                ? 'bg-[#111] border-blue-500 shadow-xl shadow-blue-500/20 scale-[1.02]' 
                                : 'bg-[#1a1a1a] border-transparent hover:border-white/5'
                            }`}
                          >
                            <div className="w-full aspect-[4/3] rounded-2xl bg-[#0a0a0a] border border-white/5 mb-3 shadow-inner flex flex-col p-2 gap-2 overflow-hidden">
                              <div className="h-2 w-2/3 bg-white/10 rounded-full" />
                              <div className="h-2 w-1/2 bg-white/5 rounded-full" />
                              <div className="mt-auto flex gap-2">
                                <div className="h-4 w-4 rounded-full bg-blue-500" />
                                <div className="h-4 flex-1 bg-white/5 rounded-md" />
                              </div>
                            </div>
                            <span className={`text-sm font-bold ${mounted && document.documentElement.classList.contains('dark') ? 'text-blue-400' : 'text-gray-500'}`}>
                              {language === 'ar' ? 'داكن' : language === 'tr' ? 'Koyu' : language === 'tk' ? 'Garaňky' : 'Dark'}
                            </span>
                            {mounted && document.documentElement.classList.contains('dark') && (
                              <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white">
                                <CheckCircle2 size={12} strokeWidth={4} />
                              </div>
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="h-px bg-[var(--border)] my-6" />

                      <div className="flex items-center justify-between p-3.5 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)]">
                        <div>
                          <p className="font-bold">{t('settings_lang')}</p>
                          <p className="text-xs text-[var(--muted)]">Choose your preferred interface language</p>
                        </div>
                        <LanguageSwitcher />
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

              {activeTab === 'usage' && <UsagePanel />}

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
                      <div className="p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)] relative overflow-hidden">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-bold">{t('settings_2fa_title')}</p>
                            <p className="text-xs text-[var(--muted)]">{t('settings_2fa_desc')}</p>
                          </div>
                          {mfaEnabled === null ? (
                            <span className="text-xs text-[var(--muted)]">…</span>
                          ) : mfaEnabled ? (
                            <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs font-bold">
                              {language === 'ar' ? 'مفعّلة' : language === 'tr' ? 'Açık' : language === 'tk' ? 'Açyk' : 'Enabled'}
                            </span>
                          ) : (
                            <button
                              onClick={handleMfaEnable}
                              disabled={mfaBusy}
                              className="px-4 py-1.5 rounded-full border border-[var(--border)] text-xs font-bold hover:bg-[var(--surface-2)] transition-all active:scale-95 disabled:opacity-50"
                            >
                              {t('settings_2fa_enable')}
                            </button>
                          )}
                        </div>

                        {mfaSecret && !mfaEnabled && (
                          <div className="mt-4 space-y-2.5">
                            <p className="text-xs text-[var(--muted)] leading-relaxed">
                              {language === 'ar' ? 'أضف هذا المفتاح إلى Google Authenticator أو Authy، ثم أدخل الرمز المكوّن من 6 أرقام:' : language === 'tr' ? 'Bu anahtarı Google Authenticator veya Authy uygulamasına ekleyin, ardından 6 haneli kodu girin:' : language === 'tk' ? 'Bu açary Google Authenticator ýa-da Authy goşundysyna goşuň, soňra 6 sanly kody giriziň:' : 'Add this key to Google Authenticator or Authy, then enter the 6-digit code:'}
                            </p>
                            <code className="block w-full rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[11px] font-mono break-all select-all text-[var(--text)]">{mfaSecret}</code>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={mfaCode}
                                onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9]/g, ''))}
                                placeholder="123456"
                                className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-xs font-mono tracking-widest text-center focus:border-emerald-500 focus:outline-none"
                              />
                              <button
                                onClick={handleMfaVerify}
                                disabled={mfaBusy || mfaCode.length !== 6}
                                className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-40 disabled:grayscale"
                              >
                                {language === 'ar' ? 'تأكيد' : language === 'tr' ? 'Doğrula' : language === 'tk' ? 'Tassykla' : 'Verify'}
                              </button>
                            </div>
                          </div>
                        )}

                        {mfaEnabled && (
                          <div className="mt-4 flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={mfaCode}
                              onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9]/g, ''))}
                              placeholder={language === 'ar' ? 'الرمز الحالي' : language === 'tr' ? 'Mevcut kod' : language === 'tk' ? 'Häzirki kod' : 'Current code'}
                              className="flex-1 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] text-xs font-mono tracking-widest text-center focus:border-red-500 focus:outline-none"
                            />
                            <button
                              onClick={handleMfaDisable}
                              disabled={mfaBusy || mfaCode.length !== 6}
                              className="px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all active:scale-95 disabled:opacity-40 disabled:grayscale"
                            >
                              {language === 'ar' ? 'إيقاف' : language === 'tr' ? 'Kapat' : language === 'tk' ? 'Öçür' : 'Disable'}
                            </button>
                          </div>
                        )}

                        {mfaError && <p className="mt-2 text-xs text-red-500 font-medium">{mfaError}</p>}
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--surface-2)]/40 border border-[var(--border)] relative overflow-hidden">
                        <div>
                          <p className="font-bold">{t('settings_sessions_title')}</p>
                          <p className="text-xs text-[var(--muted)]">{t('settings_sessions_desc')}</p>
                        </div>
                        <button 
                          onClick={() => showSecurityTip('logout', language === 'ar' ? 'تم إنهاء الجلسات الأخرى' : language === 'tr' ? 'Diğer oturumlar sonlandırıldı' : language === 'tk' ? 'Beýleki sessiýalar tamamlandy' : 'Other sessions ended')}
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
                              placeholder={language === 'ar' ? 'اكتب "DELETE" هنا' : language === 'tr' ? '"DELETE" yazın' : language === 'tk' ? '"DELETE" ýazyň' : 'Type "DELETE" here'}
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
