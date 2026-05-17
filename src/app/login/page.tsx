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
                    throw new Error('Verification failed');
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
            login(data.access_token, data.email, data.full_name, data.is_admin, data.token_balance);
            router.push('/dashboard');
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
                login(data.access_token, data.email, data.full_name, data.is_admin, data.token_balance);
                router.push('/dashboard');
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        },
        onError: () => setError('Google Login Failed'),
    });

    return (
        <main className="min-h-screen bg-[#fff] dark:bg-[#000] flex items-center justify-center p-4 font-sans selection:bg-black selection:text-white transition-colors duration-500 relative overflow-hidden">
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
                className="w-full max-w-[480px] bg-white dark:bg-[#171717] rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 dark:border-white/10 relative overflow-hidden z-10"
            >
                <div className="px-10 py-12 flex flex-col items-center">
                    {/* Close Button */}
                    <button 
                        onClick={() => router.push('/')}
                        className="absolute top-6 right-6 p-2 text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                    >
                        <X size={20} />
                    </button>

                    <h1 className="text-[32px] font-semibold text-gray-900 dark:text-white tracking-tight mb-4 text-center">
                        {step === 1 ? 'Log in or sign up' : 'Enter password'}
                    </h1>
                    <p className="text-[15px] text-gray-600 dark:text-gray-400 text-center mb-10 px-4 leading-relaxed">
                        {step === 1 
                            ? "You'll get smarter responses and can upload files, images, and more."
                            : `Logging in as ${email}`}
                    </p>

                    <div className="w-full space-y-3">
                        {step === 1 && (
                            <>
                                <button
                                    onClick={() => googleLogin()}
                                    className="w-full flex items-center justify-center gap-3 py-3 px-6 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                >
                                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
                                    <span className="text-[15px] font-medium text-gray-900 dark:text-white">Continue with Google</span>
                                </button>

                                <button
                                    className="w-full flex items-center justify-center gap-3 py-3 px-6 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                >
                                    <Apple size={18} className="text-gray-900 dark:text-white" />
                                    <span className="text-[15px] font-medium text-gray-900 dark:text-white">Continue with Apple</span>
                                </button>

                                <button
                                    className="w-full flex items-center justify-center gap-3 py-3 px-6 border border-gray-300 dark:border-white/20 rounded-full hover:bg-gray-50 dark:hover:bg-white/5 transition-all"
                                >
                                    <Phone size={18} className="text-gray-900 dark:text-white" />
                                    <span className="text-[15px] font-medium text-gray-900 dark:text-white">Continue with phone</span>
                                </button>

                                <div className="flex items-center gap-4 py-4">
                                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                                    <span className="relative px-3 bg-white dark:bg-[#171717] text-[10px] font-black text-gray-400 uppercase tracking-widest">OR</span>
                                    <div className="flex-1 h-px bg-gray-200 dark:bg-white/10" />
                                </div>
                            </>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {step === 1 ? (
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="Email address"
                                    className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[16px] text-gray-900 dark:text-white transition-all bg-transparent"
                                    required
                                />
                            ) : step === 2 ? (
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Password"
                                    className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[16px] text-gray-900 dark:text-white transition-all bg-transparent"
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
                                    className="w-full px-6 py-4 rounded-xl border border-gray-300 dark:border-white/20 focus:border-black dark:focus:border-white outline-none text-[20px] font-mono tracking-widest text-center text-gray-900 dark:text-white transition-all bg-transparent"
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
                                className="w-full py-3.5 rounded-full bg-[#000] dark:bg-white text-white dark:text-black font-semibold text-[15px] shadow-sm hover:opacity-90 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" size={20} /> : (step === 1 ? 'Continue' : 'Log in')}
                            </button>
                        </form>

                        {step === 1 && (
                            <p className="text-center text-[14px] text-gray-600 dark:text-gray-400 pt-4">
                                Don't have an account?{' '}
                                <Link href="/signup" className="text-[#10a37f] font-medium hover:underline">Sign up</Link>
                            </p>
                        )}
                        
                        {step === 2 && (
                            <button onClick={() => setStep(1)} className="w-full text-center text-[13px] text-gray-500 hover:text-black dark:hover:text-white transition-colors">
                                Change email address
                            </button>
                        )}
                    </div>

                    {/* Legal Footer Section from Screenshot */}
                    <div className="mt-12 text-center">
                         <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                            By joining TurkGateway, you agree to our <Link href="/terms" className="underline hover:text-black dark:hover:text-white">Terms</Link> and have read our <Link href="/privacy" className="underline hover:text-black dark:hover:text-white">Privacy Policy</Link>.
                         </p>
                    </div>
                </div>
            </motion.div>
        </main>
    );
}
