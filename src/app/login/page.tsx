'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import Navbar from '../components/Navbar';

export default function LoginPage() {
    const { t } = useLanguage();
    const router = useRouter();
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
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
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
        <Navbar />
        <main className="min-h-screen relative flex items-center justify-center p-6 overflow-hidden">
            {/* Background */}
            <div className="absolute inset-0 bg-[var(--bg)] z-0">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-purple-500/10 animate-pulse" />
            </div>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md relative z-10"
            >
                <div className="glass-card p-10 space-y-8 shadow-2xl">
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight text-[var(--text)]">{t('auth_login_title')}</h1>
                        <p className="text-[var(--muted)] text-sm">{t('auth_login_subtitle')}</p>
                    </div>

                    {error && (
                        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{t('auth_email')}</label>
                            <div className="relative">
                                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl py-3.5 pl-12 pr-4 text-[var(--text)] focus:outline-none focus:border-purple-500 transition-colors"
                                    placeholder="name@company.com"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">{t('auth_password')}</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl py-3.5 pl-12 pr-4 text-[var(--text)] focus:outline-none focus:border-purple-500 transition-colors"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full btn btn-purple !py-4 justify-center text-sm font-bold shadow-xl shadow-purple-500/20"
                        >
                            {loading ? <Loader2 className="animate-spin" size={20} /> : (
                                <>{t('navbar_login')} <ArrowRight size={18} className="ml-2" /></>
                            )}
                        </button>
                    </form>

                    <p className="text-center text-sm text-[var(--muted)]">
                        {t('auth_no_account')}{' '}
                        <Link href="/signup" className="text-purple-400 hover:text-purple-300 font-bold">
                            {t('navbar_signup')}
                        </Link>
                    </p>
                </div>
            </motion.div>
        </main>
        </>
    );
}
