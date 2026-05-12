'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, Apple, Mail, Phone } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import { useGoogleLogin } from '@react-oauth/google';

export default function LoginModal() {
    const { isLoginModalOpen, setIsLoginModalOpen, login } = useAuth();
    const { t } = useLanguage();
    const router = useRouter();
    
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
                const res = await fetch('http://localhost:8003/auth/check-email', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        throw new Error(t('auth_email_not_found') || "No account found with this email. Please sign up first.");
                    }
                    throw new Error('Verification failed');
                }
                setStep(2);
                return;
            }

            const res = await fetch('http://localhost:8003/auth/login', {
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
            login(data.access_token, data.email, data.full_name, data.is_admin, data.token_balance);
            setIsLoginModalOpen(false);
        } catch (err: any) {
            const msg: string = err.message || '';
            const isNetworkError = msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('load failed');
            setError(isNetworkError ? 'Cannot connect to server. Please try again in a moment.' : msg);
        } finally {
            setLoading(false);
        }
    };

    const googleLogin = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            setLoading(true);
            try {
                const res = await fetch('http://localhost:8003/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_token: tokenResponse.access_token, is_access_token: true }),
                });

                if (!res.ok) throw new Error('Google Login failed');
                const data = await res.json();
                login(data.access_token, data.email, data.full_name, data.is_admin, data.token_balance);
                setIsLoginModalOpen(false);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Google Login Failed'),
    });

    if (!isLoginModalOpen) return null;

    return (
        <AnimatePresence>
            <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 selection:bg-black selection:text-white">
                {/* Backdrop */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsLoginModalOpen(false)}
                    className="absolute inset-0 bg-black/40 dark:bg-black/80 backdrop-blur-[2px]"
                />

                {/* Modal Container — fluid width: 90vw on tiny screens, capped at 340px */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 10 }}
                    style={{ width: 'min(82vw, 270px)' }}
                    className="bg-[var(--surface)] rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] border border-[var(--border)] relative overflow-hidden z-10"
                >
                    <div className="px-4 py-3.5 flex flex-col items-center">
                        {/* Close Button */}
                        <button
                            onClick={() => setIsLoginModalOpen(false)}
                            className="absolute top-3 right-3 p-1 rounded-full text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                        >
                            <X size={15} />
                        </button>

                        <h1 className="font-semibold text-[var(--text)] tracking-tight mb-1.5 text-center" style={{ fontSize: 'clamp(15px, 1.3vw, 19px)' }}>
                            {step === 1 ? 'Log in or sign up' : 'Enter password'}
                        </h1>
                        <p className="text-[var(--muted)] text-center mb-4 px-2 leading-relaxed" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                            {step === 1
                                ? "Log in or sign up to get smarter responses and more."
                                : step === 2 ? `Logging in as ${email}` : `Verifying as ${email}`}
                        </p>

                        <div className="w-full space-y-2">
                            {step === 1 && (
                                <>
                                    <button
                                        onClick={() => googleLogin()}
                                        className="w-full flex items-center justify-center gap-2 border border-[var(--border)] rounded-full hover:bg-[var(--surface-2)] transition-all"
                                        style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                    >
                                        <img src="https://www.google.com/favicon.ico" alt="Google" style={{ width: 'clamp(12px, 1vw, 15px)', height: 'clamp(12px, 1vw, 15px)' }} />
                                        <span className="font-medium text-[var(--text)]" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with Google</span>
                                    </button>

                                    <button
                                        className="w-full flex items-center justify-center gap-2 border border-[var(--border)] rounded-full hover:bg-[var(--surface-2)] transition-all"
                                        style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                    >
                                        <Apple size={14} className="text-[var(--text)]" />
                                        <span className="font-medium text-[var(--text)]" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with Apple</span>
                                    </button>

                                    <button
                                        className="w-full flex items-center justify-center gap-2 border border-[var(--border)] rounded-full hover:bg-[var(--surface-2)] transition-all"
                                        style={{ padding: 'clamp(6px, 0.55vw, 9px) 14px' }}
                                    >
                                        <Phone size={14} className="text-[var(--text)]" />
                                        <span className="font-medium text-[var(--text)]" style={{ fontSize: 'clamp(12px, 0.9vw, 14px)' }}>Continue with phone</span>
                                    </button>

                                    <div className="flex items-center gap-3 py-2">
                                        <div className="flex-1 h-[1px] bg-[var(--border)]" />
                                        <span className="font-medium text-[var(--muted)] uppercase tracking-[0.2em]" style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>or</span>
                                        <div className="flex-1 h-[1px] bg-[var(--border)]" />
                                    </div>
                                </>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-3">
                                {step === 1 ? (
                                    <div className="relative group">
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="Email address"
                                            className="w-full rounded-xl border border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text)] transition-all bg-transparent"
                                            style={{ padding: 'clamp(9px, 0.8vw, 14px) clamp(14px, 1.2vw, 22px)', fontSize: 'clamp(13px, 0.95vw, 15px)' }}
                                            required
                                        />
                                    </div>
                                ) : step === 2 ? (
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="Password"
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
                                    <div className="space-y-1 text-center">
                                        <p className="text-sm text-red-500">{error}</p>
                                        {step === 2 && (error.toLowerCase().includes('incorrect') || error.toLowerCase().includes('password') || error.toLowerCase().includes('unauthorized')) && (
                                            <p className="text-xs text-[var(--muted)]">
                                                No account yet?{' '}
                                                <Link href="/signup" onClick={() => setIsLoginModalOpen(false)} className="text-blue-500 font-medium hover:underline">Sign up instead</Link>
                                            </p>
                                        )}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-full bg-[#000] dark:bg-white text-white dark:text-black font-semibold shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                                    style={{ padding: 'clamp(8px, 0.7vw, 12px) 16px', fontSize: 'clamp(12px, 0.9vw, 14px)' }}
                                >
                                    {loading ? <Loader2 className="animate-spin" size={16} /> : (step === 1 ? 'Continue' : 'Log in')}
                                </button>
                            </form>

                            {step === 1 && (
                                <p className="text-center text-gray-600 dark:text-gray-400 pt-3" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                                    Don't have an account?{' '}
                                    <Link href="/signup" onClick={() => setIsLoginModalOpen(false)} className="text-blue-500 font-medium hover:underline">Sign up</Link>
                                </p>
                            )}

                            {step === 2 && (
                                <button onClick={() => setStep(1)} className="w-full text-center text-gray-500 hover:text-black dark:hover:text-white transition-colors" style={{ fontSize: 'clamp(11px, 0.85vw, 13px)' }}>
                                    Change email address
                                </button>
                            )}
                        </div>

                        {/* Legal Footer */}
                        <div className="mt-4 text-center">
                            <p className="text-gray-500 dark:text-gray-400 leading-relaxed" style={{ fontSize: 'clamp(9px, 0.7vw, 11px)' }}>
                                By joining TurkGateway, you agree to our <Link href="/terms" onClick={() => setIsLoginModalOpen(false)} className="underline hover:text-[var(--text)]">Terms</Link> and have read our <Link href="/privacy" onClick={() => setIsLoginModalOpen(false)} className="underline hover:text-[var(--text)]">Privacy Policy</Link>.
                            </p>
                        </div>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
