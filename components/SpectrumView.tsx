
import React, { useState, useRef } from 'react';
import { AIModelProfile, AgentTemplate, Agent, Team, UserProfile } from '../types';
import { SPECIAL_AGENT_TEMPLATES } from '../constants';
import { ToolsView } from './ToolsView';
import { ModelsView } from './ModelsView';

interface SpectrumViewProps {
    onHire: (profile: AIModelProfile | AgentTemplate) => void;
    onFabricateAgent: () => void;
    onInitializeGroup: () => void;
    onOpenChat: (id: string) => void;
    agents: Agent[];
    teams: Team[];
    userProfile: UserProfile;
}

export const SpectrumView: React.FC<SpectrumViewProps> = ({ onHire, onFabricateAgent, onInitializeGroup, onOpenChat, agents, teams, userProfile }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);

    const userAgents = agents.filter(a => !a.isSystem);
    const userTeams = teams.filter(t => !t.isSystem);

    const scrollToSection = (index: number) => {
        if (scrollContainerRef.current) {
            const sectionWidth = scrollContainerRef.current.offsetWidth;
            scrollContainerRef.current.scrollTo({
                left: index * sectionWidth,
                behavior: 'smooth'
            });
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-[#F8F9FA] dark:bg-[#1A1A1A] animate-in fade-in duration-500 overflow-hidden">
            <header className="h-24 border-b border-black/5 dark:border-white/5 flex flex-col justify-center pl-16 md:pl-8 pr-8 bg-[#F8F9FA] dark:bg-[#1A1A1A] flex-shrink-0 relative z-20">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40">Spectrum</span>
                </div>
                <div className="flex gap-3">

                    <button
                        onClick={() => scrollToSection(0)}
                        className="px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                    >
                        Your Agents & Groups
                    </button>
                    <button
                        onClick={() => scrollToSection(1)}
                        className="px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                    >
                        Special Agents
                    </button>
                    <button
                        onClick={() => scrollToSection(2)}
                        className="px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                    >
                        Tools
                    </button>
                    <button
                        onClick={() => scrollToSection(3)}
                        className="px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                    >
                        AI Models
                    </button>
                </div>
            </header>

            <div
                ref={scrollContainerRef}
                className="flex-1 flex overflow-x-auto snap-x snap-mandatory custom-scrollbar scroll-smooth"
            >
                {/* SECTION 2: YOUR AGENTS & GROUPS */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <div className="max-w-5xl mx-auto">
                        <div className="mb-8 flex items-center gap-4">
                            <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Your Agents & Groups</h3>
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                            <button
                                onClick={onFabricateAgent}
                                className="flex items-center justify-center gap-6 bg-black/5 dark:bg-white/[0.02] border border-dashed border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 rounded-2xl p-12 group transition-all"
                            >
                                <div className="w-12 h-12 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-400 dark:text-white/40 group-hover:bg-gray-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-all text-2xl font-bold">+</div>
                                <span className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Custom Agent</span>
                            </button>

                            <button
                                onClick={onInitializeGroup}
                                className="flex items-center justify-center gap-6 bg-black/5 dark:bg-white/[0.02] border border-dashed border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 rounded-2xl p-12 group transition-all"
                            >
                                <div className="w-12 h-12 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-400 dark:text-white/40 group-hover:bg-gray-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-all text-2xl font-bold">⬡</div>
                                <span className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Create Group</span>
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {userAgents.map(agent => (
                                <ListItem
                                    key={agent.id}
                                    icon={agent.icon}
                                    name={agent.name}
                                    sub={agent.role}
                                    tagline={agent.jobDescription.slice(0, 100) + '...'}
                                    onClick={() => onOpenChat(agent.id)}
                                    isExpanded={expandedId === agent.id}
                                    onToggleExpand={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                                    details={agent.jobDescription}
                                />
                            ))}
                            {userTeams.map(team => (
                                <ListItem
                                    key={team.id}
                                    icon="⬡"
                                    name={team.name}
                                    sub="Group Command"
                                    tagline={team.description || "No objective defined."}
                                    onClick={() => onOpenChat(team.id)}
                                    isExpanded={expandedId === team.id}
                                    onToggleExpand={() => setExpandedId(expandedId === team.id ? null : team.id)}
                                    details={`${team.agents.length} specialized units enrolled.`}
                                />
                            ))}

                            {/* The condition for displaying "No Active Units Found" has been updated based on the instruction. */}
                            {userAgents.length === 0 && userTeams.length === 0 && (
                                <div className="col-span-1 md:col-span-2 flex flex-col items-center justify-center p-16 bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-3xl shadow-xl shadow-black/5 dark:shadow-none relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent dark:from-indigo-500/10" />
                                    <div className="w-20 h-20 bg-indigo-50 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-400 rounded-3xl flex items-center justify-center mb-6 border border-indigo-100 dark:border-indigo-500/20 shadow-inner z-10">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                                        </svg>
                                    </div>
                                    <h4 className="text-gray-900 dark:text-white font-black text-xl mb-3 z-10 uppercase tracking-tight">No Roster Discovered</h4>
                                    <p className="text-gray-500 dark:text-white/50 text-sm text-center max-w-md mb-8 z-10 leading-relaxed">
                                        Your Spectrum is currently empty. Fabricate a Custom Agent with tailored instructions or assemble a Group Command to start orchestrating workflows.
                                    </p>
                                    <div className="flex gap-4 z-10">
                                        <button onClick={onFabricateAgent} className="px-6 py-3 bg-indigo-600 dark:bg-indigo-500 text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-xl transition-all shadow-lg hover:bg-indigo-700 dark:hover:bg-indigo-400">
                                            Fabricate Custom Agent
                                        </button>
                                        <button onClick={onInitializeGroup} className="px-6 py-3 bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-xl transition-all hover:bg-black/10 dark:hover:bg-white/10">
                                            Create Squad
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* SECTION 2: SPECIAL AGENTS */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <div className="max-w-5xl mx-auto">
                        <div className="mb-8 flex items-center gap-4">
                            <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Special Agents</h3>
                            <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                            <span className="text-[9px] text-gray-400 dark:text-white/20 font-mono tracking-widest">{SPECIAL_AGENT_TEMPLATES.length} BLUEPRINTS</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {SPECIAL_AGENT_TEMPLATES.map(template => (
                                <div key={template.id} className="group bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl p-5 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 flex flex-col shadow-sm dark:shadow-none">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-10 h-10 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl flex items-center justify-center text-xl group-hover:scale-105 transition-transform">
                                            {template.icon}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-[12px] font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">{template.name}</h4>
                                            <p className="text-[9px] text-indigo-600/70 dark:text-indigo-400/50 font-mono uppercase tracking-tighter truncate">{template.role}</p>
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-gray-500 dark:text-white/30 leading-relaxed mb-3 flex-1">{template.description}</p>
                                    <div className="flex flex-wrap gap-1.5 mb-4">
                                        {template.defaultTools.map(tool => (
                                            <span key={tool} className="text-[8px] px-2 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300/60 rounded border border-indigo-500/20 uppercase tracking-wider font-bold">
                                                {tool}
                                            </span>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => {
                                            // Navigate to Prism chat and inject context request
                                            onOpenChat('prism-core');
                                            // Small delay to let navigation happen, then inject
                                            setTimeout(() => {
                                                const event = new CustomEvent('prism-special-agent', {
                                                    detail: { templateId: template.id, templateName: template.name, templateRole: template.role }
                                                });
                                                window.dispatchEvent(event);
                                            }, 300);
                                        }}
                                        className="w-full py-2 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white text-[9px] font-black uppercase tracking-widest rounded-lg border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 transition-all active:scale-[0.98]"
                                    >
                                        + Add via Prism
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* SECTION 3: TOOLS */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <ToolsView />
                </div>

                {/* SECTION 4: MODELS */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <ModelsView />
                </div>
            </div>
        </div>
    );
};

const ListItem: React.FC<{
    icon: string;
    name: string;
    sub: string;
    tagline: string;
    onClick: () => void;
    isExpanded: boolean;
    onToggleExpand: () => void;
    details: string;
}> = ({ icon, name, sub, tagline, onClick, isExpanded, onToggleExpand, details }) => (
    <div className={`group relative bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 rounded-2xl overflow-hidden shadow-sm dark:shadow-none ${isExpanded ? 'ring-1 ring-black/10 dark:ring-white/10' : ''}`}>
        <div className="flex items-center gap-6 p-5">
            <div className="w-14 h-14 bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 rounded-xl flex items-center justify-center text-2xl flex-shrink-0 group-hover:scale-105 transition-transform grayscale opacity-60 group-hover:opacity-100 group-hover:grayscale-0">
                {icon}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-4">
                    <h4 className="font-black text-gray-900 dark:text-white text-base uppercase tracking-tight truncate">{name}</h4>
                    <span className="text-[10px] text-gray-400 dark:text-white/20 uppercase tracking-widest font-mono hidden sm:inline font-bold">{sub}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-white/40 italic truncate mt-1">"{tagline}"</p>
            </div>

            <div className="flex items-center gap-4 flex-shrink-0">
                <button
                    onClick={onToggleExpand}
                    className={`p-3 rounded-xl transition-all border ${isExpanded ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-gray-900 dark:border-white' : 'bg-black/5 dark:bg-white/5 text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20'}`}
                    title="View Details"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                </button>
                <button
                    onClick={onClick}
                    className="px-8 py-3 bg-gray-900 dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-gray-800 dark:hover:bg-slate-100 transition-all active:scale-95 shadow-lg"
                >
                    Deploy
                </button>
            </div>
        </div>

        {isExpanded && (
            <div className="px-5 pb-8 pt-2 animate-in slide-in-from-top-2 duration-300">
                <div className="bg-gray-50 dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-xl p-6 shadow-inner dark:shadow-none">
                    <div className="flex items-center gap-3 mb-6 opacity-40 dark:opacity-40">
                        <div className="h-px flex-1 bg-black/20 dark:bg-white/20" />
                        <span className="text-[9px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-[0.4em]">Protocol_Context</span>
                        <div className="h-px flex-1 bg-black/20 dark:bg-white/20" />
                    </div>
                    <div className="text-[12px] text-gray-700 dark:text-white/70 leading-relaxed font-mono whitespace-pre-wrap">
                        {details}
                    </div>
                    <div className="mt-8 flex justify-end">
                        <button
                            onClick={onClick}
                            className="px-10 py-3 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
                        >
                            Confirm Deployment
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
);
