import React, { useState } from 'react';
import { PrismIcon } from './icons/PrismIcon';
import { authService } from '../services/auth';

interface LoginScreenProps {
    onLogin: (email: string, name: string, password?: string) => void;
    onRegister?: (email: string, name: string, password?: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onRegister }) => {
    const [isSignUp, setIsSignUp] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!email || !email.includes('@')) {
            setError("Please enter a valid email address.");
            return;
        }

        if (isSignUp && (!name || !password)) {
            setError("Please fill out all fields.");
            return;
        }

        setIsLoading(true);

        try {
            if (isSignUp) {
                await authService.register(email, password, name);
                const user = await authService.getCurrentUser();
                if (onRegister) {
                    onRegister(email, user?.name || name, password);
                } else {
                    onLogin(email, user?.name || name, password);
                }
            } else {
                await authService.login(email, password);
                const user = await authService.getCurrentUser();
                onLogin(email, user?.name || 'Architect', password);
            }
        } catch (err: any) {
            setError(err.message || 'Authentication failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] dark:bg-[#1A1A1A] p-4 text-gray-900 dark:text-white font-sans selection:bg-black/10 dark:selection:bg-white/10 transition-colors duration-300">
            <div className="max-w-md w-full space-y-10">
                <div className="flex flex-col items-center">
                    <div className="mb-8 text-gray-900 dark:text-white">
                        <PrismIcon size={64} />
                    </div>
                    <h1 className="text-2xl font-black tracking-[0.3em] uppercase text-gray-900 dark:text-white">RamN AI</h1>
                    <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">
                        {isSignUp ? "Create a New Account" : "Enter Credentials to Access the Orchestrator"}
                    </p>
                </div>

                <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl text-center">
                            {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        {isSignUp && (
                            <div>
                                <label htmlFor="name" className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Full Name</label>
                                <input
                                    id="name"
                                    name="name"
                                    type="text"
                                    className="w-full bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-4 text-sm text-gray-900 dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors"
                                    placeholder="Enter your name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                        )}
                        <div>
                            <label htmlFor="email-address" className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Email Address</label>
                            <input
                                id="email-address"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                className="w-full bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-4 text-sm text-gray-900 dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors"
                                placeholder="Enter your email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Password</label>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                autoComplete="current-password"
                                className="w-full bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-xl p-4 text-sm text-gray-900 dark:text-white focus:border-black dark:focus:border-white outline-none transition-colors"
                                placeholder="Enter your password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="pt-4 space-y-4">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full py-4 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl active:scale-[0.98] hover:bg-gray-800 dark:hover:bg-slate-200 disabled:opacity-50"
                        >
                            {isLoading ? 'Processing...' : (isSignUp ? 'Create Account' : 'Initialize Session')}
                        </button>
                    </div>
                </form>

                <div className="text-center mt-4">
                    <button
                        onClick={() => { setIsSignUp(!isSignUp); setError(null); }}
                        className="text-[11px] font-bold text-gray-500 hover:text-gray-900 dark:text-white/50 dark:hover:text-white uppercase tracking-[0.1em] transition-colors"
                    >
                        {isSignUp ? "Already have an account? Log In" : "Need an account? Sign Up"}
                    </button>
                </div>

                <p className="text-center text-[9px] font-mono uppercase tracking-widest text-gray-400 dark:text-white/20 pt-8 border-t border-black/5 dark:border-white/5">
                    Secure Access • Encrypted Session
                </p>
            </div>
        </div>
    );
};
