import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PrismIcon } from './icons/PrismIcon';
import { RamanIcon } from './icons/RamanIcon';
import { SpectrumIcon } from './icons/SpectrumIcon';
import { ChatIcon } from './icons/ChatIcon';
import { UserMapIcon } from './icons/UserMapIcon';
import { ArrowRight, ArrowLeft } from 'lucide-react';

interface WelcomeGuideModalProps {
    onComplete: () => void;
}

export const WelcomeGuideModal: React.FC<WelcomeGuideModalProps> = ({ onComplete }) => {
    const [step, setStep] = useState(0);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const hasSeen = localStorage.getItem('ramn_seen_welcome_guide');
        if (!hasSeen) {
            setIsVisible(true);
        }
    }, []);

    const handleComplete = () => {
        localStorage.setItem('ramn_seen_welcome_guide', 'true');
        setIsVisible(false);
        onComplete();
    };

    if (!isVisible) return null;

    const steps = [
        {
            title: "RamN AI",
            subtitle: "AI Agents Made Simple",
            description: "Stop managing AI. Let AI manage your work. RamN isn't just a chatbot—it's a workspace where you fabricate, deploy, and orchestrate specialized AI agents to solve complex problems.",
            icon: <RamanIcon size={64} className="text-gray-900 dark:text-white" />
        },
        {
            title: "1. Prism Core",
            subtitle: "Your Meta-Agent",
            description: "Prism is the central architect of your workspace. Use Prism to answer questions, map out projects, and—most importantly—fabricate new specialized Custom Agents tailored exactly to your needs.",
            icon: <PrismIcon size={64} className="text-gray-900 dark:text-white" />
        },
        {
            title: "2. The Spectrum",
            subtitle: "Agent & Tool Management",
            description: "The Spectrum is where all your fabricated agents and pre-built blueprints live. You can organize them into Teams, swap out their underlying neural models (Gemini, Claude, GPT-4o), and equip them with specific tools like Web Search or AWS S3 files.",
            icon: <SpectrumIcon size={64} className="text-gray-900 dark:text-white" />
        },
        {
            title: "3. UserMap",
            subtitle: "Your Context Brain",
            description: "As you interact with agents, the UserMap silently extracts key facts and preferences about you. This persists across sessions, giving your AI agents long-term memory about your projects, coding style, or business goals.",
            icon: <UserMapIcon className="w-16 h-16 text-gray-900 dark:text-white" />
        }
    ];

    const currentStep = steps[step];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md px-4">
            <motion.div
                key={step}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-lg bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
                <div className="p-10 flex flex-col items-center text-center space-y-6">
                    <div className="mb-2">
                        {currentStep.icon}
                    </div>

                    <div className="space-y-2">
                        <h2 className="text-2xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
                            {currentStep.title}
                        </h2>
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400">
                            {currentStep.subtitle}
                        </h3>
                    </div>

                    <p className="text-sm text-gray-600 dark:text-white/60 leading-relaxed max-w-sm">
                        {currentStep.description}
                    </p>
                </div>

                <div className="p-6 bg-gray-50 dark:bg-white/5 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                    <div className="flex gap-1.5">
                        {steps.map((_, i) => (
                            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-indigo-500' : 'w-1.5 bg-gray-300 dark:bg-white/20'}`} />
                        ))}
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleComplete}
                            className="px-3 h-10 rounded-xl border border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-[0.1em] text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors"
                        >
                            Skip
                        </button>
                        {step > 0 && (
                            <button
                                onClick={() => setStep(s => s - 1)}
                                className="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-black border border-black/10 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 text-gray-900 dark:text-white transition-colors"
                            >
                                <ArrowLeft size={16} />
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (step === steps.length - 1) {
                                    handleComplete();
                                } else {
                                    setStep(s => s + 1);
                                }
                            }}
                            className="px-6 h-10 flex items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-[0.1em] transition-transform active:scale-95"
                        >
                            {step === steps.length - 1 ? 'Enter Workspace' : 'Next'}
                            {step < steps.length - 1 && <ArrowRight size={14} />}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};
