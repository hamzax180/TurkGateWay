'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface AuthContextType {
    user: { email: string; fullName?: string; isAdmin?: boolean; tokenBalance?: number; subscriptionStatus?: string } | null;
    token: string | null;
    login: (token: string, email: string, fullName?: string, isAdmin?: boolean, tokenBalance?: number, subscriptionStatus?: string) => void;
    logout: () => void;
    isAuthenticated: boolean;
    setTokenBalance: (balance: number) => void;
    lastTokenReset: string | null;
    isLoginModalOpen: boolean;
    setIsLoginModalOpen: (open: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<{ email: string; fullName?: string; isAdmin?: boolean; tokenBalance?: number; subscriptionStatus?: string; lastTokenReset?: string | null } | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

    const getFallbackName = (email: string) => {
        return email.split('@')[0].split(/[._-]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    };

    useEffect(() => {
        const load = async () => {
            const savedToken = localStorage.getItem('permitops_token');
            const savedUser = localStorage.getItem('permitops_user');
            const savedName = localStorage.getItem('permitops_name');
            const savedIsAdmin = localStorage.getItem('permitops_is_admin') === 'true';
            if (savedToken && savedUser) {
                // Set state from localStorage immediately for fast hydration
                setToken(savedToken);
                setUser({ email: savedUser, fullName: savedName || getFallbackName(savedUser), isAdmin: savedIsAdmin });

                // Then verify and sync is_admin from backend in the background
                try {
                    const res = await apiFetch(`/auth/me`, {
                        headers: {
                            'Authorization': `Bearer ${savedToken}`
                        }
                    });
                    if (res && res.ok) {
                        const data = await res.json();
                        const adminStatus = !!data.is_admin;
                        localStorage.setItem('permitops_is_admin', adminStatus ? 'true' : 'false');
                        setUser({ 
                            email: data.email, 
                            fullName: data.full_name || savedName || getFallbackName(savedUser), 
                            isAdmin: adminStatus,
                            tokenBalance: data.token_balance,
                            subscriptionStatus: data.subscription_status,
                            lastTokenReset: data.last_token_reset
                        });
                    } else if (res && res.status === 401) {
                        // Token is invalid/expired - clear it
                        console.warn("Session expired or invalid. Logging out.");
                        logout();
                    }
                } catch (e) {
                    // silently fail — offline or backend down
                }
            } else {
                setToken(null);
                setUser(null);
            }
        };
        
        load();

        const handleStorage = (e: StorageEvent) => {
            if (e.key === 'permitops_token') {
                load();
            }
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const login = (token: string, email: string, fullName?: string, isAdmin?: boolean, tokenBalance?: number, subscriptionStatus?: string) => {
        const name = fullName || getFallbackName(email);
        setToken(token);
        setUser({ email, fullName: name, isAdmin: !!isAdmin, tokenBalance, subscriptionStatus, lastTokenReset: null });
        localStorage.setItem('permitops_token', token);
        localStorage.setItem('permitops_user', email);
        localStorage.setItem('permitops_name', name);
        localStorage.setItem('permitops_is_admin', isAdmin ? 'true' : 'false');
    };

    const setTokenBalance = (balance: number) => {
        setUser(prev => prev ? { ...prev, tokenBalance: balance } : null);
    };

    const logout = () => {
        setToken(null);
        setUser(null);
        localStorage.removeItem('permitops_token');
        localStorage.removeItem('permitops_user');
        localStorage.removeItem('permitops_name');
        localStorage.removeItem('permitops_is_admin');
    };

    return (
        <AuthContext.Provider value={{ 
            user, token, login, logout, 
            isAuthenticated: !!token, 
            setTokenBalance, 
            lastTokenReset: user?.lastTokenReset || null,
            isLoginModalOpen,
            setIsLoginModalOpen
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
