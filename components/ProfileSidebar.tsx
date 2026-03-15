import React, { useEffect, useMemo, useState } from 'react';
import { Agent, Team, UserProfile } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';

interface ProfileSidebarProps {
    isOpen: boolean;
    type: 'agent' | 'team' | 'prism';
    data: Agent | Team;
    globalTasks?: any[];
    onClose: () => void;
    onSaveAgent?: (agent: Agent) => void;
    onSaveTeam?: (team: Team) => void;
    onUpdateUserProfile?: (p: Partial<UserProfile>) => void;
    userProfile?: UserProfile;
}

function formatCapabilityLabel(capability: string) {
    return capability
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const ProfileSidebar: React.FC<ProfileSidebarProps> = ({
    isOpen,
    type,
    data,
    onClose,
    onSaveAgent,
    onSaveTeam
}) => {
    const [name, setName] = useState('');
    const [instructions, setInstructions] = useState('');
    const [teamName, setTeamName] = useState('');
    const [teamDesc, setTeamDesc] = useState('');
    useEffect(() => {
        if (type === 'team') {
            const team = data as Team;
            setTeamName(team.name);
            setTeamDesc(team.description || '');
            return;
        }

        const agent = data as Agent;
        setName(agent.name);
        setInstructions(agent.jobDescription || '');
    }, [data, type]);

    const agent = data as Agent;
    const capabilityList = useMemo(
        () => Array.isArray(agent.capabilities) ? agent.capabilities : [],
        [agent.capabilities]
    );

    const handleSave = () => {
        if (type === 'team') {
            onSaveTeam?.({ ...(data as Team), name: teamName, description: teamDesc });
        } else if (type === 'agent') {
            const existing = data as Agent;
            onSaveAgent?.({ ...existing, name, role: existing.role, jobDescription: instructions });
        }
        onClose();
    };

    const title = type === 'prism'
        ? 'Prism Profile'
        : type === 'team'
            ? 'Group Profile'
            : 'Profile';

    return (
        <div className={`fixed top-0 right-0 z-[50] h-full w-full max-w-sm transform border-l border-black/10 bg-white shadow-2xl transition-transform duration-300 dark:border-white/10 dark:bg-[#15171a] md:max-w-md ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex h-full flex-col">
                <div className="border-b border-black/10 bg-white/90 p-6 backdrop-blur-xl dark:border-white/10 dark:bg-[#15171a]/90">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">{title}</h2>
                        <button onClick={onClose} className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-black/[0.04] hover:text-gray-900 dark:text-white/40 dark:hover:bg-white/[0.05] dark:hover:text-white">
                            <XMarkIcon />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    <div className="space-y-6">
                        {type === 'team' ? (
                            <>
                                <div>
                                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">Group Name</label>
                                    <input
                                        value={teamName}
                                        onChange={e => setTeamName(e.target.value)}
                                        className="w-full rounded-2xl border border-black/10 bg-[#F8F9FA] p-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-900 dark:border-white/10 dark:bg-[#101214] dark:text-white dark:focus:border-white"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">Directive</label>
                                    <textarea
                                        value={teamDesc}
                                        onChange={e => setTeamDesc(e.target.value)}
                                        rows={4}
                                        className="w-full resize-none rounded-2xl border border-black/10 bg-[#F8F9FA] p-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-900 dark:border-white/10 dark:bg-[#101214] dark:text-white dark:focus:border-white"
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">
                                        {type === 'prism' ? 'Name' : 'ChatBot Name'}
                                    </label>
                                    <input
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        disabled={type === 'prism'}
                                        className="w-full rounded-2xl border border-black/10 bg-[#F8F9FA] p-3 text-sm text-gray-900 outline-none transition-colors focus:border-gray-900 disabled:opacity-60 dark:border-white/10 dark:bg-[#101214] dark:text-white dark:focus:border-white"
                                    />
                                </div>

                                {type !== 'prism' && (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <div className="rounded-2xl border border-black/10 bg-[#F8F9FA] p-4 dark:border-white/10 dark:bg-[#101214]">
                                            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500 dark:text-white/40">Runtime Model</div>
                                            <div className="text-[12px] font-mono text-gray-800 dark:text-white/70">{agent.model || 'Unknown model'}</div>
                                        </div>
                                        <div className="rounded-2xl border border-black/10 bg-[#F8F9FA] p-4 dark:border-white/10 dark:bg-[#101214]">
                                            <div className="mb-1 text-[9px] font-black uppercase tracking-[0.18em] text-gray-500 dark:text-white/40">Capabilities</div>
                                            <div className="text-[12px] text-gray-800 dark:text-white/70">{capabilityList.length}</div>
                                        </div>
                                    </div>
                                )}

                                {type !== 'prism' && (
                                    <div>
                                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">System Instructions</label>
                                        <textarea
                                            value={instructions}
                                            onChange={e => setInstructions(e.target.value)}
                                            rows={8}
                                            className="w-full resize-none rounded-2xl border border-black/10 bg-[#F8F9FA] p-4 text-[11px] leading-relaxed text-gray-900 outline-none transition-colors focus:border-gray-900 dark:border-white/10 dark:bg-[#101214] dark:text-white/80 dark:focus:border-white"
                                        />
                                    </div>
                                )}

                                {type !== 'prism' && capabilityList.length > 0 && (
                                    <div>
                                        <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">ChatBot Capabilities</label>
                                        <div className="flex flex-wrap gap-2">
                                            {capabilityList.map(capability => (
                                                <span
                                                    key={capability}
                                                    className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700 dark:text-emerald-300"
                                                >
                                                    {formatCapabilityLabel(String(capability))}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                            </>
                        )}

                        <button
                            onClick={handleSave}
                            className="w-full rounded-2xl bg-gray-900 py-4 text-[11px] font-black uppercase tracking-[0.22em] text-white transition hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90"
                        >
                            Update Profile
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
