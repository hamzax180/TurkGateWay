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
                        throw new Error(t('auth_email_not_found'));
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
            setError(err.message);
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
                    className="absolute inset-0 bg-white/60 dark:bg-black/60 backdrop-blur-[12px]"
                />

                {/* Modal Container */}
                <motion.div
                    initial={{ opacity: 0, scale: 0.98, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: 10 }}
                    className="w-full max-w-[480px] bg-white dark:bg-[#171717] rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-gray-100 dark:border-white/10 relative overflow-hidden z-10"
                >
                    <div className="px-10 py-12 flex flex-col items-center">
                        {/* Close Button */}
                        <button 
                            onClick={() => setIsLoginModalOpen(false)}
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
                                    <Link href="/signup" onClick={() => setIsLoginModalOpen(false)} className="text-[#10a37f] font-medium hover:underline">Sign up</Link>
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
            </div>
        </AnimatePresence>
    );
}
