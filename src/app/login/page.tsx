'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, Apple, Mail, Phone } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import { useGoogleLogin } from '@react-oauth/google';
import { BACKEND_BASE } from '@/app/utils/api';

export default function LoginPage() {
    const { t, language } = useLanguage();
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (step === 1) {
                const res = await fetch(`${BACKEND_BASE}/auth/check-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error(t('auth_email_not_found'));
                    }
                    const data = await res.json().catch(() => null);
                    throw new Error(data?.detail || 'Verification failed');
                }
                setStep(2);
                return;
            }

            const res = await fetch(`${BACKEND_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, mfa_code: mfaCode || undefined }),
            });

            if (!res.ok) {
                const data = await res.json();
                if (res.status === 403 && data.detail === "MFA_REQUIRED") {
                    setStep(3);
                    return;
                }
                throw new Error(data.detail || 'Login failed');
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
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const googleLogin = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            setLoading(true);
            try {
                // We'll need to update the backend to handle access_token or just use the ID token flow.
                // For now, I'll stick to the ID token flow if possible or update the backend.
                // Standard GoogleLogin component is easier for ID tokens, but useGoogleLogin is better for custom UI.
                // I'll assume we can get the ID token or user info.
                
                // Fetching user info manually as a bridge if backend expects ID token
                const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
                });
                const userInfo = await userRes.json();

                // Call our backend with the user info or token
                const res = await fetch(`${BACKEND_BASE}/auth/google`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_token: tokenResponse.access_token, is_access_token: true }),
                });

                if (!res.ok) throw new Error('Google Login failed');
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
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Google Login Failed'),
    });

    return (
        <main className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4 font-sans selection:bg-black selection:text-white transition-colors duration-500 relative overflow-hidden">
            {/* ── Immersive Chat Background Preview ── */}
            <div className="absolute inset-0 z-0 opacity-20 dark:opacity-10 pointer-events-none select-none">
                <div className="h-full w-full flex">
                    {/* Fake Sidebar */}
                    <div className="w-64 border-r border-gray-200 dark:border-white/5 p-6 space-y-4">
                        <div className="h-8 w-32 bg-gray-200 dark:bg-white/10 rounded-lg animate-pulse" />
                        <div className="space-y-2 pt-8">
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="h-10 w-full bg-gray-100 dark:bg-white/5 rounded-xl" />
                            ))}
                        </div>
                    </div>
                    {/* Fake Chat Area */}
                    <div className="flex-1 flex flex-col items-center justify-center p-12">
                        <div className="w-full max-w-2xl space-y-8">
                            <div className="flex gap-4">
                                <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-white/10 shrink-0" />
                                <div className="space-y-2 flex-1">
                                    <div className="h-4 w-3/4 bg-gray-200 dark:bg-white/10 rounded-full" />
                                    <div className="h-4 w-1/2 bg-gray-100 dark:bg-white/5 rounded-full" />
                                </div>
                            </div>
                            <div className="flex gap-4 flex-row-reverse">
                                <div className="h-10 w-10 rounded-full bg-black/5 dark:bg-white/5 shrink-0" />
                                <div className="space-y-2 flex-1 flex flex-col items-end">
                                    <div className="h-4 w-2/3 bg-gray-200 dark:bg-white/10 rounded-full" />
                                    <div className="h-4 w-1/3 bg-gray-100 dark:bg-white/5 rounded-full" />
                                </div>
                            </div>
                        </div>
                        {/* Fake Input */}
                        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-full max-w-2xl h-16 bg-white dark:bg-[#171717] rounded-2xl border border-gray-200 dark:border-white/10 shadow-sm flex items-center px-6 gap-4">
                            <div className="h-6 w-6 rounded-md bg-gray-100 dark:bg-white/5" />
                            <div className="h-4 w-48 bg-gray-100 dark:bg-white/10 rounded-full" />
                        </div>
                    </div>
                </div>
                {/* Overlay Blur */}
                <div className="absolute inset-0 bg-white/40 dark:bg-black/40 backdrop-blur-[10px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                style={{ width: 'min(82vw, 270px)' }}
                className="bg-white dark:bg-[#0f0f0f] rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] border border-gray-100 dark:border-white/[0.08] relative overflow-hidden z-10"
            >
                <div className="px-4 py-3.5 flex flex-col items-center">
                    {/* Close Button */}
                    <button 
                        onClick={() => router.push('/')}
                        className="absolute top-3 right-3 p-1 rounded-full text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                    >
                        <X size={15} />
                    </button>

                    <h1 className="font-semibold text-gray-900 dark:text-white tracking-tight mb-1.5 text-center" style={{ fontSize: 'clamp(15px, 1.3vw, 19px)' }}>
                        {step === 1 ? 'Log in or sign up' : 'Enter password'}
                    </h1>
                    <p className="text-gray-600 dark:text-gray-400 text-center mb-4 px-2 leading-relaxed" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                        {step === 1 
                            ? "You'll get smarter responses and can upload files, images, and more."
                            : `Logging in as ${email}`}
                    </p>

                    <div className="w-full space-y-2">
                        {step === 1 && (
                            <>
                                <button
                                    onClick={() => googleLogin()}
                                    className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                    style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                >
                                    <img src="https://www.google.com/favicon.ico" alt="Google" style={{ width: 'clamp(12px, 1vw, 15px)', height: 'clamp(12px, 1vw, 15px)' }} />
                                    <span className="font-medium text-gray-900 dark:text-white" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with Google</span>
                                </button>

                                <button
                                    className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                    style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                >
                                    <Apple size={14} className="text-gray-900 dark:text-white" />
                                    <span className="font-medium text-gray-900 dark:text-white" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with Apple</span>
                                </button>

                                <button
                                    className="w-full flex items-center justify-center gap-2 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                    style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                >
                                    <Phone size={14} className="text-gray-900 dark:text-white" />
                                    <span className="font-medium text-gray-900 dark:text-white" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with phone</span>
                                </button>

                                <div className="flex items-center gap-3 py-2">
                                    <div className="flex-1 h-[1px] bg-gray-200 dark:bg-white/10" />
                                    <span className="font-medium text-gray-400 uppercase tracking-[0.2em]" style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>or</span>
                                    <div className="flex-1 h-[1px] bg-gray-200 dark:bg-white/10" />
                                </div>
                            </>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-3">
                            {step === 1 ? (
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={t('auth_email') || "Email address"}
                                    className="w-full rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-gray-900 dark:text-white transition-all bg-transparent"
                                    style={{ padding: 'clamp(9px, 0.8vw, 14px) clamp(14px, 1.2vw, 22px)', fontSize: 'clamp(13px, 0.95vw, 15px)' }}
                                    required
                                />
                            ) : step === 2 ? (
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={t('auth_password') || "Password"}
                                    className="w-full rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-gray-900 dark:text-white transition-all bg-transparent"
                                    style={{ padding: 'clamp(9px, 0.8vw, 14px) clamp(14px, 1.2vw, 22px)', fontSize: 'clamp(13px, 0.95vw, 15px)' }}
                                    required
                                    autoFocus
                                />
                            ) : (
                                <input
                                    type="text"
                                    value={mfaCode}
                                    onChange={(e) => setMfaCode(e.target.value)}
                                    placeholder="6-digit code"
                                    maxLength={6}
                                    className="w-full rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none font-mono tracking-widest text-center text-gray-900 dark:text-white transition-all bg-transparent"
                                    style={{ padding: 'clamp(9px, 0.8vw, 14px) clamp(14px, 1.2vw, 22px)', fontSize: 'clamp(14px, 1.1vw, 18px)' }}
                                    required
                                    autoFocus
                                />
                            )}

                            {error && (
                                <p className="text-sm text-red-500 text-center">{error}</p>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full rounded-full bg-[#000] dark:bg-white text-white dark:text-black font-semibold shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                                style={{ padding: 'clamp(8px, 0.7vw, 12px) 16px', fontSize: 'clamp(12px, 0.9vw, 14px)' }}
                            >
                                {loading ? <Loader2 className="animate-spin" size={16} /> : (step === 1 ? (t('auth_next') || 'Continue') : 'Log in')}
                            </button>
                        </form>

                        {step === 1 && (
                            <p className="text-center text-gray-600 dark:text-gray-400 pt-3" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                                {t('auth_no_account') || "Don't have an account?"}{' '}
                                <Link href="/signup" className="text-blue-500 font-medium hover:underline">{t('auth_signup_title') || "Sign up"}</Link>
                            </p>
                        )}
                        
                        {step === 2 && (
                            <button onClick={() => setStep(1)} className="w-full text-center text-gray-500 hover:text-black dark:hover:text-white transition-colors" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                                {t('auth_change_email') || "Change email address"}
                            </button>
                        )}
                    </div>

                    {/* Legal Footer Section from Screenshot */}
                    <div className="mt-4 text-center">
                         <p className="text-gray-500 dark:text-gray-400 leading-relaxed" style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>
                            By joining TurkGateway, you agree to our <Link href="/terms" className="underline hover:text-black dark:hover:text-white">Terms</Link> and have read our <Link href="/privacy" className="underline hover:text-black dark:hover:text-white">Privacy Policy</Link>.
                         </p>
                    </div>
                </div>
            </motion.div>
        </main>
    );
}
