import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PageNode {
    id: string;
    label: string;
    value?: string;
    source?: string;
    children: PageNode[];
}

interface UserMapViewProps {
    tree: PageNode;
    isConsolidating: boolean;
    onUpdateNode: (nodeId: string, updates: Partial<PageNode>) => void;
    onDeleteNode: (nodeId: string) => void;
    onAddNode: (parentId: string, newNode: PageNode) => void;
    onConsolidate: () => void;
    onImportContext: () => void;
}

// Recursive tree node component
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
            children: []
        };
        onAdd(node.id, newNode);
        setNewChildLabel('');
        setIsAddingChild(false);
        setIsExpanded(true);
    };

    return (
        <div className={`${depth > 0 ? 'border-l border-black/10 dark:border-white/5' : ''}`} style={{ marginLeft: depth > 0 ? 12 : 0 }}>
            <div className={`group flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-all ${isRoot ? 'mb-2' : ''}`}>
                {/* Expand/Collapse */}
                {node.children.length > 0 && (
                    <button onClick={() => setIsExpanded(!isExpanded)} className="text-gray-400 dark:text-white/20 hover:text-gray-900 dark:hover:text-white/60 transition-colors w-4 h-4 flex items-center justify-center flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                    </button>
                )}
                {node.children.length === 0 && <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-white/20" />
                </div>}

                {/* Node Content */}
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
                    <div className="flex-1 min-w-0">
                        <span
                            className={`text-xs font-semibold cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors ${isRoot ? 'text-gray-900 dark:text-white/90 text-sm font-black uppercase tracking-widest' : isLeaf ? 'text-gray-500 dark:text-white/60' : 'text-gray-700 dark:text-white/80'}`}
                            onClick={() => !isRoot && setIsEditing(true)}
                        >
                            {node.label}
                        </span>
                        {node.value && (
                            <span className="ml-2 text-[10px] text-gray-400 dark:text-white/30">{node.value}</span>
                        )}
                    </div>
                )}

                {/* Actions (visible on hover) */}
                {!isRoot && !isEditing && (
                    <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
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
            </div>

            {/* Add Child Input */}
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

            {/* Children */}
            <AnimatePresence>
                {isExpanded && node.children.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        {node.children.map(child => (
                            <TreeNode key={child.id} node={child} depth={depth + 1} onUpdate={onUpdate} onDelete={onDelete} onAdd={onAdd} />
                        ))}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export const UserMapView: React.FC<UserMapViewProps> = ({
    tree, isConsolidating, onUpdateNode, onDeleteNode, onAddNode, onConsolidate, onImportContext
}) => {
    const isEmpty = tree.children.length === 0;

    return (
        <div className="flex-1 flex flex-col bg-[#F8F9FA] dark:bg-[#1A1A1A] overflow-hidden">
            {/* Header */}
            <header className="h-16 border-b border-black/5 dark:border-white/5 flex items-center justify-between pl-16 md:pl-6 pr-6 flex-shrink-0 relative z-20">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 flex items-center justify-center border border-black/10 dark:border-white/10">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-gray-600 dark:text-white/60">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6c0-3.313-2.687-6-6-6s-6 2.687-6 6a6 6 0 0 0 6 6Z" />
                        </svg>
                    </div>
                    <div>
                        <h2 className="text-[10px] font-black text-gray-800 dark:text-white/80 uppercase tracking-[0.2em]">Context Brain</h2>
                        <p className="text-[8px] text-gray-500 dark:text-white/30 uppercase tracking-wider">Neural Map</p>
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

            {/* Tree Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {isEmpty ? (
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
                ) : (
                    <TreeNode node={tree} depth={0} onUpdate={onUpdateNode} onDelete={onDeleteNode} onAdd={onAddNode} />
                )}
            </div>
        </div>
    );
};
