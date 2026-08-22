'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Loader2, X, ChevronDown } from 'lucide-react';
import ThemeToggle from '@/app/components/ThemeToggle';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import { BACKEND_BASE } from '@/app/utils/api';

export default function SignupPage() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1);
    const [isLangOpen, setIsLangOpen] = useState(false);
    const { setLanguage } = useLanguage();

    const languages = [
        { code: 'en', label: t('footer_english') },
        { code: 'tr', label: t('footer_turkish') },
        { code: 'ar', label: t('footer_arabic') },
        { code: 'tk', label: t('footer_turkmen') },
    ];

    const currentLanguageLabel = languages.find(l => l.code === language)?.label || 'Language';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (step === 1 && fullName && email) {
            setStep(2);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const res = await fetch(`${BACKEND_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, full_name: fullName }),
            });

            if (!res.ok) {
                const data = await res.json();
                let errorMessage = 'Registration failed';
                if (data.detail) {
                    if (Array.isArray(data.detail)) {
                        errorMessage = data.detail.map((err: any) => err.msg).join(', ');
                    } else if (typeof data.detail === 'string') {
                        errorMessage = data.detail;
                    }
                }
                throw new Error(errorMessage);
            }

            const data = await res.json();
            login(
                data.access_token,
                data.email,
                data.full_name,
                data.is_admin,
                data.token_balance,
                data.subscription_status,
                data.last_token_reset
            );
            router.push('/applications');
        } catch (err: any) {
            // Only go back to step 1 for email-related errors (e.g. already registered)
            // Network errors ("Failed to fetch") should stay on step 2 so the user can retry
            const msg: string = err.message || '';
            const isNetworkError = msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('load failed');
            const isEmailError = msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('email');
            if (isNetworkError) {
                setError('Cannot connect to server. Please make sure the backend is running and try again.');
            } else {
                setError(msg || 'Registration failed');
                if (isEmailError) setStep(1);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className="auth-canvas min-h-screen flex items-center justify-center p-4 font-sans selection:bg-black selection:text-white transition-colors duration-500 relative overflow-hidden">
            {/* ── Immersive Chat Background Preview ── */}
            <div className="auth-preview absolute inset-0 z-0 pointer-events-none select-none">
                <div className="h-full w-full flex">
                    {/* Fake Sidebar */}
                    <div className="auth-skel-divider w-64 border-r p-6 space-y-4">
                        <div className="auth-skel-1 h-8 w-32 rounded-lg animate-pulse" />
                        <div className="space-y-2 pt-8">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="auth-skel-2 h-10 w-full rounded-xl" />
                            ))}
                        </div>
                    </div>
                    {/* Fake Chat Area */}
                    <div className="flex-1 flex flex-col items-center justify-center p-12">
                        <div className="w-full max-w-2xl space-y-8">
                            <div className="flex gap-4">
                                <div className="auth-skel-1 h-10 w-10 rounded-full shrink-0" />
                                <div className="space-y-2 flex-1">
                                    <div className="auth-skel-1 h-4 w-3/4 rounded-full" />
                                    <div className="auth-skel-2 h-4 w-1/2 rounded-full" />
                                </div>
                            </div>
                            <div className="flex gap-4 flex-row-reverse">
                                <div className="auth-skel-2 h-10 w-10 rounded-full shrink-0" />
                                <div className="space-y-2 flex-1 flex flex-col items-end">
                                    <div className="auth-skel-1 h-4 w-2/3 rounded-full" />
                                    <div className="auth-skel-2 h-4 w-1/3 rounded-full" />
                                </div>
                            </div>
                        </div>
                        {/* Fake Input */}
                        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 auth-skel-card w-full max-w-2xl h-16 rounded-2xl border shadow-sm flex items-center px-6 gap-4">
                            <div className="auth-skel-2 h-6 w-6 rounded-md" />
                            <div className="auth-skel-2 h-4 w-48 rounded-full" />
                        </div>
                    </div>
                </div>
                {/* Overlay Blur */}
                <div className="auth-veil absolute inset-0 backdrop-blur-[10px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="auth-card w-full max-w-[400px] bg-white rounded-[24px] border relative overflow-hidden z-10"
            >
                <div className="px-8 py-8 flex flex-col items-center">
                    {/* Close Button */}
                    <button 
                        onClick={() => router.push('/')}
                        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>

                    <h1 className="text-[32px] font-semibold text-gray-900 dark:text-white tracking-tight mb-3 text-center">
                        {step === 1 ? t('auth_signup_title') : 'Enter password'}
                    </h1>
                    <p className="text-[15px] text-gray-600 dark:text-gray-400 text-center mb-6 px-4 leading-relaxed">
                        {step === 1 
                            ? t('auth_signup_subtitle')
                            : `Signing up as ${email}`}
                    </p>

                    <div className="w-full space-y-4">
                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                                {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {step === 1 ? (
                                <div className="space-y-4">
                                    <input
                                        type="text"
                                        value={fullName}
                                        onChange={(e) => setFullName(e.target.value)}
                                        placeholder={t('auth_full_name')}
                                        className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[16px] text-gray-900 dark:text-white transition-all bg-transparent"
                                        required
                                        autoFocus
                                    />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder={t('auth_email')}
                                        className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[16px] text-gray-900 dark:text-white transition-all bg-transparent"
                                        required
                                    />
                                </div>
                            ) : (
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('auth_enter_password')}
                                    className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[16px] text-gray-900 dark:text-white transition-all bg-transparent"
                                    required
                                    minLength={8}
                                    autoFocus
                                />
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-3.5 rounded-full bg-[#000] dark:bg-white text-white dark:text-black font-semibold text-[15px] shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                            >
                                {loading && <Loader2 className="animate-spin" size={20} />}
                                {step === 1 ? t('auth_next') : t('auth_signup_title')}
                            </button>
                        </form>

                        <p className="text-center text-[14px] text-gray-600 dark:text-gray-400 pt-4">
                            Already have an account?{' '}
                            <Link href="/login" className="text-blue-500 font-medium hover:underline">{t('auth_signin_instead')}</Link>
                        </p>

                        {/* Legal Footer Section from Screenshot */}
                        <div className="mt-6 text-center">
                             <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                                By joining TurkGateway, you agree to our <Link href="/terms" className="underline hover:text-black dark:hover:text-white">Terms</Link> and have read our <Link href="/privacy" className="underline hover:text-black dark:hover:text-white">Privacy Policy</Link>.
                             </p>
                        </div>
                    </div>
                </div>
            </motion.div>
        </main>
    );
}
