
import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Confirm Delete" }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" aria-modal="true" role="dialog">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white shadow-xl dark:border-white/10 dark:bg-[#15171a]">
        <div className="p-6">
          <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-white/60">{message}</p>
        </div>
        <div className="flex items-center justify-end space-x-2 rounded-b-2xl border-t border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <button onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 font-bold text-gray-900 transition hover:bg-gray-200 dark:bg-white/5 dark:text-white dark:hover:bg-white/10">
            Cancel
          </button>
          <button 
            onClick={onConfirm} 
            className="rounded-lg bg-red-600 px-4 py-2 font-bold text-white transition hover:bg-red-500"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
