import React from 'react';

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    itemName: string;
    itemType: 'ChatBot' | 'Team';
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
    isOpen,
    itemName,
    itemType,
    onConfirm,
    onCancel
}) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                className="absolute inset-0"
                onClick={onCancel}
            />
            <div className="relative w-full max-w-sm bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-6 animate-in slide-in-from-bottom-4 duration-300 text-gray-900 dark:text-white">
                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 bg-red-50 dark:bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-display font-extrabold text-gray-900 dark:text-white tracking-tight mb-2">Delete {itemType}?</h2>
                    <p className="text-sm text-gray-500 dark:text-white/60 mb-6 leading-relaxed">
                        Are you sure you want to permanently terminate <strong>{itemName}</strong>? This action cannot be reversed, and all associated memory will be purged.
                    </p>
                    <div className="flex justify-center w-full gap-3">
                        <button
                            onClick={onCancel}
                            className="flex-1 py-3 px-4 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-900 dark:text-white text-xs font-bold rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-xl shadow-lg shadow-red-500/20 transition-all hover:-translate-y-0.5"
                        >
                            Yes, Delete
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
