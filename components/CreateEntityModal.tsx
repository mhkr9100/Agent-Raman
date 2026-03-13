
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
                const normalized = (res.tools || [])
                    .map(tool => ({ ...tool, toolId: normalizeToolIds([tool.toolId])[0] || tool.toolId }))
                    .filter(tool => !!tool.toolId);
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
            setAttachmentError('Only 5 documents are allowed while creating a chatbot.');
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
        <div className="fixed inset-0 bg-black/65 z-[60] flex items-center justify-center p-4 backdrop-blur-md">
            <div className="w-full max-w-xl rounded-[28px] shadow-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#15171a] flex flex-col overflow-hidden max-h-[90vh]">
                <div className="flex items-center justify-between p-6 border-b border-black/10 dark:border-white/10">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white uppercase tracking-tight">
                        {type === 'employee' ? 'Create ChatBot' : 'Create Team'}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-900 dark:text-white/40 dark:hover:text-white transition"><XMarkIcon /></button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {type === 'employee' ? (
                        <>
                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">ChatBot Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-3 text-sm text-gray-900 dark:text-white outline-none transition-colors focus:border-gray-900 dark:focus:border-white"
                                    placeholder="e.g. Proposal Analyst"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">AI Model</label>
                                <select
                                    value={selectedModelId}
                                    onChange={e => setSelectedModelId(e.target.value)}
                                    className="w-full appearance-none rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-3 text-sm text-gray-900 dark:text-white outline-none transition-colors focus:border-gray-900 dark:focus:border-white"
                                >
                                    {availableModels.map(model => (
                                        <option key={model.modelId} value={model.modelId}>
                                            {model.name || model.modelId}
                                        </option>
                                    ))}
                                </select>
                                {availableModels.length === 0 && (
                                    <p className="text-[10px] text-gray-500 dark:text-white/40 mt-2">No models loaded from registry.</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">System Instructions</label>
                                <textarea
                                    value={jd}
                                    onChange={e => setJd(e.target.value)}
                                    rows={6}
                                    className="w-full mb-6 resize-none rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-4 text-xs leading-relaxed text-gray-900 dark:text-white outline-none transition-colors focus:border-gray-900 dark:focus:border-white"
                                    placeholder="Define exactly how this chatbot should behave..."
                                />
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest">Knowledge Files</label>
                                    <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded uppercase tracking-wider font-bold">Saved After Create</span>
                                </div>

                                <div className="space-y-2">
                                    {pendingDocuments.map((doc, idx) => (
                                        <div key={`${doc.name}-${doc.size}-${idx}`} className="flex items-center justify-between rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04] p-3">
                                            <div className="flex flex-1 items-center gap-3 overflow-hidden">
                                                <span className="text-xl">📄</span>
                                                <div className="truncate pr-4">
                                                    <div className="text-xs font-bold text-gray-900 dark:text-white truncate">{doc.name}</div>
                                                    <div className="text-[9px] text-gray-500 dark:text-white/40 uppercase tracking-widest">{(doc.size / 1024).toFixed(1)} KB</div>
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

                                    <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed rounded-2xl cursor-pointer transition-colors border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] hover:border-black/20 dark:hover:border-white/30 hover:bg-black/[0.02] dark:hover:bg-white/[0.05]">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <svg className="w-6 h-6 mb-2 text-gray-500 dark:text-white/40" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2" /></svg>
                                            <p className="mb-1 text-[10px] text-gray-600 dark:text-white/60 font-bold"><span className="text-gray-900 dark:text-white">Select files</span> (upload after create)</p>
                                            <p className="text-[8px] uppercase tracking-widest text-gray-500 dark:text-white/40">PDF, TXT, DOCX, CSV, MD (max 5)</p>
                                        </div>
                                        <input type="file" className="hidden" onChange={handleFileUpload} multiple accept=".pdf,.txt,.doc,.docx,.csv,.md,.json,.yaml,.yml,.xml" />
                                    </label>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-3">Capabilities</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {availableTools.map(cap => (
                                        <button
                                            key={cap.toolId}
                                            type="button"
                                            onClick={() => toggleCapability(cap.toolId)}
                                            className={`flex items-center gap-3 rounded-2xl border p-3 transition-all ${selectedCapabilities.includes(cap.toolId) ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] hover:border-black/20 dark:hover:border-white/20'}`}
                                        >
                                            <span className="text-lg">{cap.icon || '🧩'}</span>
                                            <span className="text-[10px] font-bold text-gray-900 dark:text-white uppercase">{cap.name || cap.toolId}</span>
                                        </button>
                                    ))}
                                </div>
                                {availableTools.length === 0 && (
                                    <p className="text-[10px] text-gray-500 dark:text-white/40 mt-2">No capabilities loaded from registry.</p>
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">Team Name</label>
                                <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-3 text-sm text-gray-900 dark:text-white outline-none transition-colors focus:border-gray-900 dark:focus:border-white" placeholder="e.g. Proposal Ops" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-2">Team Objective</label>
                                <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="w-full resize-none rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-3 text-sm text-gray-900 dark:text-white outline-none transition-colors focus:border-gray-900 dark:focus:border-white" placeholder="What is the goal of this team?" />
                            </div>

                            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-4">
                                <h3 className="text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-widest mb-4">Select ChatBots</h3>
                                <div className="max-h-40 overflow-y-auto space-y-1 custom-scrollbar">
                                    {employees.map(agent => (
                                        <div key={agent.id} className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition ${selectedExistingIds.has(agent.id) ? 'bg-emerald-500/10' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.05]'}`} onClick={() => toggleExistingAgent(agent.id)}>
                                            <input type="checkbox" checked={selectedExistingIds.has(agent.id)} readOnly className="rounded border-black/20 dark:border-white/20 bg-transparent text-emerald-500" />
                                            <span className="text-sm text-gray-800 dark:text-white/80">{agent.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="p-6 border-t border-black/10 dark:border-white/10 flex justify-end">
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
                        className="rounded-2xl bg-gray-900 dark:bg-white px-12 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-white dark:text-black transition hover:bg-black dark:hover:bg-white/90 active:scale-95 disabled:opacity-30"
                    >
                        {type === 'employee' ? (isCreating ? 'Creating...' : 'Create ChatBot') : 'Create Team'}
                    </button>
                </div>
            </div>
        </div>
    );
};
