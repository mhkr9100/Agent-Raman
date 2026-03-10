
import React, { useState, useEffect } from 'react';
import { Agent, Team, UserProfile } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { AI_RESUMES } from '../constants';

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

export const ProfileSidebar: React.FC<ProfileSidebarProps> = ({
    isOpen, type, data, onClose, onSaveAgent, onSaveTeam, onUpdateUserProfile, userProfile
}) => {
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [jd, setJd] = useState('');
    const [knowledgeBase, setKnowledgeBase] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);

    const [teamName, setTeamName] = useState('');
    const [teamDesc, setTeamDesc] = useState('');

    useEffect(() => {
        if (type === 'team') {
            const team = data as Team;
            setTeamName(team.name);
            setTeamDesc(team.description || '');
        } else {
            const agent = data as Agent;
            setName(agent.name);
            setRole(agent.role);
            setJd(agent.jobDescription);
            setKnowledgeBase(agent.knowledgeBase || []);
        }
    }, [data.id, type, data]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        try {
            const { s3Service } = await import('../services/s3Service');
            const { url } = await s3Service.uploadKnowledgeDocument(file, data.id);

            setKnowledgeBase(prev => [...prev, {
                id: `kb-${Date.now()}`,
                name: file.name,
                url,
                type: file.type,
                size: file.size,
                uploadedAt: Date.now()
            }]);
        } catch (error) {
            console.error(error);
            alert("Failed to upload document to AWS S3.");
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleSave = () => {
        if (type === 'team') onSaveTeam?.({ ...data as Team, name: teamName, description: teamDesc });
        else if (type === 'prism') {
            // Prism profile is now just informational, keys moved to User Profile
        }
        else onSaveAgent?.({ ...data as Agent, name, role, jobDescription: jd, knowledgeBase });
        onClose();
    };
    const agent = data as Agent;
    const brainProfile = AI_RESUMES.find(p => p.modelId === agent.model) || AI_RESUMES[0];

    return (
        <div className={`fixed top-0 right-0 h-full w-full max-w-sm md:max-w-md bg-[#1A1A1A] border-l border-white/5 shadow-2xl z-[50] transition-transform duration-300 transform ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex flex-col h-full">
                <div className="p-6 border-b border-white/5 bg-[#1A1A1A]">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-white tracking-tight">{type === 'prism' ? 'Prism Profile' : type === 'team' ? 'Squad Profile' : 'Unit Profile'}</h2>
                        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-slate-400 transition-colors"><XMarkIcon /></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                    <div className="animate-in fade-in duration-500">
                        <div className="space-y-6 mt-8">
                            {type === 'team' ? (
                                <>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Squad Name</label><input value={teamName} onChange={e => setTeamName(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm text-white focus:border-white outline-none transition-colors" /></div>
                                    <div><label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Directive</label><textarea value={teamDesc} onChange={e => setTeamDesc(e.target.value)} rows={3} className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm text-white resize-none focus:border-white outline-none transition-colors" /></div>
                                </>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Agent Name</label>
                                        <input value={name} onChange={e => setName(e.target.value)} disabled={type === 'prism'} className="w-full bg-black border border-white/10 rounded-xl p-3 text-sm text-white focus:border-white outline-none transition-colors disabled:opacity-50" />
                                    </div>

                                    {type !== 'prism' && (
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">AI Model</label>
                                            <div className="w-full bg-black border border-white/10 rounded-xl p-3 text-[11px] font-mono text-white/60">
                                                {brainProfile?.name || agent.model}
                                            </div>
                                        </div>
                                    )}

                                    {type !== 'prism' && (
                                        <>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-2">System Instructions</label>
                                                <textarea value={jd} onChange={e => setJd(e.target.value)} rows={8} className="w-full bg-black border border-white/10 rounded-xl p-3 text-[11px] font-mono leading-relaxed text-slate-300 resize-none focus:border-white outline-none transition-colors mb-6" />
                                            </div>

                                            <div>
                                                <div className="flex items-center justify-between mb-3">
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">Memory Data (Knowledge Base)</label>
                                                    <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded uppercase tracking-wider font-bold">AWS S3</span>
                                                </div>

                                                <div className="space-y-2 mb-6">
                                                    {knowledgeBase.map(doc => (
                                                        <div key={doc.id} className="flex items-center justify-between bg-white/[0.02] border border-white/10 rounded-lg p-3">
                                                            <div className="flex flex-1 items-center gap-3 overflow-hidden">
                                                                <span className="text-lg">📄</span>
                                                                <div className="truncate pr-4">
                                                                    <div className="text-[11px] font-bold text-slate-300 truncate">{doc.name}</div>
                                                                    <div className="text-[9px] text-slate-500 uppercase tracking-widest">{(doc.size / 1024).toFixed(1)} KB</div>
                                                                </div>
                                                            </div>
                                                            <button onClick={() => setKnowledgeBase(prev => prev.filter(k => k.id !== doc.id))} className="text-red-500/50 hover:text-red-400 p-1 flex-shrink-0 relative z-10 transition-colors">
                                                                <XMarkIcon />
                                                            </button>
                                                        </div>
                                                    ))}

                                                    <label className={`flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${isUploading ? 'bg-white/5 border-white/20' : 'bg-black border-white/10 hover:bg-white/5 hover:border-white/30'}`}>
                                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                                            {isUploading ? (
                                                                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                            ) : (
                                                                <>
                                                                    <svg className="w-6 h-6 mb-2 text-white/40" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" /></svg>
                                                                    <p className="mb-1 text-[10px] text-white/60 font-bold"><span className="text-white">Click to upload</span></p>
                                                                    <p className="text-[8px] uppercase tracking-widest text-white/40">PDF, TXT, DOCX</p>
                                                                </>
                                                            )}
                                                        </div>
                                                        <input type="file" className="hidden" onChange={handleFileUpload} disabled={isUploading} accept=".pdf,.txt,.doc,.docx,.csv,.md" />
                                                    </label>
                                                </div>
                                            </div>

                                            {(agent.capabilities || []).length > 0 && (
                                                <div>
                                                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-[0.2em]">Tools</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {agent.capabilities!.map(cap => (
                                                            <span key={cap} className="px-2.5 py-1 bg-white/[0.05] border border-white/10 rounded-lg text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                                                {cap.replace('google', '').replace('Generation', '')}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </>
                            )}

                            <button onClick={handleSave} className="w-full py-4 bg-white text-black text-[11px] font-black uppercase tracking-[0.3em] rounded-xl transition-all shadow-xl active:scale-[0.98]">
                                Update {type === 'prism' ? 'Protocol' : 'Profile'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
