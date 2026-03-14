import React, { useState } from 'react';
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
        <div
            className="h-screen overflow-y-auto overflow-x-hidden overscroll-y-contain custom-scrollbar bg-[#f3f5f4] text-gray-950 transition-colors duration-300 selection:bg-emerald-500/20 dark:bg-[#0f1113] dark:text-white relative"
            style={{ WebkitOverflowScrolling: 'touch' }}
        >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute left-[-12%] top-[-8%] h-[28rem] w-[28rem] rounded-full bg-emerald-400/12 blur-3xl dark:bg-emerald-400/10" />
                <div className="absolute right-[-8%] top-[12%] h-[24rem] w-[24rem] rounded-full bg-black/6 blur-3xl dark:bg-white/6" />
                <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.12),transparent_55%)] dark:bg-[radial-gradient(circle_at_top,rgba(110,231,183,0.08),transparent_50%)]" />
            </div>

            <nav className="sticky top-0 z-40 border-b border-black/5 bg-[#f3f5f4]/88 px-6 py-5 backdrop-blur-xl dark:border-white/5 dark:bg-[#0f1113]/86">
                <div className="mx-auto flex max-w-7xl items-center justify-between">
                    <div className="flex items-center gap-3">
                        <RamanIcon size={30} />
                        <div className="flex flex-col">
                            <span className="text-sm font-black uppercase tracking-[0.32em]">RamN AI</span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.24em] text-gray-500 dark:text-white/40">Prism + Memory + ChatBots</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => openAuth('login')} className="rounded-full border border-black/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-600 transition hover:border-black/20 hover:text-gray-900 dark:border-white/10 dark:text-white/60 dark:hover:border-white/20 dark:hover:text-white">
                            Log In
                        </button>
                        <button onClick={() => openAuth('signup')} className="rounded-full bg-gray-950 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white transition hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90">
                            Create Account
                        </button>
                    </div>
                </div>
            </nav>

            <div className="mx-auto max-w-7xl px-6 pb-16 pt-14 md:pb-24 md:pt-20">
                <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
                    <motion.div
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7 }}
                        className="space-y-8"
                    >
                        <div className="inline-flex items-center gap-3 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">
                            <Sparkles size={14} />
                            Raman-Effect Workspace
                        </div>

                        <div className="space-y-6">
                            <h1 className="max-w-4xl text-5xl font-black uppercase leading-[0.88] tracking-[-0.05em] text-gray-950 md:text-7xl dark:text-white">
                                Turn one objective into a deployable
                                <span className="block text-emerald-600 dark:text-emerald-300">Prism-built ChatBot system</span>
                            </h1>
                            <p className="max-w-2xl text-base leading-8 text-gray-600 dark:text-white/62 md:text-lg">
                                RamN AI is built for users who know what they need done but should not have to hand-write prompts, wire tools, or manage memory themselves. Prism turns intent into instructions, selects the right live capability, and deploys a persistent chatbot with real backend state.
                            </p>
                        </div>

                        <div className="flex flex-col gap-4 sm:flex-row">
                            <button
                                onClick={() => openAuth('signup')}
                                className="group inline-flex items-center justify-center gap-3 rounded-2xl bg-gray-950 px-8 py-4 text-[11px] font-black uppercase tracking-[0.24em] text-white transition hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90"
                            >
                                Start Building
                                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                            </button>
                            <button
                                onClick={() => openAuth('login')}
                                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-black/10 bg-white/70 px-8 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-gray-800 transition hover:border-black/20 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80 dark:hover:border-white/20 dark:hover:bg-white/[0.06]"
                            >
                                Resume Workspace
                            </button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="rounded-3xl border border-black/8 bg-white/80 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-white/8 dark:bg-white/[0.03] dark:shadow-none">
                                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                                    <Bot size={20} />
                                </div>
                                <h3 className="text-[13px] font-black uppercase tracking-[0.12em]">Prism Creates</h3>
                                <p className="mt-2 text-[12px] leading-6 text-gray-600 dark:text-white/55">
                                    Users describe the job. Prism writes the system instructions, chooses the toolset, and prepares the chatbot blueprint.
                                </p>
                            </div>
                            <div className="rounded-3xl border border-black/8 bg-white/80 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-white/8 dark:bg-white/[0.03] dark:shadow-none">
                                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                                    <MessageSquare size={20} />
                                </div>
                                <h3 className="text-[13px] font-black uppercase tracking-[0.12em]">Live Runtime</h3>
                                <p className="mt-2 text-[12px] leading-6 text-gray-600 dark:text-white/55">
                                    Only two capabilities are exposed right now: live web search and deep thinking. No fake tools, no surface clutter.
                                </p>
                            </div>
                            <div className="rounded-3xl border border-black/8 bg-white/80 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.06)] dark:border-white/8 dark:bg-white/[0.03] dark:shadow-none">
                                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-black/5 text-gray-900 dark:bg-white/8 dark:text-white">
                                    <Users size={20} />
                                </div>
                                <h3 className="text-[13px] font-black uppercase tracking-[0.12em]">Persistent Context</h3>
                                <p className="mt-2 text-[12px] leading-6 text-gray-600 dark:text-white/55">
                                    UserMap, conversations, and chatbot state live on the backend so the workspace stays consistent across sessions and devices.
                                </p>
                            </div>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.85, delay: 0.08 }}
                        className="space-y-5"
                    >
                        <div className="overflow-hidden rounded-[2rem] border border-black/8 bg-[#101214] shadow-[0_32px_100px_rgba(15,23,42,0.18)] dark:border-white/10">
                            <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
                                <div className="flex items-center gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
                                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-[0.28em] text-white/42">Prism Runtime</span>
                            </div>
                            <div className="grid gap-5 p-5">
                                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                    <div className="mb-3 text-[8px] font-black uppercase tracking-[0.24em] text-emerald-300/70">Objective</div>
                                    <div className="rounded-2xl bg-black/30 px-4 py-3 font-mono text-[12px] leading-6 text-white/82">
                                        Build a chatbot that finds Missouri RFPs from my profile, reasons through fit, and replies with direct sources.
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                    <div className="mb-3 flex items-center justify-between">
                                        <span className="text-[8px] font-black uppercase tracking-[0.24em] text-white/40">Generated Blueprint</span>
                                        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-emerald-300">Ready</span>
                                    </div>
                                    <pre className="overflow-x-auto rounded-2xl bg-black/35 p-4 text-[11px] leading-6 text-white/82 custom-scrollbar">{`role: Procurement Research Analyst
tools: [web-search, thinking]
model: gemini-2.5-pro

rules:
- search the live web when currency matters
- reason before filtering opportunities
- cite the source link in every result
- use profile context as decision criteria`}</pre>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                        <div className="mb-3 text-[8px] font-black uppercase tracking-[0.24em] text-white/40">Capability Rail</div>
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between rounded-xl border border-emerald-400/18 bg-emerald-400/8 px-3 py-2">
                                                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Web Search</span>
                                                <span className="text-[9px] text-white/45">Live</span>
                                            </div>
                                            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                                                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/80">Deep Thinking</span>
                                                <span className="text-[9px] text-white/45">Live</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                                        <div className="mb-3 text-[8px] font-black uppercase tracking-[0.24em] text-white/40">Delivery Guarantees</div>
                                        <div className="space-y-2 text-[11px] leading-5 text-white/65">
                                            <div className="flex items-start gap-2"><HelpCircle size={14} className="mt-0.5 text-emerald-300" /><span>Backend-authoritative conversations and memory</span></div>
                                            <div className="flex items-start gap-2"><HelpCircle size={14} className="mt-0.5 text-emerald-300" /><span>Real Vertex-backed responses and retrieval</span></div>
                                            <div className="flex items-start gap-2"><HelpCircle size={14} className="mt-0.5 text-emerald-300" /><span>No mock loading states or hardcoded outputs</span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="rounded-3xl border border-black/8 bg-white/70 p-5 dark:border-white/8 dark:bg-white/[0.03]">
                                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                                    <Sparkles size={18} />
                                </div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">Prism</div>
                                <p className="mt-3 text-[12px] leading-6 text-gray-600 dark:text-white/58">
                                    Converts plain-English intent into structured system instructions and deployment-ready chatbot blueprints.
                                </p>
                            </div>
                            <div className="rounded-3xl border border-black/8 bg-white/70 p-5 dark:border-white/8 dark:bg-white/[0.03]">
                                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
                                    <Key size={18} />
                                </div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">UserMap</div>
                                <p className="mt-3 text-[12px] leading-6 text-gray-600 dark:text-white/58">
                                    Maintains reusable context and memory so the same account can resume work without starting over each time.
                                </p>
                            </div>
                            <div className="rounded-3xl border border-black/8 bg-white/70 p-5 dark:border-white/8 dark:bg-white/[0.03]">
                                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-black/5 text-gray-900 dark:bg-white/8 dark:text-white">
                                    <Users size={18} />
                                </div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">Collaboration</div>
                                <p className="mt-3 text-[12px] leading-6 text-gray-600 dark:text-white/58">
                                    Build focused chatbots first, then evolve toward team collaboration when a workflow needs multiple specialists.
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </div>

                <div className="mt-16 grid gap-4 border-t border-black/8 pt-8 text-[10px] font-black uppercase tracking-[0.24em] text-gray-500 dark:border-white/8 dark:text-white/34 md:grid-cols-4">
                    <div>Prism-authored instructions</div>
                    <div>Server-side memory + retrieval</div>
                    <div>Live web search + deep thinking</div>
                    <div>Production-backed chatbot runtime</div>
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
                                    {authMode === 'signup' ? 'Create Account' :
                                        authMode === 'otp' ? 'Verification' :
                                            authMode === 'forgot_pass_email' || authMode === 'forgot_pass_reset' ? 'Account Recovery' :
                                                'Sign In'}
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
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
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
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-center text-2xl tracking-[0.5em] font-mono text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
                                                placeholder="000000"
                                                maxLength={6}
                                                value={otp}
                                                onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                                            />
                                        </div>
                                    )}
                                    {authMode === 'forgot_pass_email' && (
                                        <div>
                                            <div className="bg-emerald-500/5 border border-emerald-500/10 text-gray-600 dark:text-white/60 text-xs p-3 rounded-xl text-center mb-4">
                                                Enter your email address to receive a password reset code.
                                            </div>
                                            <label htmlFor="email" className="block text-[9px] font-black text-gray-500 dark:text-white/40 uppercase mb-2 tracking-[0.2em]">Email Address</label>
                                            <input
                                                id="email"
                                                name="email"
                                                type="email"
                                                autoComplete="email"
                                                required
                                                className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
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
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-center text-2xl tracking-[0.5em] font-mono text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors mb-4"
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
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
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
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
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
                                                            className="text-[9px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 transition-colors uppercase tracking-wider"
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
                                                    className="w-full bg-[#F8F9FA] dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-3.5 text-sm text-gray-900 dark:text-white focus:border-emerald-500 dark:focus:border-emerald-400 outline-none transition-colors"
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
                                        className="w-full py-4 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl hover:bg-black dark:hover:bg-white/90 disabled:opacity-50 flex items-center justify-center gap-3"
                                    >
                                        {isLoading && <Loader2 size={16} className="animate-spin" />}
                                        {isLoading ? 'Processing...' : (
                                            authMode === 'signup' ? 'Create Account' :
                                                authMode === 'otp' ? 'Verify Code' :
                                                    authMode === 'forgot_pass_email' ? 'Send Reset Code' :
                                                        authMode === 'forgot_pass_reset' ? 'Reset Password' :
                                                            'Sign In'
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
                                        {authMode === 'signup' ? "Already have an account? Sign In" : "Need an account? Create one"}
                                    </button>
                                    {(authMode === 'forgot_pass_email' || authMode === 'forgot_pass_reset') && (
                                        <button
                                            type="button"
                                            onClick={() => { setAuthMode('login'); setError(null); setResendMessage(null); }}
                                            className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 uppercase tracking-[0.1em] transition-colors"
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
