import React, { useState } from 'react';
import { PrismIcon } from './icons/PrismIcon';
import { RamanIcon } from './icons/RamanIcon';
import { motion, AnimatePresence } from 'motion/react';
import { Key, Bot, Users, MessageSquare, Sparkles, HelpCircle, ArrowRight, Loader2 } from 'lucide-react';
import { authService } from '../services/auth';

interface LoginScreenProps {
    onLogin: (email: string, name: string, password?: string) => void;
    onRegister?: (email: string, name: string, password?: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onRegister }) => {
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState<'login' | 'signup' | 'otp' | 'forgot_pass_email' | 'forgot_pass_reset'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [otp, setOtp] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resendMessage, setResendMessage] = useState<string | null>(null);

    const handleResendOTP = async () => {
        try {
            setResendMessage(null);
            setError(null);
            await authService.resendVerificationCode(email);
            setResendMessage('A new verification code has been sent to your email.');
        } catch (err: any) {
            setError(err.message || 'Failed to resend code.');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setResendMessage(null);

        if (authMode !== 'otp' && authMode !== 'forgot_pass_reset') {
            if (!email || !email.includes('@')) {
                setError("Please enter a valid email address.");
                return;
            }
        }

        if (authMode === 'signup' && (!name || !password)) {
            setError("Please fill out all fields.");
            return;
        }
        if (authMode === 'login' && !password) {
            setError("Please enter your password.");
            return;
        }
        if (authMode === 'forgot_pass_reset' && (!otp || !password)) {
            setError("Please enter the reset code and your new password.");
            return;
        }

        setIsLoading(true);

        try {
            if (authMode === 'signup') {
                // Real Cognito registration (triggers OTP)
                await authService.register(email, password, name);
                setAuthMode('otp');
                setOtp('');
                setIsLoading(false);
                return;
            } else if (authMode === 'otp') {
                // Real Cognito OTP verification
                await authService.verifyOtp(email, otp);

                // After verification, we auto-login
                await authService.login(email, password);
                const user = await authService.getCurrentUser();

                if (onRegister) {
                    onRegister(email, user?.name || name, password);
                } else {
                    onLogin(email, user?.name || name, password);
                }
            } else if (authMode === 'login') {
                await authService.login(email, password);
                const user = await authService.getCurrentUser();
                onLogin(email, user?.name || 'Architect', password);
            } else if (authMode === 'forgot_pass_email') {
                await authService.forgotPassword(email);
                setAuthMode('forgot_pass_reset');
                setOtp('');
                setPassword('');
                setResendMessage('Reset code sent to your email.');
            } else if (authMode === 'forgot_pass_reset') {
                await authService.confirmPassword(email, otp, password);
                setAuthMode('login');
                setPassword('');
                setResendMessage('Password reset successful. Please log in.');
            }
        } catch (err: any) {
            setError(err.message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    const openAuth = (mode: 'login' | 'signup') => {
        setAuthMode(mode);
        setShowAuthModal(true);
        setError(null);
        setResendMessage(null);
    };

    return (
        <div className="min-h-screen bg-[#F8F9FA] dark:bg-[#1A1A1A] text-gray-900 dark:text-white font-sans selection:bg-black/10 dark:selection:bg-white/10 transition-colors duration-300 overflow-y-auto custom-scrollbar relative">

            {/* Navigation Bar */}
            <nav className="fixed top-0 left-0 right-0 p-6 flex justify-between items-center z-40 bg-[#F8F9FA]/80 dark:bg-[#1A1A1A]/80 backdrop-blur-md border-b border-black/5 dark:border-white/5">
                <div className="flex items-center gap-3">
                    <RamanIcon size={28} />
                    <span className="font-black tracking-widest uppercase text-sm">RamN AI</span>
                </div>
                <div className="flex items-center gap-4">
                    <button onClick={() => openAuth('login')} className="text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 dark:text-white/60 dark:hover:text-white transition-colors">
                        Log In
                    </button>
                    <button onClick={() => openAuth('signup')} className="px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-lg transition-all shadow-lg hover:bg-gray-800 dark:hover:bg-slate-200">
                        Get Started
                    </button>
                </div>
            </nav>

            {/* Hero Section */}
            <div className="max-w-5xl mx-auto px-6 pt-40 pb-20 md:py-48">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="flex flex-col items-center text-center space-y-12"
                >
                    <div className="text-gray-900 dark:text-white/30 hidden md:block">
                        <RamanIcon size={100} />
                    </div>

                    <div className="space-y-6 max-w-4xl">
                        <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter text-gray-900 dark:text-white uppercase leading-[0.9]">
                            RamN <br /><span className="text-indigo-500 dark:text-indigo-400">AI</span>
                        </h1>
                        <p className="text-lg md:text-xl text-gray-600 dark:text-white/60 font-medium max-w-2xl mx-auto leading-relaxed">
                            AI Agents Made Simple. Stop managing AI. Let AI manage your work.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 pt-4">
                        <button
                            onClick={() => openAuth('signup')}
                            className="group flex items-center justify-center gap-3 px-10 py-5 bg-indigo-600 dark:bg-indigo-500 text-white text-xs font-black uppercase tracking-[0.2em] rounded-2xl transition-all shadow-2xl shadow-indigo-500/20 hover:bg-indigo-700 dark:hover:bg-indigo-400 active:scale-[0.98]"
                        >
                            Initialize Session
                            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                        </button>
                    </div>
                </motion.div>

                {/* Features Section */}
                <div className="w-full pt-32 space-y-24">
                    <div className="space-y-6 text-center max-w-3xl mx-auto">
                        <h2 className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-[0.5em]">The Ecosystem</h2>
                        <h3 className="text-3xl md:text-4xl font-black uppercase tracking-tight">Beyond Single-Prompt Chatbots</h3>
                        <p className="text-sm md:text-base text-gray-600 dark:text-white/50 leading-relaxed">
                            RamN AI bridges the gap between isolated AI interactions and true collaborative workflows. Assemble a <strong className="text-gray-900 dark:text-white">Spectrum</strong> of uniquely prompted agents equipped with integrated tools, and deploy them to solve multi-step problems.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="p-8 bg-white dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-3xl space-y-4 shadow-xl shadow-black/5 dark:shadow-none">
                            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400">
                                <Users size={24} />
                            </div>
                            <h4 className="text-lg font-bold uppercase tracking-tight">Multi-Agent Squads</h4>
                            <p className="text-sm text-gray-600 dark:text-white/50 leading-relaxed">
                                Create independent agents and combine them into collaborative Teams. Tag them via @mentions to cross-reference their expertise.
                            </p>
                        </div>
                        <div className="p-8 bg-white dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-3xl space-y-4 shadow-xl shadow-black/5 dark:shadow-none">
                            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 dark:text-amber-400">
                                <Sparkles size={24} />
                            </div>
                            <h4 className="text-lg font-bold uppercase tracking-tight">Multi-Model Engine</h4>
                            <p className="text-sm text-gray-600 dark:text-white/50 leading-relaxed">
                                Don't rely on just one brain. Route tasks through Gemini 2.0, Claude 3.5, GPT-4o, or Llama 3 to leverage their unique strengths.
                            </p>
                        </div>
                        <div className="p-8 bg-white dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-3xl space-y-4 shadow-xl shadow-black/5 dark:shadow-none">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 dark:text-emerald-400">
                                <Key size={24} />
                            </div>
                            <h4 className="text-lg font-bold uppercase tracking-tight">Integrated Tools</h4>
                            <p className="text-sm text-gray-600 dark:text-white/50 leading-relaxed">
                                Equip agents with live web search, weather arrays, image generation, financial ledgers, and deep RAG knowledge bases.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="mt-32 pt-12 border-t border-black/10 dark:border-white/5 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-3 opacity-50">
                        <RamanIcon size={24} />
                        <span className="text-[10px] font-black uppercase tracking-widest">RamN AI Platform &copy; 2026</span>
                    </div>
                    <div className="flex gap-6 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 transition-colors">
                        <span>Status: Operational</span>
                    </div>
                </div>
            </div>

            {/* Auth Modal Overlay */}
            <AnimatePresence>
                {showAuthModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            className="relative w-full max-w-md bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl p-8"
                        >
                            <button
                                onClick={() => setShowAuthModal(false)}
                                className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 dark:hover:text-white bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full transition-colors z-10"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>

                            <div className="flex flex-col items-center mb-8 relative">
                                <div className="mb-6 text-gray-900 dark:text-white">
                                    <RamanIcon size={48} />
                                </div>
                                <h2 className="text-xl font-black tracking-[0.2em] uppercase text-gray-900 dark:text-white text-center">
                                    {authMode === 'signup' ? 'Create Workspace' :
                                        authMode === 'otp' ? 'Verification' :
                                            authMode === 'forgot_pass_email' || authMode === 'forgot_pass_reset' ? 'Account Recovery' :
                                                'Access Workspace'}
                                </h2>
                            </div>

                            <form className="space-y-5" onSubmit={handleSubmit}>
                                {resendMessage && !error && (
                                    <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs p-3 rounded-xl text-center font-bold">
                                        {resendMessage}
                                    </div>
                                )}
                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/20 text-red-500 dark:text-red-400 text-xs p-3 rounded-xl text-center font-bold">
                                        {error}
                                    </div>
                                )}

                                <div className="space-y-4">
                                    {authMode === 'signup' && (
                                        <div>
                                            <label htmlFor="fullName" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Full Name</label>
                                            <input
                                                id="fullName"
                                                name="name"
                                                type="text"
                                                autoComplete="name"
                                                required={authMode === 'signup'}
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                placeholder="Enter your name"
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                            />
                                        </div>
                                    )}

                                    {authMode === 'otp' && (
                                        <div>
                                            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs p-3 rounded-xl text-center font-bold mb-4">
                                                Check your email for the verification code.
                                            </div>
                                            <label htmlFor="otp" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Verification Code (OTP)</label>
                                            <input
                                                id="otp"
                                                name="otp"
                                                type="text"
                                                autoComplete="one-time-code"
                                                required
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-center text-2xl tracking-[0.5em] font-mono text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                placeholder="000000"
                                                maxLength={6}
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                                            />
                                        </div>
                                    )}
                                    {authMode === 'forgot_pass_email' && (
                                        <div>
                                            <div className="bg-indigo-500/5 border border-indigo-500/10 text-gray-600 dark:text-white/60 text-xs p-3 rounded-xl text-center mb-4">
                                                Enter your email address to receive a password reset code.
                                            </div>
                                            <label htmlFor="email" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Email Address</label>
                                            <input
                                                id="email"
                                                name="email"
                                                type="email"
                                                autoComplete="email"
                                                required
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                placeholder="Enter your email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                            />
                                        </div>
                                    )}

                                    {authMode === 'forgot_pass_reset' && (
                                        <>
                                            <div>
                                                <label htmlFor="otp" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Reset Code</label>
                                                <input
                                                    id="otp"
                                                    name="otp"
                                                    type="text"
                                                    autoComplete="one-time-code"
                                                    required
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-center text-2xl tracking-[0.5em] font-mono text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors mb-4"
                                                    placeholder="000000"
                                                    maxLength={6}
                                                    value={otp}
                                                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor="password" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">New Password</label>
                                                <input
                                                    id="password"
                                                    name="password"
                                                    type="password"
                                                    autoComplete="new-password"
                                                    required
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                    placeholder="Enter new password"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {(authMode === 'login' || authMode === 'signup') && (
                                        <>
                                            <div>
                                                <label htmlFor="email" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Email Address</label>
                                                <input
                                                    id="email"
                                                    name="email"
                                                    type="email"
                                                    autoComplete="email"
                                                    required
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                    placeholder="Enter your email"
                                                    value={email}
                                                    onChange={(e) => setEmail(e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <label htmlFor="password" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">Password</label>
                                                    {authMode === 'login' && (
                                                        <button
                                                            type="button"
                                                            onClick={(() => { setAuthMode('forgot_pass_email'); setError(null); setResendMessage(null); })}
                                                            className="text-[9px] font-bold text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors uppercase tracking-wider"
                                                        >
                                                            Forgot?
                                                        </button>
                                                    )}
                                                </div>
                                                <input
                                                    id="password"
                                                    name="password"
                                                    type="password"
                                                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                                                    required
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none transition-colors"
                                                    placeholder="Enter your password"
                                                    value={password}
                                                    onChange={(e) => setPassword(e.target.value)}
                                                />
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="pt-2">
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="w-full py-4 bg-indigo-600 dark:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl hover:bg-indigo-700 dark:hover:bg-indigo-400 disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        {isLoading && <Loader2 size={16} className="animate-spin" />}
                                        {isLoading ? 'Processing...' : (
                                            authMode === 'signup' ? 'Initialize' :
                                                authMode === 'otp' ? 'Verify Code' :
                                                    authMode === 'forgot_pass_email' ? 'Send Code' :
                                                        authMode === 'forgot_pass_reset' ? 'Reset Password' :
                                                            'Authenticate'
                                        )}
                                    </button>
                                </div>
                                {authMode === 'otp' && (
                                    <div className="text-center mt-4">
                                        <button
                                            type="button"
                                            onClick={handleResendOTP}
                                            disabled={isLoading}
                                            className="text-[10px] font-bold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white uppercase tracking-[0.1em] transition-colors"
                                        >
                                            Didn't receive code? Resend
                                        </button>
                                    </div>
                                )}
                            </form>

                            {authMode !== 'otp' && (
                                <div className="text-center mt-6 flex flex-col gap-3">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAuthMode(authMode === 'login' ? 'signup' : 'login');
                                            setError(null);
                                            setResendMessage(null);
                                        }}
                                        className="text-[10px] font-bold text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white uppercase tracking-[0.1em] transition-colors"
                                    >
                                        {authMode === 'signup' ? "Already have account? Log In" : "Need workspace? Create Account"}
                                    </button>
                                    {(authMode === 'forgot_pass_email' || authMode === 'forgot_pass_reset') && (
                                        <button
                                            type="button"
                                            onClick={() => { setAuthMode('login'); setError(null); setResendMessage(null); }}
                                            className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 uppercase tracking-[0.1em] transition-colors"
                                        >
                                            Return to Login
                                        </button>
                                    )}
                                </div>
                            )}
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
