import React, { useState } from 'react';
import { UserProfile } from '../types';

interface FeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    userProfile: UserProfile;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, userProfile }) => {
    const [feedback, setFeedback] = useState('');
    const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

    if (!isOpen) return null;

    const handleFeedbackSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!feedback.trim()) return;
        setIsSubmittingFeedback(true);
        try {
            const { dbService, STORES_ENUM } = await import('../services/db');
            await dbService.put(STORES_ENUM.FEEDBACK, {
                id: Date.now().toString(),
                userId: userProfile.id,
                text: feedback,
                createdAt: Date.now()
            });
            setFeedback('');
            onClose();
        } catch (error) {
            console.error("Failed to submit feedback", error);
        } finally {
            setIsSubmittingFeedback(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="absolute inset-0"
                onClick={() => !isSubmittingFeedback && onClose()}
            />
            <div className="relative w-full max-w-md bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-6 animate-in slide-in-from-bottom-8 duration-300 text-gray-900 dark:text-white">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-display font-extrabold text-[#1A1A1A] dark:text-white tracking-tight">Got Feedback?</h2>
                    <button
                        onClick={() => !isSubmittingFeedback && onClose()}
                        className="p-2 text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors rounded-full hover:bg-black/5 dark:hover:bg-white/5"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <form onSubmit={handleFeedbackSubmit} className="flex flex-col gap-4">
                    <textarea
                        placeholder="Tell us what's on your mind. Bugs, features, or just weird vibes..."
                        value={feedback}
                        onChange={e => setFeedback(e.target.value)}
                        disabled={isSubmittingFeedback}
                        rows={4}
                        className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 focus:border-black/40 dark:focus:border-white/40 rounded-xl p-4 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/30 resize-none outline-none transition-all disabled:opacity-50"
                    />
                    <button
                        type="submit"
                        disabled={!feedback.trim() || isSubmittingFeedback}
                        className="w-full py-4 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 dark:hover:bg-slate-200 transition-all active:scale-95 shadow-xl disabled:opacity-50 disabled:hover:scale-100 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isSubmittingFeedback ? (
                            <>
                                <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                                <span>Submitting...</span>
                            </>
                        ) : (
                            'Send to Dev Team'
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};
