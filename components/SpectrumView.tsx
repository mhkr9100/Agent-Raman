
import React, { useState, useRef, useEffect } from 'react';
import { AIModelProfile, AgentTemplate, Agent, Team, UserProfile } from '../types';
import { listSpecialAgents, SpecialAgentTemplate } from '../services/apiV2';
import { ToolsView } from './ToolsView';
import { ModelsView } from './ModelsView';

interface SpectrumViewProps {
    onHire: (profile: AIModelProfile | AgentTemplate) => void;
    onAddViaPrism: (template: any) => void;
    onFabricateAgent: () => void;
    onInitializeGroup: () => void;
    onOpenChat: (id: string) => void;
    agents: Agent[];
    teams: Team[];
    userProfile: UserProfile;
}

export const SpectrumView: React.FC<SpectrumViewProps> = ({ onHire, onAddViaPrism, onFabricateAgent, onInitializeGroup, onOpenChat, agents, teams, userProfile }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [specialAgents, setSpecialAgents] = useState<SpecialAgentTemplate[]>([]);
    const [isLoadingAgents, setIsLoadingAgents] = useState(true);

    useEffect(() => {
        (async () => {
            setIsLoadingAgents(true);
            try {
                const res = await listSpecialAgents();
                if (res.templates && res.templates.length > 0) {
                    const normalized = res.templates.map((template: any) => ({
                        ...template,
                        id: template.id || template.templateId,
                        defaultTools: template.defaultTools || []
                    }));
                    setSpecialAgents(normalized);
                } else {
                    setSpecialAgents([]);
                }
            } catch (err) {
                console.warn('[SpectrumView] Failed to load special agents from API:', err);
                setSpecialAgents([]);
            } finally {
                setIsLoadingAgents(false);
            }
        })();
    }, []);

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
                        ChatBots
                    </button>
                    <button
                        onClick={() => scrollToSection(1)}
                        className="px-5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all border border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white"
                    >
                        Capabilities
                    </button>
                    <button
                        onClick={() => scrollToSection(2)}
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
                {/* SECTION 1: CHATBOTS (User + Special) */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <div className="max-w-5xl mx-auto">
                        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">ChatBots Interface</h3>
                                <div className="h-px w-12 bg-black/10 dark:bg-white/5 hidden md:block" />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max items-start">
                            <button
                                onClick={onFabricateAgent}
                                className="h-[104px] flex flex-col items-center justify-center gap-2 bg-white/50 dark:bg-white/[0.02] border border-dashed border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 rounded-2xl p-4 group transition-all"
                            >
                                <div className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center text-gray-400 dark:text-white/40 group-hover:bg-gray-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-black transition-all text-xl font-bold">+</div>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/40 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">Custom ChatBot</span>
                            </button>

                            {userAgents.map(agent => (
                                <ListItem
                                    key={agent.id}
                                    icon={agent.icon}
                                    name={agent.name}
                                    sub={agent.role}
                                    tagline={agent.jobDescription ? `${agent.jobDescription.slice(0, 80)}...` : 'Custom specialist chatbot.'}
                                    onClick={() => onOpenChat(agent.id)}
                                    isExpanded={expandedId === agent.id}
                                    onToggleExpand={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
                                    viewType="grid"
                                />
                            ))}

                            {isLoadingAgents && (
                                <div className="col-span-full p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                                    Loading Special ChatBots...
                                </div>
                            )}

                            {!isLoadingAgents && specialAgents.length === 0 && (
                                <div className="col-span-full p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                                    No Special ChatBots Found
                                </div>
                            )}

                            {specialAgents.map(template => (
                                <ListItem
                                    key={template.id}
                                    icon={template.icon}
                                    name={template.name}
                                    sub={template.role || 'Special ChatBot'}
                                    tagline={template.description}
                                    onClick={() => onAddViaPrism(template)}
                                    isExpanded={expandedId === template.id}
                                    onToggleExpand={() => setExpandedId(expandedId === template.id ? null : template.id)}
                                    viewType="grid"
                                    actionLabel="Add via Prism"
                                    tools={template.defaultTools}
                                />
                            ))}
                        </div>

                        <div className="mt-10 mb-4 flex items-center justify-between">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500 dark:text-white/40">Teams Interface</h4>
                            <button
                                onClick={onInitializeGroup}
                                className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-[9px] font-black uppercase tracking-[0.15em] text-gray-600 dark:text-white/60 hover:text-gray-900 dark:hover:text-white hover:border-black/20 dark:hover:border-white/20 transition-all"
                            >
                                Create Team
                            </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-max items-start">
                            {userTeams.map(team => (
                                <ListItem
                                    key={team.id}
                                    icon="⬡"
                                    name={team.name}
                                    sub="Team Command"
                                    tagline={team.description || "No objective defined."}
                                    onClick={() => onOpenChat(team.id)}
                                    isExpanded={expandedId === team.id}
                                    onToggleExpand={() => setExpandedId(expandedId === team.id ? null : team.id)}
                                    viewType="grid"
                                    teamSize={team.agents.length}
                                />
                            ))}
                            {userTeams.length === 0 && (
                                <div className="col-span-full p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                                    No Teams Yet
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* SECTION 2: CAPABILITIES */}
                <div className="min-w-full snap-start p-8 overflow-y-auto custom-scrollbar">
                    <ToolsView />
                </div>

                {/* SECTION 3: MODELS */}
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
    viewType?: 'grid';
    actionLabel?: string;
    teamSize?: number;
    tools?: string[];
}> = ({ icon, name, sub, tagline, onClick, isExpanded, onToggleExpand, actionLabel = 'Deploy', teamSize, tools }) => {
    return (
        <div className={`group relative bg-white dark:bg-black/20 border transition-all duration-300 rounded-2xl overflow-hidden shadow-sm dark:shadow-none flex flex-col justify-between ${isExpanded ? 'border-gray-900 dark:border-white/40 ring-1 ring-gray-900/5 dark:ring-white/10' : 'border-black/5 dark:border-white/5 hover:border-black/20 dark:hover:border-white/20'}`}>
            <div className="p-4 flex flex-col h-full">
                {/* Header Row */}
                <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 group-hover:scale-105 transition-transform">
                            {icon}
                        </div>
                        <div className="min-w-0">
                            <h4 className="font-black text-gray-900 dark:text-white text-xs uppercase tracking-tight truncate">{name}</h4>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-500 dark:text-white/40 uppercase tracking-widest font-mono font-bold truncate">{sub}</span>
                                {teamSize !== undefined && (
                                    <span className="text-[8px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 rounded font-mono font-bold text-gray-600 dark:text-white/60">
                                        {teamSize} Units
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Expand Details Button */}
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                        className={`p-1.5 rounded-lg transition-all shrink-0 border ${isExpanded ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-transparent' : 'bg-transparent text-gray-400 hover:text-gray-900 dark:hover:text-white border-transparent hover:bg-black/5 dark:hover:bg-white/10'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                    </button>
                </div>

                {/* Expansion Details */}
                <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-40 opacity-100 mb-3' : 'max-h-0 opacity-0 mb-0'}`}>
                    <div className="text-[10px] text-gray-600 dark:text-white/60 leading-relaxed font-mono">
                        {tagline}
                    </div>
                    {tools && tools.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                            {tools.map(tool => (
                                <span key={tool} className="text-[8px] px-1.5 py-0.5 bg-black/5 dark:bg-white/10 text-gray-700 dark:text-white/70 rounded uppercase tracking-wider font-bold">
                                    {tool}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Static Tagline (when not expanded) */}
                {!isExpanded && (
                    <p className="text-[10px] text-gray-500 dark:text-white/40 line-clamp-2 leading-relaxed mb-4 flex-1">
                        {tagline}
                    </p>
                )}

                {/* Primary Action */}
                <button
                    onClick={(e) => { e.stopPropagation(); onClick(); }}
                    className={`w-full py-2 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all active:scale-[0.98] ${actionLabel === 'Add via Prism'
                        ? 'bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-gray-700 dark:text-white/70'
                        : 'bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-gray-800 dark:hover:bg-gray-200 shadow-sm'
                        }`}
                >
                    {actionLabel === 'Add via Prism' && <span className="text-sm">✦</span>}
                    {actionLabel}
                </button>
            </div>
        </div>
    );
};
