
import React, { useState } from 'react';
import { UserProfile } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { authService } from '../services/auth';
import { useTheme } from '../hooks/useTheme';

interface UserProfileModalProps {
    user: UserProfile;
    isOpen: boolean;
    onClose: () => void;
    onSave: (user: UserProfile) => void;
    onLogout?: () => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({ user, isOpen, onClose, onSave, onLogout }) => {
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar || '');
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { theme, toggleTheme } = useTheme();

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ ...user, name, avatar });
        onClose();
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            await authService.deleteAccount(user.email);
            window.location.reload(); // Force reload to clear state and show login
        } catch (error) {
            console.error("Failed to delete account", error);
            setIsDeleting(false);
            setIsConfirmingDelete(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
            <div className="bg-[#1A1A1A] w-full max-w-md rounded-2xl shadow-2xl border border-white/10 overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10 flex-shrink-0">
                    <h2 className="text-sm font-black text-white uppercase tracking-widest">Profile</h2>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition text-white/40 hover:text-white">
                        <XMarkIcon />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
                    {!isConfirmingDelete ? (
                        <form onSubmit={handleSubmit} className="space-y-8">
                            {/* Avatar */}
                            <div className="flex flex-col items-center space-y-3">
                                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center text-3xl relative overflow-hidden ring-1 ring-white/10">
                                    {avatar ? (
                                        <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-white/20">👤</span>
                                    )}
                                </div>
                            </div>

                            {/* Identity Fields */}
                            <div className="space-y-6">
                                <div>
                                    <label className="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Account ID</label>
                                    <div className="bg-black/20 border border-white/5 rounded-xl px-4 py-3">
                                        <p className="text-[10px] text-white/50 font-mono truncate">{user.id}</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Email</label>
                                    <div className="bg-black/20 border border-white/5 rounded-xl px-4 py-3">
                                        <p className="text-[10px] text-white/50 font-mono">{user.email}</p>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black text-white/30 uppercase tracking-widest mb-2">Display Name</label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        className="w-full bg-[#222] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-white outline-none transition-all"
                                        required
                                    />
                                </div>
                            </div>

                            {/* Theme Toggle */}
                            <div className="flex items-center justify-between p-4 bg-black/20 border border-white/5 rounded-xl">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">App Theme</span>
                                    <span className="text-[10px] text-white/30">{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleTheme}
                                    className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                                    style={{ backgroundColor: theme === 'dark' ? '#3B82F6' : '#E5E7EB' }}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            </div>

                            {/* Actions */}
                            <div className="flex flex-col gap-3 pt-4">
                                <button
                                    type="submit"
                                    className="w-full py-4 bg-white text-black text-[11px] font-black uppercase tracking-widest rounded-xl transition-all active:scale-[0.98]"
                                >
                                    Save Profile
                                </button>
                                {onLogout && (
                                    <button
                                        type="button"
                                        onClick={onLogout}
                                        className="w-full py-3 text-white/40 hover:text-white text-[9px] font-black uppercase tracking-widest transition-all"
                                    >
                                        Sign Out
                                    </button>
                                )}
                                <div className="pt-6 border-t border-white/5 mt-4">
                                    <button
                                        type="button"
                                        onClick={() => setIsConfirmingDelete(true)}
                                        className="w-full py-3 text-red-500/30 hover:text-red-500 text-[8px] font-bold uppercase tracking-[0.2em] transition-all hover:bg-red-500/5 rounded-xl"
                                    >
                                        Delete My Account
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-8 text-center py-6">
                            <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center text-2xl mx-auto mb-4 animate-pulse">
                                ⚠️
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-lg font-bold text-white tracking-tight leading-7">Delete Account?</h3>
                                <p className="text-white/40 text-[11px] leading-relaxed px-4">
                                    This will permanently remove your profile from our systems. You will lose access to all your agents, teams, and data. This action is irreversible.
                                </p>
                            </div>
                            <div className="flex flex-col gap-3 px-4 pt-4">
                                <button
                                    onClick={handleDeleteAccount}
                                    disabled={isDeleting}
                                    className="w-full py-4 bg-red-500 text-white text-[11px] font-black uppercase tracking-widest rounded-xl hover:bg-red-600 transition-all active:scale-[0.98] disabled:opacity-50"
                                >
                                    {isDeleting ? 'Erasing...' : 'Confirm Permanent Deletion'}
                                </button>
                                <button
                                    onClick={() => setIsConfirmingDelete(false)}
                                    disabled={isDeleting}
                                    className="w-full py-3 text-white/40 hover:text-white text-[9px] font-black uppercase tracking-widest transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

