'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Loader2, ChevronDown, Sun, Moon } from 'lucide-react';
import ThemeToggle from '@/app/components/ThemeToggle';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';

export default function LoginPage() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1);
    const [isLangOpen, setIsLangOpen] = useState(false);
    const { setLanguage } = useLanguage();

    const languages = [
        { code: 'en', label: t('footer_english') },
        { code: 'tr', label: t('footer_turkish') },
        { code: 'ar', label: t('footer_arabic') },
    ];

    const currentLanguageLabel = languages.find(l => l.code === language)?.label || 'Language';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (step === 1) {
                const res = await fetch('http://localhost:8003/auth/check-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error(t('auth_email_not_found'));
                    }
                    const data = await res.json();
                    throw new Error(data.detail || 'Failed to verify email');
                }

                setStep(2);
                return;
            }
            
            // Step 2: Login with Password
            const res = await fetch('http://localhost:8003/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || 'Login failed');
            }

            const data = await res.json();
            login(data.access_token, data.email, data.full_name, data.is_admin);
            router.push('/dashboard');
        } catch (err: any) {
            setError(err.message);
            // Don't auto-reset to step 1 if the error happened in step 2 (wrong password)
            // UNLESS the error is that the email doesn't exist (which shouldn't happen after step 1 pass)
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-4 sm:p-6 font-sans ${language === 'ar' ? 'rtl' : 'ltr'} transition-colors duration-300`}>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-[450px] bg-[var(--surface-1)] border border-[var(--border)] rounded-[28px] overflow-hidden shadow-2xl transition-colors duration-300"
            >
                <div className="p-8 sm:p-12 space-y-10">
                    {/* Header */}
                    <div className="space-y-4">
                        <div className="flex justify-start">
                            <div className="w-10 h-10 bg-gradient-to-tr from-purple-600 to-purple-400 rounded-full flex items-center justify-center shadow-lg shadow-purple-500/20">
                                <span className="text-white font-black text-xl">T</span>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <h1 className="text-2xl sm:text-3xl font-medium text-[var(--text)] tracking-tight">
                                {step === 1 ? t('auth_login_title') : t('auth_login_title')}
                            </h1>
                            {step === 2 ? (
                                <div className="flex items-center gap-2 text-[var(--text)] font-medium">
                                    <span className="bg-[var(--surface-2)] px-2 py-0.5 rounded-full text-sm border border-[var(--border)]">{email}</span>
                                </div>
                            ) : (
                                <p className="text-[var(--muted)] text-base">{t('auth_login_subtitle')}</p>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center animate-shake">
                            {error}
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-8">
                        {step === 1 ? (
                            <div className="space-y-4">
                                <div className="group relative">
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-transparent border border-[var(--border)] group-focus-within:border-[var(--accent)] rounded-lg py-4 px-4 text-[var(--text)] placeholder-transparent focus:outline-none transition-all peer"
                                        placeholder={t('auth_email')}
                                        id="email"
                                        required
                                        autoFocus
                                    />
                                    <label 
                                        htmlFor="email" 
                                        className={`absolute ${language === 'ar' ? 'right-4' : 'left-4'} -top-2.5 bg-[var(--surface-1)] px-1.5 text-sm text-[var(--accent)] transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-placeholder-shown:text-[var(--muted)] peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-[var(--accent)] pointer-events-none`}
                                    >
                                        {t('auth_email')}
                                    </label>
                                </div>
                                <button type="button" className="text-[var(--muted)] text-sm font-medium hover:text-[var(--accent)] transition-colors px-0.5">
                                    {t('auth_forgot_email')}
                                </button>
                                <p className="text-[var(--muted)] text-sm pt-4">
                                    {t('auth_guest_notice')}{' '}
                                    <Link href="/chat" className="text-[var(--accent)] font-medium hover:underline">
                                        {t('auth_learn_more')}
                                    </Link>
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="group relative">
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-transparent border border-[var(--border)] group-focus-within:border-[var(--accent)] rounded-lg py-4 px-4 text-[var(--text)] placeholder-transparent focus:outline-none transition-all peer"
                                        placeholder={t('auth_enter_password')}
                                        id="password"
                                        required
                                        autoFocus
                                    />
                                    <label 
                                        htmlFor="password" 
                                        className={`absolute ${language === 'ar' ? 'right-4' : 'left-4'} -top-2.5 bg-[var(--surface-1)] px-1.5 text-sm text-[var(--accent)] transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-placeholder-shown:text-[var(--muted)] peer-focus:-top-2.5 peer-focus:text-sm peer-focus:text-[var(--accent)] pointer-events-none`}
                                    >
                                        {t('auth_enter_password')}
                                    </label>
                                </div>
                                <button type="button" onClick={() => setStep(1)} className="text-[var(--accent)] text-sm font-medium hover:underline px-0.5">
                                    {t('auth_change_email')}
                                </button>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex items-center justify-between pt-6">
                            <button 
                                type="button"
                                onClick={() => router.push('/signup')} 
                                className="text-[var(--muted)] text-sm font-medium hover:text-[var(--accent)] px-4 py-2 rounded-md transition-colors"
                            >
                                {t('auth_signup_title')}
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="bg-[var(--surface-2)] hover:bg-[#3c4043] text-[var(--text)] px-8 py-2.5 rounded-full font-bold transition-all shadow-lg active:scale-95 flex items-center gap-2 border border-[var(--border)]"
                            >
                                {loading && <Loader2 className="animate-spin" size={18} />}
                                {step === 1 ? t('auth_next') : t('navbar_login')}
                            </button>
                        </div>
                    </form>
                </div>
            </motion.div>

            {/* Footer */}
            <div className={`w-full max-w-[450px] mt-8 flex flex-col sm:flex-row items-center justify-between text-xs text-[var(--muted)] gap-4 relative ${language === 'ar' ? 'rtl' : 'ltr'}`}>
                <div className="relative">
                    <button 
                        type="button"
                        onClick={() => setIsLangOpen(!isLangOpen)}
                        className="flex items-center gap-1 cursor-pointer hover:bg-[var(--surface-2)] px-3 py-1.5 rounded-md text-[var(--text)] transition-colors border border-transparent hover:border-[var(--border)]"
                    >
                        <span>{currentLanguageLabel}</span>
                        <ChevronDown size={14} className={`transition-transform duration-200 ${isLangOpen ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {isLangOpen && (
                        <div className={`absolute bottom-full mb-2 w-40 bg-[var(--surface-1)] rounded-md shadow-2xl py-1 z-50 overflow-hidden border border-[var(--border)] ${language === 'ar' ? 'right-0' : 'left-0'}`}>
                            {languages.map((lang) => (
                                <button
                                    key={lang.code}
                                    type="button"
                                    onClick={() => {
                                        setLanguage(lang.code as any);
                                        setIsLangOpen(false);
                                    }}
                                    className={`w-full px-4 py-2 hover:bg-[var(--surface-2)] transition-colors ${language === 'ar' ? 'text-right' : 'text-left'} ${language === lang.code ? 'text-[var(--accent)] font-bold' : 'text-[var(--text)]'}`}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-4">
                    <ThemeToggle />
                    <div className="flex items-center gap-6">
                        <button type="button" className="hover:text-[var(--text)] transition-colors">{t('auth_help')}</button>
                        <button type="button" className="hover:text-[var(--text)] transition-colors">{t('auth_privacy')}</button>
                        <button type="button" className="hover:text-[var(--text)] transition-colors">{t('auth_terms')}</button>
                    </div>
                </div>
            </div>
        </main>
    );
}
