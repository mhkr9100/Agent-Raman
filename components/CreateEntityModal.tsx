
import React, { useState, useEffect } from 'react';
import { Agent, Team, AgentCapability } from '../types';
import { XMarkIcon } from './icons/XMarkIcon';
import { listTools, listModels, ToolRegistryItem, ModelRegistryItem } from '../services/apiV2';
import { normalizeToolIds } from '../services/toolIds';
import { validateDocumentFile } from '../services/documentParser';

interface CreateEntityModalProps {
    isOpen: boolean;
    type: 'employee' | 'rouge' | 'project';
    employees: Agent[];
    onClose: () => void;
    onCreateEmployee: (data: any) => Promise<void> | void;
    onCreateGroup: (data: any) => void;
    initialValues?: {
        profileId?: string;
        modelId?: string;
        role?: string;
        jd?: string;
        name?: string;
        capabilities?: (AgentCapability | string)[];
        knowledgeBase?: any[];
    };
}

export const CreateEntityModal: React.FC<CreateEntityModalProps> = ({
    isOpen,
    type,
    onClose,
    onCreateEmployee,
    onCreateGroup,
    initialValues,
    employees
}) => {
    const [name, setName] = useState(initialValues?.name || '');
    const [jd, setJd] = useState(initialValues?.jd || '');
    const [description, setDescription] = useState('');
    const [selectedModelId, setSelectedModelId] = useState(initialValues?.modelId || initialValues?.profileId || '');
    const [availableModels, setAvailableModels] = useState<ModelRegistryItem[]>([]);
    const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>(normalizeToolIds(initialValues?.capabilities || []));
    const [availableTools, setAvailableTools] = useState<ToolRegistryItem[]>([]);
    const [pendingDocuments, setPendingDocuments] = useState<File[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);

    useEffect(() => {
        if (initialValues) {
            if (initialValues.jd) setJd(initialValues.jd);
            if (initialValues.modelId || initialValues.profileId) setSelectedModelId(initialValues.modelId || initialValues.profileId || '');
            if (initialValues.name) setName(initialValues.name);
            if (initialValues.capabilities) setSelectedCapabilities(normalizeToolIds(initialValues.capabilities));
        }
    }, [initialValues]);

    useEffect(() => {
        if (!isOpen || type !== 'employee') return;
        let mounted = true;
        (async () => {
            try {
                const modelRes = await listModels();
                if (!mounted) return;
                const models = Array.isArray(modelRes.models) ? modelRes.models : [];
                setAvailableModels(models);
                if (models.length > 0) {
                    setSelectedModelId(prev => prev || models[0].modelId);
                }

                const res = await listTools();
                if (!mounted) return;
                const allowed = new Set(['web-search', 'thinking', 'image-generation']);
                const normalized = (res.tools || [])
                    .map(tool => ({ ...tool, toolId: normalizeToolIds([tool.toolId])[0] || tool.toolId }))
                    .filter(tool => allowed.has(tool.toolId));
                setAvailableTools(normalized);
                if (normalized.length > 0) {
                    setSelectedCapabilities(prev => {
                        if (prev.length > 0) return prev;
                        const fallback = normalized.find(tool => tool.toolId === 'thinking')?.toolId || normalized[0].toolId;
                        return fallback ? [fallback] : prev;
                    });
                }
            } catch (error) {
                if (!mounted) return;
                setAvailableModels([]);
                setAvailableTools([]);
            }
        })();

        return () => { mounted = false; };
    }, [isOpen, type]);

    if (!isOpen) return null;

    const toggleCapability = (capId: string) => {
        setSelectedCapabilities(prev =>
            prev.includes(capId) ? prev.filter(c => c !== capId) : [...prev, capId]
        );
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setAttachmentError(null);

        const remainingSlots = Math.max(0, 5 - pendingDocuments.length);
        const selected = files.slice(0, remainingSlots);
        if (files.length > remainingSlots) {
            setAttachmentError('Only 5 documents are allowed while creating an agent.');
        }

        const accepted: File[] = [];
        for (const file of selected) {
            try {
                validateDocumentFile(file);
                accepted.push(file);
            } catch (err: any) {
                setAttachmentError(err?.message || 'Invalid document');
            }
        }

        if (accepted.length > 0) {
            setPendingDocuments(prev => [...prev, ...accepted].slice(0, 5));
        }

        if (e.target) e.target.value = '';
    };

    const handleSaveEmployee = async () => {
        const selectedModel = availableModels.find(m => m.modelId === selectedModelId) || availableModels[0];
        const modelId = selectedModel?.modelId || selectedModelId || 'gemini-2.5-flash';
        setIsCreating(true);
        try {
            await onCreateEmployee({
                name: name.trim(),
                role: name.trim(),
                jobDescription: jd,
                icon: selectedModel?.icon || '🤖',
                provider: selectedModel?.provider || 'google',
                model: modelId,
                isDeletable: true,
                toolIds: selectedCapabilities,
                pendingDocuments
            });
            onClose();
        } finally {
            setIsCreating(false);
        }
    };

    const handleSaveGroup = () => {
        onCreateGroup({
            name,
            description,
            agentIds: Array.from(selectedExistingIds),
            type: type
        });
        onClose();
    };

    const [selectedExistingIds, setSelectedExistingIds] = useState<Set<string>>(new Set());
    const toggleExistingAgent = (id: string) => {
        setSelectedExistingIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4">
            <div className="bg-[#1A1A1A] w-full max-w-xl rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-xl font-bold text-white uppercase tracking-tight">
                        {type === 'employee' ? 'Create Agent' : 'Create Team'}
                    </h2>
                    <button onClick={onClose} className="hover:text-white text-white/40 transition"><XMarkIcon /></button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {type === 'employee' ? (
                        <>
                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Agent Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full bg-black border border-white/10 rounded-xl p-3 text-white focus:border-white outline-none text-sm"
                                    placeholder="e.g. Content Strategist"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">AI Model (Brain)</label>
                                <select
                                    value={selectedModelId}
                                    onChange={e => setSelectedModelId(e.target.value)}
                                    className="w-full bg-black border border-white/10 rounded-xl p-3 text-white focus:border-white outline-none text-sm appearance-none"
                                >
                                    {availableModels.map(model => (
                                        <option key={model.modelId} value={model.modelId}>
                                            {model.name || model.modelId}
                                        </option>
                                    ))}
                                </select>
                                {availableModels.length === 0 && (
                                    <p className="text-[10px] text-white/40 mt-2">No models loaded from registry.</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">System Instructions</label>
                                <textarea
                                    value={jd}
                                    onChange={e => setJd(e.target.value)}
                                    rows={6}
                                    className="w-full bg-black border border-white/10 rounded-xl p-4 text-white focus:border-white outline-none text-xs leading-relaxed resize-none cursor-text mb-6"
                                    placeholder="Define exactly how this agent should behave..."
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest">Knowledge Documents</label>
                                    <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded uppercase tracking-wider font-bold">Saved After Create</span>
                                </div>

                                <div className="space-y-2">
                                    {pendingDocuments.map((doc, idx) => (
                                        <div key={`${doc.name}-${doc.size}-${idx}`} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
                                            <div className="flex flex-1 items-center gap-3 overflow-hidden">
                                                <span className="text-xl">📄</span>
                                                <div className="truncate pr-4">
                                                    <div className="text-xs font-bold text-white truncate">{doc.name}</div>
                                                    <div className="text-[9px] text-white/40 uppercase tracking-widest">{(doc.size / 1024).toFixed(1)} KB</div>
                                                </div>
                                            </div>
                                            <button onClick={() => setPendingDocuments(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-1 flex-shrink-0 relative z-10 transition-colors">
                                                <XMarkIcon />
                                            </button>
                                        </div>
                                    ))}

                                    {attachmentError && (
                                        <p className="text-[10px] text-amber-400">{attachmentError}</p>
                                    )}

                                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-xl cursor-pointer transition-colors bg-black border-white/10 hover:bg-white/5 hover:border-white/30">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <svg className="w-6 h-6 mb-2 text-white/40" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" /></svg>
                                            <p className="mb-1 text-[10px] text-white/60 font-bold"><span className="text-white">Select documents</span> (upload after create)</p>
                                            <p className="text-[8px] uppercase tracking-widest text-white/40">PDF, TXT, DOCX, CSV, MD (max 5)</p>
                                        </div>
                                        <input type="file" className="hidden" onChange={handleFileUpload} multiple accept=".pdf,.txt,.doc,.docx,.csv,.md,.json,.yaml,.yml,.xml" />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-3">Tools</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {availableTools.map(cap => (
                                        <button
                                            key={cap.toolId}
                                            type="button"
                                            onClick={() => toggleCapability(cap.toolId)}
                                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${selectedCapabilities.includes(cap.toolId) ? 'bg-white/10 border-white/40' : 'bg-black border-white/5 hover:border-white/20'}`}
                                        >
                                            <span className="text-lg">{cap.icon || '🧩'}</span>
                                            <span className="text-[10px] font-bold text-white uppercase">{cap.name || cap.toolId}</span>
                                        </button>
                                    ))}
                                </div>
                                {availableTools.length === 0 && (
                                    <p className="text-[10px] text-white/40 mt-2">No tools loaded from registry.</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Team Name</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full bg-black border border-white/10 rounded-xl p-3 text-white focus:border-white outline-none text-sm" placeholder="e.g. Project Alpha" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-white/40 uppercase tracking-widest mb-2">Team Objective</label>
                                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full bg-black border border-white/10 rounded-xl p-3 text-white focus:border-white outline-none text-sm resize-none" placeholder="What is the goal of this team?" />
                            </div>

                            <div className="bg-black border border-white/5 rounded-2xl p-4">
                                <h3 className="text-[10px] font-black text-white/40 uppercase tracking-widest mb-4">Select Members</h3>
                                <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
                                    {employees.map(agent => (
                                        <div key={agent.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition ${selectedExistingIds.has(agent.id) ? 'bg-white/10' : 'hover:bg-white/5'}`} onClick={() => toggleExistingAgent(agent.id)}>
                                            <input type="checkbox" checked={selectedExistingIds.has(agent.id)} readOnly className="rounded border-white/20 bg-black text-white" />
                                            <span className="text-sm text-white/80">{agent.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="p-6 border-t border-white/10 flex justify-end">
                    <button
                        type="button"
                        onClick={type === 'employee' ? handleSaveEmployee : handleSaveGroup}
                        disabled={
                            isCreating ||
                            !name.trim() ||
                            (type === 'employee'
                                ? (!jd.trim() || !selectedModelId || selectedCapabilities.length === 0)
                                : selectedExistingIds.size === 0)
                        }
                        className="bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] py-4 px-12 rounded-xl disabled:opacity-30 transition hover:bg-white/90 active:scale-95"
                    >
                        {type === 'employee' ? (isCreating ? 'Creating...' : 'Create Agent') : 'Create Team'}
                    </button>
                </div>
            </div>
        </div>
    );
};
