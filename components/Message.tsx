
import React, { useState } from 'react';
import { Message as MessageType, ToolCall, CustomGroupSuggestion } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { AI_RESUMES } from '../constants';

interface MessageProps {
    message: MessageType;
    onAddEmployee?: (employeeData: any) => void;
    onCreateGroup?: (groupData: { name: string, agentIds: string[] }) => void;
    onConfigureNewAgent?: (profileId?: string, role?: string, jd?: string) => void;
    onDeployCustomGroup?: (suggestion: CustomGroupSuggestion) => void;
    onExecuteCommand?: (messageId: string, toolCall: ToolCall) => void;
}

const CommandProposal: React.FC<{
    toolCall: ToolCall,
    isExecuting?: boolean,
    onProceed: (modifiedArgs?: any) => void
}> = ({ toolCall, isExecuting, onProceed }) => {
    const [selectedModels, setSelectedModels] = useState<Record<number, string>>({});

    const isSquad = toolCall.name === 'fabricateTeam';
    const isSingleAgent = toolCall.name === 'fabricateAgent';
    const specialists = isSquad ? (toolCall.args.specialists || []) : (isSingleAgent ? [toolCall.args] : []);

    const handleDeploy = () => {
        const modifiedArgs = { ...toolCall.args };
        const validModelIds = AI_RESUMES.map(m => m.modelId);

        const getValidModel = (id: string, fallbackId?: string) => {
            if (id && validModelIds.includes(id)) return id;
            if (fallbackId && validModelIds.includes(fallbackId)) return fallbackId;
            return AI_RESUMES[0].modelId;
        };

        if (isSquad) {
            modifiedArgs.specialists = modifiedArgs.specialists.map((s: any, i: number) => ({
                ...s,
                modelId: getValidModel(selectedModels[i], s.modelId)
            }));
        } else if (isSingleAgent) {
            modifiedArgs.modelId = getValidModel(selectedModels[0], modifiedArgs.modelId);
        }
        onProceed(modifiedArgs);
    };

    // For non-agent tool calls (search, image gen, etc.)
    if (!isSquad && !isSingleAgent) {
        const toolNameMap: Record<string, string> = {
            executeSearch: 'Intelligence Probe',
            generateVisualAsset: 'Visual Synthesis',
        };
        return (
            <div className="mt-4 bg-white dark:bg-[#0a0a0a] border border-indigo-500/10 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-400">
                <div className="bg-indigo-500/5 border-b border-white/5 p-3 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/80 animate-pulse" />
                    <span className="text-[9px] font-black text-indigo-200 uppercase tracking-[0.2em]">
                        {toolNameMap[toolCall.name] || toolCall.name}
                    </span>
                </div>
                <div className="p-4">
                    {isExecuting ? (
                        <div className="py-2 space-y-2 text-center">
                            <LoadingSpinner width={20} height={10} className="text-indigo-400" />
                            <p className="text-[8px] text-indigo-400/40 font-mono tracking-[0.4em] uppercase font-black">Executing...</p>
                        </div>
                    ) : (
                        <button onClick={() => onProceed()} className="w-full py-2.5 bg-white hover:bg-slate-100 text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98]">
                            Execute →
                        </button>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="mt-4 bg-white dark:bg-[#0a0a0a] border border-indigo-500/10 rounded-2xl overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-400">
            {/* Header */}
            <div className="bg-indigo-500/5 border-b border-black/5 dark:border-white/5 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/80 animate-pulse shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
                    <span className="text-[9px] font-black text-indigo-500 dark:text-indigo-200 uppercase tracking-[0.2em]">
                        {isSquad ? 'Squad Blueprint' : 'Agent Suggestion'}
                    </span>
                </div>
                <span className="text-[8px] font-mono text-gray-500 dark:text-white/20 tracking-[0.1em] uppercase font-bold">READY</span>
            </div>

            <div className="p-4 space-y-4">
                {/* Squad name & objective */}
                {isSquad && (
                    <div className="space-y-2 pb-3 border-b border-black/5 dark:border-white/5">
                        <h4 className="text-base font-bold text-gray-900 dark:text-white leading-tight">{toolCall.args.teamName}</h4>
                        <p className="text-xs text-gray-600 dark:text-slate-400 leading-relaxed italic border-l border-indigo-500/20 pl-3">"{toolCall.args.objective}"</p>
                    </div>
                )}

                {/* Agent Cards — compact: Name + Role + Description + Tools */}
                <div className={`grid gap-3 ${isSquad ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                    {specialists.map((spec: any, idx: number) => (
                        <div key={idx} className="bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-xl p-4 space-y-3 hover:border-indigo-500/20 transition-all">
                            {/* Identity */}
                            <div className="flex items-center gap-3">
                                <div className="text-xl bg-white dark:bg-black p-2 rounded-lg border border-black/10 dark:border-white/10">{spec.icon}</div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-[12px] font-bold text-gray-900 dark:text-white truncate leading-tight uppercase">{spec.name}</div>
                                    <div className="text-[9px] text-indigo-400/50 uppercase tracking-tighter truncate font-mono">{spec.role}</div>
                                </div>
                            </div>

                            {/* Short description — from Prism's args, NOT the system prompt */}
                            {spec.description && (
                                <p className="text-[11px] text-gray-600 dark:text-slate-400 leading-relaxed">{spec.description}</p>
                            )}

                            {/* Tool badges */}
                            {spec.capabilities && spec.capabilities.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {spec.capabilities.map((tool: string) => (
                                        <span key={tool} className="text-[8px] px-2 py-0.5 bg-indigo-500/10 text-indigo-300/60 rounded border border-indigo-500/20 uppercase tracking-wider font-bold">
                                            {tool}
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Model selector */}
                            <div className="space-y-1.5">
                                <label className="text-[7px] font-black text-gray-500 dark:text-white/20 uppercase tracking-[0.2em]">Select Brain Layer</label>
                                <select
                                    value={selectedModels[idx] || spec.modelId || ''}
                                    onChange={e => setSelectedModels(prev => ({ ...prev, [idx]: e.target.value }))}
                                    className="w-full bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded-lg p-2 text-[10px] text-indigo-600 dark:text-indigo-300 font-bold outline-none focus:border-indigo-500 transition-colors"
                                >
                                    <option value="" disabled>Choose Model...</option>
                                    {AI_RESUMES.map(m => (
                                        <option key={m.id} value={m.modelId}>{m.name} ({m.tagline})</option>
                                    ))}
                                </select>
                                {spec.suggestedModel && (
                                    <p className="text-[7px] text-indigo-500/60 font-mono uppercase tracking-tighter mt-1 italic">
                                        Prism Suggests: {spec.suggestedModel}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Deploy button */}
                {isExecuting ? (
                    <div className="py-2 space-y-2 text-center">
                        <LoadingSpinner width={20} height={10} className="text-indigo-400" />
                        <p className="text-[8px] text-indigo-400/40 font-mono tracking-[0.4em] uppercase font-black">Deploying...</p>
                    </div>
                ) : (
                    <button
                        onClick={handleDeploy}
                        className="w-full py-2.5 bg-white hover:bg-slate-100 text-black text-[9px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 group"
                    >
                        <span>Deploy Agent</span>
                        <span className="group-hover:translate-x-1 transition-transform">→</span>
                    </button>
                )}
            </div>
        </div>
    );
};

const SimpleMarkdown: React.FC<{ text: string }> = ({ text }) => {
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'code', language: match[1], content: match[2] });
        lastIndex = codeBlockRegex.lastIndex;
    }
    if (lastIndex < text.length) {
        parts.push({ type: 'text', content: text.slice(lastIndex) });
    }

    return (
        <div className="space-y-3">
            {parts.map((part, idx) => {
                if (part.type === 'code') {
                    return (
                        <div key={idx} className="border rounded-xl my-4 overflow-hidden bg-slate-50 dark:bg-slate-950 border-black/5 dark:border-white/5">
                            <div className="flex items-center justify-between px-4 py-2 border-b bg-black/[0.01] dark:bg-white/[0.01] border-black/5 dark:border-white/5">
                                <span className="text-[8px] uppercase font-black tracking-[0.2em] text-slate-600 dark:text-slate-500">{part.language || 'Protocol'}</span>
                                <button className="text-[8px] text-slate-600 dark:text-slate-500 hover:text-black dark:hover:text-white transition uppercase font-black tracking-[0.1em]" onClick={() => navigator.clipboard.writeText(part.content)}>Copy</button>
                            </div>
                            <div className="p-4 overflow-x-auto custom-scrollbar">
                                <pre className="font-mono text-[12px] whitespace-pre leading-relaxed text-gray-700 dark:text-slate-400">{part.content?.trim()}</pre>
                            </div>
                        </div>
                    );
                } else {
                    if (!part.content?.trim()) return null;
                    return part.content?.split('\n').map((line, lineIdx) => {
                        if (!line.trim()) return <div key={lineIdx} className="h-2" />;

                        const isBullet = line.trim().match(/^[-*]\s/);
                        const isNumber = line.trim().match(/^\d+\.\s/);

                        let content = line.trim();
                        if (isBullet) content = content.substring(2);
                        else if (isNumber) content = content.substring(line.indexOf(' ') + 1);

                        const inlineParts = content.split(/(\*\*.*?\*\*|`.*?`)/g).map((subPart, subIdx) => {
                            if (subPart.startsWith('**') && subPart.endsWith('**')) {
                                return <strong key={subIdx} className="text-gray-900 dark:text-white font-bold">{subPart.slice(2, -2)}</strong>;
                            }
                            if (subPart.startsWith('`') && subPart.endsWith('`')) {
                                return <span key={subIdx} className="bg-black/5 dark:bg-white/5 text-indigo-600 dark:text-indigo-300 font-mono text-[11px] px-1 py-0.5 rounded border border-black/5 dark:border-white/5 font-semibold">{subPart.slice(1, -1)}</span>;
                            }
                            return subPart;
                        });

                        return (
                            <div key={lineIdx} className={`min-h-[1.4em] ${isBullet || isNumber ? 'pl-6 relative mb-2' : 'mb-2'}`}>
                                {isBullet && <span className="absolute left-1.5 top-2 w-1 h-1 rounded-full bg-indigo-500/30" />}
                                {isNumber && <span className="absolute left-0 text-indigo-500/20 text-[10px] font-mono top-0.5 font-bold">{line.match(/^\d+\./)?.[0]}</span>}
                                <span className="text-gray-700 dark:text-slate-300 leading-relaxed font-normal text-[14px]">{inlineParts}</span>
                            </div>
                        );
                    });
                }
            })}
        </div>
    )
}

const MessageComponent: React.FC<MessageProps> = ({ message, onExecuteCommand }) => {
    const isUser = message.type === 'user';
    const mode = (message.content as any).mode || 'CHAT';

    const renderContent = () => {
        switch (message.content.type) {
            case 'text':
                return (
                    <div className="space-y-3">
                        {mode === 'SOLUTION' && (
                            <div className="flex items-center gap-2 mb-4 bg-indigo-500/5 p-2 px-3 rounded-lg border border-indigo-500/10">
                                <span className="w-1 h-4 bg-indigo-500/60 rounded-full" />
                                <span className="text-[9px] font-black text-indigo-400/80 uppercase tracking-[0.2em]">Intelligence Resolution</span>
                            </div>
                        )}

                        <SimpleMarkdown text={message.content.text} />

                        {message.content.groundingChunks && (
                            <div className="mt-6 pt-4 border-t border-white/5 flex flex-wrap gap-2">
                                {message.content.groundingChunks.map((c, i) => {
                                    const s = c.web || c.maps;
                                    return s?.uri ? <a key={i} href={s.uri} target="_blank" className="text-[8px] bg-black/[0.03] dark:bg-white/[0.03] text-gray-600 dark:text-slate-500 px-3 py-1.5 rounded-md border border-black/5 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/10 hover:text-black dark:hover:text-white transition-all uppercase tracking-[0.1em] font-bold">{s.title || 'Citation'}</a> : null;
                                })}
                            </div>
                        )}

                        {message.content.toolCall && (
                            <CommandProposal
                                toolCall={message.content.toolCall}
                                isExecuting={message.content.isExecuting}
                                onProceed={(args) => onExecuteCommand?.(message.id, args ? { ...message.content.toolCall!, args } : message.content.toolCall!)}
                            />
                        )}
                    </div>
                );
            case 'image':
                return (
                    <div className="space-y-4">
                        {message.content.text && <SimpleMarkdown text={message.content.text} />}
                        <div className="relative group overflow-hidden rounded-xl border border-white/10 shadow-lg transition-all duration-500 hover:border-white/20">
                            <img src={message.content.imageUrl} alt="Synthesis" className="w-full h-auto" />
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-end">
                                <span className="text-[8px] font-black text-white/40 uppercase tracking-[0.3em]">Synthesis Resolved</span>
                            </div>
                        </div>
                    </div>
                );
            case 'video':
                return (
                    <div className="space-y-4">
                        {message.content.text && <SimpleMarkdown text={message.content.text} />}
                        <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-lg bg-black">
                            <video src={message.content.videoUrl} controls autoPlay loop className="w-full h-auto" />
                        </div>
                    </div>
                );
            default: return null;
        }
    }

    return (
        <div className={`flex items-start gap-4 group animate-in fade-in slide-in-from-bottom-2 duration-400 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] lg:max-w-2xl xl:max-w-3xl`}>
                {!isUser && (
                    <div className="flex items-center gap-2.5 mb-2 ml-1">
                        <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 border border-black/10 dark:border-white/10 bg-black/[0.04] dark:bg-white/[0.04] flex items-center justify-center opacity-60 group-hover:opacity-100 transition-all duration-300 text-gray-900 dark:text-white">
                            {message.agent.profileImage ? (
                                <img src={message.agent.profileImage} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="text-xs">{message.agent.icon}</div>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <span className="font-black text-[10px] text-slate-500 uppercase tracking-[0.2em] group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors leading-none">{message.agent.name}</span>
                            <span className="text-[8px] text-indigo-400/80 dark:text-indigo-400/40 font-black uppercase tracking-[0.05em]">{message.agent.role}</span>
                        </div>
                    </div>
                )}
                <div className={`p-2 md:p-3 rounded-2xl text-[14px] leading-relaxed transition-all duration-300 ${isUser ? 'bg-transparent text-gray-900 dark:text-white border border-black/10 dark:border-white/10 shadow-none' : 'bg-transparent text-gray-800 dark:text-slate-300 border border-black/5 dark:border-white/5'} ${mode === 'SOLUTION' ? 'border-indigo-500/20' : ''}`}>
                    {renderContent()}
                </div>
            </div>
        </div>
    );
};

export const Message = React.memo(MessageComponent, (prevProps, nextProps) => {
    if (prevProps.message.id !== nextProps.message.id) return false;

    const prevContent = prevProps.message.content as any;
    const nextContent = nextProps.message.content as any;

    if (prevContent.text !== nextContent.text) return false;
    if (prevContent.mode !== nextContent.mode) return false;

    return true;
});
