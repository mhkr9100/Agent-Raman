import React from 'react';
import { RamanIcon } from './icons/RamanIcon';
import { motion } from 'motion/react';
import { Key, Bot, Users, MessageSquare, Sparkles, HelpCircle } from 'lucide-react';

interface HomeViewProps {
    onStartChat: () => void;
    onOpenProfile: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ onStartChat, onOpenProfile }) => {
    return (
        <div className="flex-1 overflow-y-auto bg-[#F8F9FA] dark:bg-[#1A1A1A] text-gray-900 dark:text-white custom-scrollbar">
            <div className="max-w-5xl mx-auto px-6 py-20 md:py-32">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8 }}
                    className="flex flex-col items-center text-center space-y-12"
                >
                    <div className="text-gray-900 dark:text-white/30">
                        <RamanIcon size={120} />
                    </div>

                    <div className="space-y-6">
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-gray-900 dark:text-white uppercase leading-none">
                            RamN <span className="text-gray-400 dark:text-white/20">AI</span>
                            <span className="text-[12px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-bold ml-4 align-top border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 rounded px-2 py-0.5">Beta</span>
                        </h1>
                        <p className="text-lg md:text-xl text-gray-600 dark:text-white/60 font-medium max-w-2xl mx-auto leading-relaxed">
                            A unified platform for multi-agent collaboration. Deploy specialized AI units,
                            build autonomous squads, and orchestrate complex workflows.
                        </p>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 pt-4">
                        <button
                            onClick={onStartChat}
                            className="px-12 py-5 bg-gray-900 dark:bg-white text-white dark:text-black text-xs font-black uppercase tracking-[0.3em] rounded-2xl transition-all shadow-2xl hover:bg-gray-800 dark:hover:bg-slate-200 active:scale-[0.98]"
                        >
                            Enter Orchestrator
                        </button>
                    </div>

                    <div className="w-full pt-20 space-y-16 md:space-y-24">
                        <div className="space-y-6">
                            <h2 className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-[0.5em]">Core Philosophy</h2>
                            <div className="max-w-3xl mx-auto text-sm md:text-base text-gray-600 dark:text-white/50 leading-relaxed space-y-6">
                                <p>
                                    RamN AI bridges the gap between isolated conversational bots and truly collaborative AI workflows. Rather than relying on a single monolithic intelligence, you orchestrate a <span className="text-gray-900 dark:text-white font-bold">Spectrum</span> of specialized agents.
                                </p>
                                <p>
                                    Each agent possesses explicit directives, unique API tools, and a defined cognitive role. By grouping them into <span className="text-gray-900 dark:text-white font-bold">Squads</span>, they autonomously debate, delegate tasks, and synthesize sophisticated solutions to multi-step problems that basic prompts simply cannot solve.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <h2 className="text-[10px] font-black text-gray-400 dark:text-white/30 uppercase tracking-[0.5em]">Quick Start Guide</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    className="p-6 bg-white dark:bg-white/[0.02] border border-black/10 dark:border-white/5 rounded-3xl flex gap-6 text-left shadow-xl dark:shadow-none"
                                >
                                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 dark:text-indigo-400 flex-shrink-0">
                                        <Key size={20} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-widest">1. Enter the Orchestrator</h3>
                                        <p className="text-xs text-gray-600 dark:text-white/40 leading-relaxed">
                                            Access your workspace and begin interacting with specialized AI units.
                                            RamN AI manages all intelligence infrastructure for you.
                                        </p>
                                    </div>
                                </motion.div>

                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    className="p-6 bg-white dark:bg-white/[0.02] border border-black/10 dark:border-white/5 rounded-3xl flex gap-6 text-left shadow-xl dark:shadow-none"
                                >
                                    <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 dark:text-emerald-400 flex-shrink-0">
                                        <Sparkles size={20} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-widest">2. Consult Prism Core</h3>
                                        <p className="text-xs text-gray-600 dark:text-white/40 leading-relaxed">
                                            Ask <span className="text-white/60 font-bold">Prism</span> for help or to fabricate new agents.
                                            Try: <span className="italic">"Prism, create a Python expert for me."</span>
                                        </p>
                                    </div>
                                </motion.div>

                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    className="p-6 bg-white dark:bg-white/[0.02] border border-black/10 dark:border-white/5 rounded-3xl flex gap-6 text-left shadow-xl dark:shadow-none"
                                >
                                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 dark:text-amber-400 flex-shrink-0">
                                        <MessageSquare size={20} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-widest">3. Direct Interaction</h3>
                                        <p className="text-xs text-gray-600 dark:text-white/40 leading-relaxed">
                                            Select any agent from the sidebar to chat 1-on-1. Each unit has specialized
                                            system instructions and capabilities.
                                        </p>
                                    </div>
                                </motion.div>

                                <motion.div
                                    whileHover={{ scale: 1.02 }}
                                    className="p-6 bg-white dark:bg-white/[0.02] border border-black/10 dark:border-white/5 rounded-3xl flex gap-6 text-left shadow-xl dark:shadow-none"
                                >
                                    <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center text-rose-500 dark:text-rose-400 flex-shrink-0">
                                        <Users size={20} />
                                    </div>
                                    <div className="space-y-2">
                                        <h3 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-widest">4. Assemble Squads</h3>
                                        <p className="text-xs text-gray-600 dark:text-white/40 leading-relaxed">
                                            Create a <span className="text-white/60 font-bold">Team</span> to let multiple agents collaborate.
                                            Mention them using <span className="text-white/60 font-bold">@Name</span> to trigger their expertise.
                                        </p>
                                    </div>
                                </motion.div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-black/10 dark:border-white/5">
                            <div className="space-y-4 text-left">
                                <div className="flex items-center gap-3 text-gray-500 dark:text-white/20">
                                    <Bot size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Specialized Units</span>
                                </div>
                                <p className="text-[11px] text-gray-600 dark:text-white/40 leading-relaxed">
                                    From image generation to deep research, deploy agents with specific tools
                                    and models tailored for the task.
                                </p>
                            </div>
                            <div className="space-y-4 text-left">
                                <div className="flex items-center gap-3 text-gray-500 dark:text-white/20">
                                    <HelpCircle size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Need Help?</span>
                                </div>
                                <p className="text-[11px] text-gray-600 dark:text-white/40 leading-relaxed">
                                    Prism Core is always active. Ask it about capabilities, agent management,
                                    or to explain the system architecture.
                                </p>
                            </div>
                            <div className="space-y-4 text-left">
                                <div className="flex items-center gap-3 text-gray-500 dark:text-white/20">
                                    <Sparkles size={16} />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Spectrum View</span>
                                </div>
                                <p className="text-[11px] text-gray-600 dark:text-white/40 leading-relaxed">
                                    Explore the Spectrum to find pre-configured agent templates or
                                    discover the strengths of different AI models.
                                </p>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
};

