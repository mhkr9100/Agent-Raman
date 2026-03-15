import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PageNode, UserMapImportance } from '../types';

type ViewMode = 'tree' | 'storyboard';
type ExportFormat = 'prompt' | 'json';
type ContextMode = 'all' | 'high-signal' | 'collaboration' | 'execution' | 'technical';

interface UserMapViewProps {
    tree: PageNode;
    isConsolidating: boolean;
    onUpdateNode: (nodeId: string, updates: Partial<PageNode>) => void;
    onDeleteNode: (nodeId: string) => void;
    onAddNode: (parentId: string, newNode: PageNode) => void;
    onConsolidate: () => void;
    onImportContext: () => void;
}

interface ContextEntry {
    category: string;
    label: string;
    value: string;
    importance: UserMapImportance;
    confidence?: number;
    sourceDate?: string;
    nodeType?: string;
}

const CATEGORY_ORDER = [
    'Identity',
    'Preferences',
    'Career',
    'Education',
    'Projects',
    'Operations',
    'Marketing & Communications',
    'Technical Stack',
    'Business Goals',
    'Instructions',
    'General Context'
];

const IMPORTANCE_META: Record<UserMapImportance, { label: string; className: string }> = {
    high: {
        label: 'High Signal',
        className: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    },
    medium: {
        label: 'Medium',
        className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    },
    low: {
        label: 'Reference',
        className: 'border-black/10 bg-black/[0.03] text-gray-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/50'
    }
};

const IMPORTANCE_ORDER: Record<UserMapImportance, number> = {
    high: 0,
    medium: 1,
    low: 2
};

const CONTEXT_MODES: Array<{
    id: ContextMode;
    label: string;
    description: string;
}> = [
    { id: 'all', label: 'All Context', description: 'Everything currently stored in UserMap.' },
    { id: 'high-signal', label: 'High Signal', description: 'Only the strongest directives, preferences, and goals.' },
    { id: 'collaboration', label: 'AI Collaboration', description: 'How the user wants AI to behave, respond, and coordinate.' },
    { id: 'execution', label: 'Execution', description: 'Work context for operations, projects, goals, and active delivery.' },
    { id: 'technical', label: 'Technical', description: 'Technical stack, build context, and implementation signal.' }
];

function normalizeImportance(value?: string): UserMapImportance {
    return value === 'high' || value === 'low' ? value : 'medium';
}

function compareNodes(left: PageNode, right: PageNode) {
    const leftIsCategory = left.nodeType === 'category';
    const rightIsCategory = right.nodeType === 'category';

    if (leftIsCategory && rightIsCategory) {
        const leftIndex = CATEGORY_ORDER.indexOf(left.label);
        const rightIndex = CATEGORY_ORDER.indexOf(right.label);
        return (leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex) - (rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex);
    }

    const leftImportance = IMPORTANCE_ORDER[normalizeImportance(left.importance)];
    const rightImportance = IMPORTANCE_ORDER[normalizeImportance(right.importance)];
    if (leftImportance !== rightImportance) return leftImportance - rightImportance;

    const leftCluster = left.nodeType === 'cluster' ? 0 : 1;
    const rightCluster = right.nodeType === 'cluster' ? 0 : 1;
    if (leftCluster !== rightCluster) return leftCluster - rightCluster;

    return left.label.localeCompare(right.label);
}

function getNextImportance(current?: string): UserMapImportance {
    switch (normalizeImportance(current)) {
        case 'high':
            return 'low';
        case 'low':
            return 'medium';
        default:
            return 'high';
    }
}

function summarizeNodeValue(node: PageNode): string {
    if (typeof node.value === 'string' && node.value.trim()) return node.value.trim();
    if (!Array.isArray(node.children) || node.children.length === 0) return '';

    return node.children
        .slice(0, 3)
        .map((child) => `${child.label}${child.value ? `: ${child.value}` : ''}`)
        .join(' | ')
        .trim();
}

function matchesMode(entry: ContextEntry, mode: ContextMode) {
    if (mode === 'all') return true;
    if (mode === 'high-signal') return entry.importance === 'high';
    if (mode === 'collaboration') return ['Preferences', 'Instructions', 'Identity'].includes(entry.category);
    if (mode === 'execution') return ['Career', 'Projects', 'Operations', 'Business Goals', 'Marketing & Communications'].includes(entry.category);
    if (mode === 'technical') return ['Technical Stack', 'Projects', 'Operations'].includes(entry.category);
    return true;
}

function filterTreeByMode(node: PageNode, mode: ContextMode, categoryLabel?: string): PageNode | null {
    if (!node) return null;
    if (node.id === 'root') {
        const children = (node.children || [])
            .map((child) => filterTreeByMode(child, mode, child.label))
            .filter(Boolean) as PageNode[];
        return { ...node, children };
    }

    const isCategory = node.nodeType === 'category';
    const activeCategory = isCategory ? node.label : (categoryLabel || 'General Context');
    const children = (node.children || [])
        .map((child) => filterTreeByMode(child, mode, activeCategory))
        .filter(Boolean) as PageNode[];

    if (isCategory) {
        return children.length > 0 ? { ...node, children } : null;
    }

    const entry: ContextEntry = {
        category: activeCategory,
        label: node.label,
        value: summarizeNodeValue(node),
        importance: normalizeImportance(node.importance),
        confidence: node.confidence,
        sourceDate: node.sourceDate,
        nodeType: node.nodeType
    };

    if (children.length > 0) {
        return matchesMode(entry, mode) || children.length > 0 ? { ...node, children } : null;
    }

    return matchesMode(entry, mode) ? { ...node, children: [] } : null;
}

function flattenContextEntries(node: PageNode, categoryLabel?: string, entries: ContextEntry[] = []): ContextEntry[] {
    if (!node) return entries;
    if (node.id === 'root') {
        (node.children || []).forEach((child) => flattenContextEntries(child, child.label, entries));
        return entries;
    }

    const isCategory = node.nodeType === 'category';
    const activeCategory = isCategory ? node.label : (categoryLabel || 'General Context');

    if (!isCategory) {
        const value = summarizeNodeValue(node);
        if (value) {
            entries.push({
                category: activeCategory,
                label: node.label,
                value,
                importance: normalizeImportance(node.importance),
                confidence: node.confidence,
                sourceDate: node.sourceDate,
                nodeType: node.nodeType
            });
        }
    }

    (node.children || []).forEach((child) => flattenContextEntries(child, activeCategory, entries));
    return entries;
}

function buildPromptExport(entries: ContextEntry[], mode: ContextMode) {
    const grouped = new Map<string, ContextEntry[]>();
    for (const entry of entries) {
        if (!grouped.has(entry.category)) grouped.set(entry.category, []);
        grouped.get(entry.category)!.push(entry);
    }

    const lines = [`Context Mode: ${CONTEXT_MODES.find((item) => item.id === mode)?.label || 'All Context'}`, ''];

    for (const category of CATEGORY_ORDER) {
        const categoryEntries = grouped.get(category);
        if (!categoryEntries || categoryEntries.length === 0) continue;
        lines.push(`## ${category}`);
        categoryEntries.forEach((entry) => {
            const confidence = typeof entry.confidence === 'number' ? ` (${Math.round(entry.confidence * 100)}% confidence)` : '';
            lines.push(`- [${entry.importance.toUpperCase()}] ${entry.label}: ${entry.value}${confidence}`);
        });
        lines.push('');
    }

    return lines.join('\n').trim();
}

function buildJsonExport(entries: ContextEntry[], mode: ContextMode) {
    const grouped = CATEGORY_ORDER.reduce<Record<string, ContextEntry[]>>((acc, category) => {
        const categoryEntries = entries.filter((entry) => entry.category === category);
        if (categoryEntries.length > 0) acc[category] = categoryEntries;
        return acc;
    }, {});

    return JSON.stringify({
        generatedAt: new Date().toISOString(),
        contextMode: mode,
        categories: grouped
    }, null, 2);
}

const SignalBadge: React.FC<{ importance?: string; confidence?: number; sourceDate?: string }> = ({ importance, confidence, sourceDate }) => {
    const normalized = normalizeImportance(importance);
    const meta = IMPORTANCE_META[normalized];
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.16em] ${meta.className}`}>
                {meta.label}
            </span>
            {typeof confidence === 'number' && (
                <span className="text-[8px] uppercase tracking-[0.14em] text-gray-400 dark:text-white/25">
                    {Math.round(confidence * 100)}% confidence
                </span>
            )}
            {sourceDate && (
                <span className="text-[8px] uppercase tracking-[0.14em] text-gray-400 dark:text-white/25">
                    {sourceDate}
                </span>
            )}
        </div>
    );
};

const TreeNode: React.FC<{
    node: PageNode;
    depth: number;
    onUpdate: (nodeId: string, updates: Partial<PageNode>) => void;
    onDelete: (nodeId: string) => void;
    onAdd: (parentId: string, newNode: PageNode) => void;
}> = ({ node, depth, onUpdate, onDelete, onAdd }) => {
    const [isExpanded, setIsExpanded] = useState(depth < 2);
    const [isEditing, setIsEditing] = useState(false);
    const [editLabel, setEditLabel] = useState(node.label);
    const [editValue, setEditValue] = useState(node.value || '');
    const [isAddingChild, setIsAddingChild] = useState(false);
    const [newChildLabel, setNewChildLabel] = useState('');

    const isLeaf = node.children.length === 0 && !!node.value;
    const isRoot = depth === 0;

    const handleSaveEdit = () => {
        onUpdate(node.id, { label: editLabel, value: editValue || undefined });
        setIsEditing(false);
    };

    const handleAddChild = () => {
        if (!newChildLabel.trim()) return;
        const newNode: PageNode = {
            id: `node-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            label: newChildLabel.trim(),
            nodeType: 'fact',
            importance: 'medium',
            confidence: 1,
            source: 'manual',
            children: []
        };
        onAdd(node.id, newNode);
        setNewChildLabel('');
        setIsAddingChild(false);
        setIsExpanded(true);
    };

    return (
        <div className={`${depth > 0 ? 'border-l border-black/10 dark:border-white/5' : ''}`} style={{ marginLeft: depth > 0 ? 12 : 0 }}>
            <div className={`group flex items-start gap-2 py-2 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-all ${isRoot ? 'mb-2' : ''}`}>
                {node.children.length > 0 ? (
                    <button onClick={() => setIsExpanded(!isExpanded)} className="mt-0.5 text-gray-400 dark:text-white/20 hover:text-gray-900 dark:hover:text-white/60 transition-colors w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </button>
                ) : (
                    <div className="mt-1 w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-white/20" />
                    </div>
                )}

                {isEditing ? (
                    <div className="flex-1 flex gap-2 items-center">
                        <input
                            value={editLabel}
                            onChange={e => setEditLabel(e.target.value)}
                            className="flex-1 bg-white dark:bg-black border border-black/20 dark:border-white/20 rounded px-2 py-1 text-xs text-gray-900 dark:text-white outline-none focus:border-black dark:focus:border-white/40"
                            autoFocus
                            onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                        />
                        {isLeaf && (
                            <input
                                value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                className="flex-1 bg-white dark:bg-black border border-black/10 dark:border-white/10 rounded px-2 py-1 text-[10px] text-gray-600 dark:text-white/60 outline-none focus:border-black dark:focus:border-white/40"
                                placeholder="Value..."
                                onKeyDown={e => e.key === 'Enter' && handleSaveEdit()}
                            />
                        )}
                        <button onClick={handleSaveEdit} className="text-gray-600 dark:text-white/60 text-[9px] font-bold uppercase">Save</button>
                        <button onClick={() => setIsEditing(false)} className="text-gray-400 dark:text-white/30 text-[9px] font-bold uppercase">Cancel</button>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className={`text-xs font-semibold cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors ${isRoot ? 'text-gray-900 dark:text-white/90 text-sm font-black uppercase tracking-widest' : isLeaf ? 'text-gray-500 dark:text-white/60' : 'text-gray-700 dark:text-white/80'}`}
                                    onClick={() => !isRoot && setIsEditing(true)}
                                >
                                    {node.label}
                                </span>
                                {!isRoot && <SignalBadge importance={node.importance} confidence={node.confidence} sourceDate={node.sourceDate} />}
                            </div>
                            {node.value && (
                                <p className="text-[10px] text-gray-400 dark:text-white/30 leading-relaxed">{node.value}</p>
                            )}
                        </div>

                        {!isRoot && (
                            <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                <button
                                    onClick={() => onUpdate(node.id, { importance: getNextImportance(node.importance) })}
                                    className="p-1 text-gray-400 dark:text-white/20 hover:text-amber-500 dark:hover:text-amber-300"
                                    title="Cycle importance"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m11.48 3.499 2.106 4.268a1.125 1.125 0 0 0 .847.616l4.71.684-3.408 3.322a1.125 1.125 0 0 0-.324.996l.804 4.692-4.212-2.214a1.125 1.125 0 0 0-1.046 0l-4.212 2.214.804-4.692a1.125 1.125 0 0 0-.324-.996L3.816 9.067l4.71-.684a1.125 1.125 0 0 0 .847-.616l2.106-4.268Z" /></svg>
                                </button>
                                <button onClick={() => setIsEditing(true)} className="p-1 text-gray-400 dark:text-white/20 hover:text-gray-900 dark:hover:text-white/60" title="Edit">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" /></svg>
                                </button>
                                <button onClick={() => setIsAddingChild(true)} className="p-1 text-gray-400 dark:text-white/20 hover:text-gray-900 dark:hover:text-white/60" title="Add child">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                </button>
                                <button onClick={() => onDelete(node.id)} className="p-1 text-gray-400 dark:text-white/20 hover:text-red-500 dark:hover:text-red-400" title="Delete">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            <AnimatePresence>
                {isAddingChild && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="ml-6 overflow-hidden">
                        <div className="flex gap-2 items-center py-1 px-2">
                            <input
                                value={newChildLabel}
                                onChange={e => setNewChildLabel(e.target.value)}
                                className="flex-1 bg-white dark:bg-black border border-black/20 dark:border-white/20 rounded px-2 py-1 text-xs text-gray-900 dark:text-white outline-none focus:border-black dark:focus:border-white/40"
                                placeholder="New node label..."
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleAddChild()}
                            />
                            <button onClick={handleAddChild} className="text-gray-600 dark:text-white/60 text-[9px] font-bold uppercase">Add</button>
                            <button onClick={() => setIsAddingChild(false)} className="text-gray-400 dark:text-white/30 text-[9px] font-bold uppercase">Cancel</button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isExpanded && node.children.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        {[...node.children].sort(compareNodes).map(child => (
                            <TreeNode key={child.id} node={child} depth={depth + 1} onUpdate={onUpdate} onDelete={onDelete} onAdd={onAdd} />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const StoryboardCard: React.FC<{ node: PageNode; depth?: number }> = ({ node, depth = 0 }) => {
    const children = [...(node.children || [])].sort(compareNodes);
    const summary = summarizeNodeValue(node);
    const isCluster = node.nodeType === 'cluster' && children.length > 0;

    return (
        <div className={`relative ${depth > 0 ? 'ml-6' : ''}`}>
            {depth > 0 && <div className="absolute -left-6 top-6 h-px w-6 bg-black/10 dark:bg-white/10" />}
            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#111315] p-4 shadow-[0_16px_40px_rgba(15,23,42,0.05)] dark:shadow-none">
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-900 dark:text-white">{node.label}</h4>
                        <SignalBadge importance={node.importance} confidence={node.confidence} sourceDate={node.sourceDate} />
                    </div>
                    {summary && (
                        <p className="text-[11px] leading-6 text-gray-600 dark:text-white/60">{summary}</p>
                    )}
                    {isCluster && (
                        <p className="text-[9px] uppercase tracking-[0.14em] text-gray-400 dark:text-white/25">Nested relationship</p>
                    )}
                </div>
            </div>
            {children.length > 0 && (
                <div className="relative mt-3 space-y-3 before:absolute before:left-0 before:top-0 before:bottom-2 before:w-px before:bg-black/10 dark:before:bg-white/10">
                    {children.map((child) => (
                        <StoryboardCard key={child.id} node={child} depth={depth + 1} />
                    ))}
                </div>
            )}
        </div>
    );
};

const StoryboardLane: React.FC<{ category: PageNode }> = ({ category }) => {
    const children = [...(category.children || [])].sort(compareNodes);
    const highSignalCount = children.filter((child) => normalizeImportance(child.importance) === 'high').length;

    return (
        <div className="w-[320px] flex-shrink-0 rounded-[28px] border border-black/10 dark:border-white/10 bg-white/90 dark:bg-[#111315] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)] dark:shadow-none">
            <div className="mb-5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.22em] text-gray-900 dark:text-white">{category.label}</h3>
                    <span className="rounded-full border border-black/10 dark:border-white/10 px-2 py-1 text-[8px] font-black uppercase tracking-[0.16em] text-gray-500 dark:text-white/40">
                        {children.length} nodes
                    </span>
                </div>
                <p className="text-[10px] uppercase tracking-[0.14em] text-gray-400 dark:text-white/25">
                    {highSignalCount} high-signal nodes
                </p>
            </div>
            <div className="space-y-4">
                {children.map((child) => (
                    <StoryboardCard key={child.id} node={child} />
                ))}
            </div>
        </div>
    );
};

export const UserMapView: React.FC<UserMapViewProps> = ({
    tree, isConsolidating, onUpdateNode, onDeleteNode, onAddNode, onConsolidate, onImportContext
}) => {
    const [viewMode, setViewMode] = useState<ViewMode>('tree');
    const [contextMode, setContextMode] = useState<ContextMode>('all');
    const [exportFormat, setExportFormat] = useState<ExportFormat>('prompt');
    const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

    const filteredTree = useMemo(() => filterTreeByMode(tree, contextMode) || tree, [tree, contextMode]);
    const isEmpty = filteredTree.children.length === 0;
    const exportEntries = useMemo(
        () => flattenContextEntries(filteredTree).sort((left, right) => {
            const leftImportance = IMPORTANCE_ORDER[left.importance];
            const rightImportance = IMPORTANCE_ORDER[right.importance];
            if (leftImportance !== rightImportance) return leftImportance - rightImportance;
            return left.category.localeCompare(right.category) || left.label.localeCompare(right.label);
        }),
        [filteredTree]
    );
    const promptExport = useMemo(() => buildPromptExport(exportEntries, contextMode), [exportEntries, contextMode]);
    const jsonExport = useMemo(() => buildJsonExport(exportEntries, contextMode), [exportEntries, contextMode]);
    const exportPreview = exportFormat === 'prompt' ? promptExport : jsonExport;

    const handleCopyExport = async () => {
        const text = exportFormat === 'prompt' ? promptExport : jsonExport;
        await navigator.clipboard.writeText(text);
        setCopyState('copied');
        window.setTimeout(() => setCopyState('idle'), 1600);
    };

    return (
        <div className="flex-1 flex flex-col bg-[#F8F9FA] dark:bg-[#1A1A1A] overflow-hidden">
            <header className="h-16 border-b border-black/5 dark:border-white/5 flex items-center justify-between pl-16 md:pl-6 pr-6 flex-shrink-0 relative z-20">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center border border-black/10 dark:border-white/10">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-gray-600 dark:text-white/60">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6c0-3.313-2.687-6-6-6s-6 2.687-6 6a6 6 0 0 0 6 6Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75v1.5m0 7.5v1.5m5.25-5.25h-1.5m-7.5 0h-1.5" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-[10px] font-black text-gray-800 dark:text-white/80 uppercase tracking-[0.2em]">Context Brain</h2>
                        <p className="text-[8px] text-gray-500 dark:text-white/30 uppercase tracking-wider">Weighted Memory Map</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onImportContext}
                        className="px-4 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white/60 text-[9px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/10 transition-all flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0 4.142-3.358 7.5-7.5 7.5S4.5 16.142 4.5 12 7.858 4.5 12 4.5m0 0v4.5m0-4.5h4.5" /></svg>
                        Import Context
                    </button>
                    <button
                        onClick={onConsolidate}
                        disabled={isConsolidating}
                        className="px-4 py-2 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-white/60 text-[9px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isConsolidating ? (
                            <>
                                <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                                Consolidating...
                            </>
                        ) : (
                            <>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" /></svg>
                                Sync Memories
                            </>
                        )}
                    </button>
                </div>
            </header>

            {tree.children.length === 0 ? (
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                    <div className="flex flex-col items-center justify-center h-full text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-black/5 via-transparent to-transparent dark:from-white/5 pointer-events-none" />
                        <div className="w-20 h-20 rounded-3xl bg-black/5 dark:bg-white/10 text-gray-700 dark:text-white/70 flex items-center justify-center mb-6 border border-black/10 dark:border-white/10 shadow-inner z-10">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342M6.75 15a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm0 0v-3.675A55.378 55.378 0 0 1 12 8.443m-7.007 11.55A5.981 5.981 0 0 0 6.75 15.75v-1.5" />
                            </svg>
                        </div>
                        <h3 className="text-gray-900 dark:text-white font-black text-xl mb-3 z-10 tracking-tight">Empty Context Matrix</h3>
                        <p className="text-gray-500 dark:text-white/50 text-sm max-w-sm leading-relaxed mb-8 z-10">
                            The UserMap builds memory from your real conversations. Sync to structure what has already been captured, or import context from your other AI tools anytime.
                        </p>
                        <div className="flex gap-4 z-10">
                            <button
                                onClick={onConsolidate}
                                disabled={isConsolidating}
                                className="px-6 py-3 bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.2em] rounded-xl transition-all shadow-lg hover:bg-black dark:hover:bg-white/90 disabled:opacity-50"
                            >
                                {isConsolidating ? 'Consolidating...' : 'Sync Memories'}
                            </button>
                            <button
                                onClick={onImportContext}
                                className="px-6 py-3 bg-black/5 dark:bg-white/5 text-gray-900 dark:text-white text-[11px] font-black uppercase tracking-[0.2em] rounded-xl transition-all hover:bg-black/10 dark:hover:bg-white/10"
                            >
                                Import Context
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="border-b border-black/5 dark:border-white/5 px-6 py-4 space-y-4 bg-white/60 dark:bg-white/[0.02]">
                        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
                            <div>
                                <div className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500 dark:text-white/35 mb-2">View</div>
                                <div className="flex flex-wrap gap-2">
                                    {(['tree', 'storyboard'] as ViewMode[]).map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => setViewMode(mode)}
                                            className={`rounded-full px-4 py-2 text-[9px] font-black uppercase tracking-[0.18em] border transition-all ${viewMode === mode ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-transparent' : 'bg-white dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-600 dark:text-white/55 hover:border-black/20 dark:hover:border-white/20'}`}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="xl:max-w-[60%]">
                                <div className="text-[9px] font-black uppercase tracking-[0.24em] text-gray-500 dark:text-white/35 mb-2">Context Mode</div>
                                <div className="flex flex-wrap gap-2">
                                    {CONTEXT_MODES.map((mode) => (
                                        <button
                                            key={mode.id}
                                            onClick={() => setContextMode(mode.id)}
                                            className={`rounded-full px-4 py-2 text-[9px] font-black uppercase tracking-[0.16em] border transition-all ${contextMode === mode.id ? 'bg-emerald-600 text-white border-transparent dark:bg-emerald-400 dark:text-black' : 'bg-white dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-600 dark:text-white/55 hover:border-black/20 dark:hover:border-white/20'}`}
                                            title={mode.description}
                                        >
                                            {mode.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <p className="text-[11px] leading-6 text-gray-500 dark:text-white/45 max-w-3xl">
                            {CONTEXT_MODES.find((item) => item.id === contextMode)?.description}
                        </p>
                    </div>

                    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_22rem]">
                        <div className="min-h-0 overflow-auto custom-scrollbar p-6">
                            {isEmpty ? (
                                <div className="h-full flex items-center justify-center text-center rounded-[28px] border border-dashed border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/[0.02] px-8">
                                    <div>
                                        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-gray-800 dark:text-white/75">No Nodes In This Mode</h3>
                                        <p className="mt-3 text-sm text-gray-500 dark:text-white/45 max-w-md">
                                            This filter is working correctly, but it does not currently match any nodes in your UserMap.
                                        </p>
                                    </div>
                                </div>
                            ) : viewMode === 'tree' ? (
                                <TreeNode node={filteredTree} depth={0} onUpdate={onUpdateNode} onDelete={onDeleteNode} onAdd={onAddNode} />
                            ) : (
                                <div className="space-y-8 min-w-max pb-4">
                                    <div className="flex justify-center">
                                        <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-[0.24em] text-emerald-700 dark:text-emerald-300">
                                            UserMap Storyboard
                                        </div>
                                    </div>
                                    <div className="flex gap-5 items-start min-w-max">
                                        {[...filteredTree.children].sort(compareNodes).map((category) => (
                                            <StoryboardLane key={category.id} category={category} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <aside className="min-h-0 overflow-auto custom-scrollbar border-t xl:border-t-0 xl:border-l border-black/5 dark:border-white/5 bg-white/70 dark:bg-white/[0.02] p-6 space-y-5">
                            <div className="space-y-2">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-900 dark:text-white">Context Export</h3>
                                <p className="text-[11px] leading-6 text-gray-500 dark:text-white/45">
                                    Export the currently selected UserMap slice as a reusable prompt or JSON package.
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                {(['prompt', 'json'] as ExportFormat[]).map((format) => (
                                    <button
                                        key={format}
                                        onClick={() => setExportFormat(format)}
                                        className={`rounded-2xl px-4 py-3 text-[9px] font-black uppercase tracking-[0.18em] border transition-all ${exportFormat === format ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-transparent' : 'bg-white dark:bg-white/[0.04] border-black/10 dark:border-white/10 text-gray-600 dark:text-white/55 hover:border-black/20 dark:hover:border-white/20'}`}
                                    >
                                        {format}
                                    </button>
                                ))}
                            </div>

                            <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-4 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/35">Preview</div>
                                        <div className="text-[10px] text-gray-500 dark:text-white/45">{exportEntries.length} exported nodes</div>
                                    </div>
                                    <button
                                        onClick={handleCopyExport}
                                        className="rounded-full bg-gray-900 dark:bg-white px-4 py-2 text-[9px] font-black uppercase tracking-[0.16em] text-white dark:text-black hover:bg-black dark:hover:bg-white/90 transition-colors"
                                    >
                                        {copyState === 'copied' ? 'Copied' : `Copy ${exportFormat}`}
                                    </button>
                                </div>
                                <pre className="max-h-[28rem] overflow-auto custom-scrollbar rounded-2xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/30 p-4 text-[11px] leading-6 text-gray-700 dark:text-white/70 whitespace-pre-wrap break-words">
                                    {exportPreview}
                                </pre>
                            </div>

                            <div className="rounded-3xl border border-black/10 dark:border-white/10 bg-[#F8F9FA] dark:bg-[#101214] p-4 space-y-3">
                                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/35">Mode Guidance</div>
                                <ul className="space-y-2 text-[11px] leading-6 text-gray-600 dark:text-white/50">
                                    <li><span className="font-bold text-gray-900 dark:text-white">High Signal</span> is best for fast context injection.</li>
                                    <li><span className="font-bold text-gray-900 dark:text-white">AI Collaboration</span> is best for prompt/system behavior.</li>
                                    <li><span className="font-bold text-gray-900 dark:text-white">Execution</span> is best for project or business workflows.</li>
                                    <li><span className="font-bold text-gray-900 dark:text-white">Technical</span> is best for coding and architecture work.</li>
                                </ul>
                            </div>
                        </aside>
                    </div>
                </>
            )}
        </div>
    );
};
