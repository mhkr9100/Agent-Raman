
import React, { useState, useRef, useEffect } from 'react';
import { GlobalTask } from '../../types';
import { EllipsisVerticalIcon } from '../icons/EllipsisVerticalIcon';

interface TaskItemProps {
    task: GlobalTask;
    onUpdateStatus: (id: string, status: GlobalTask['status']) => void;
    onEdit: (task: GlobalTask) => void;
    onView: (task: GlobalTask) => void;
    onSendToChat: (id: string) => void;
}

export const TaskItem: React.FC<TaskItemProps> = ({
    task,
    onUpdateStatus,
    onEdit,
    onView,
    onSendToChat
}) => {
    const [showMenu, setShowMenu] = useState(false);
    const [showOutput, setShowOutput] = useState(true); // Default to true so users see result immediately
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const statusColors = {
        scheduled: 'bg-slate-900 border-white/10 text-slate-400',
        processing: 'bg-white/5 border-white/20 text-slate-300 animate-pulse',
        done: 'bg-green-900/20 border-green-500/30 text-green-400',
        'not-done': 'bg-red-900/20 border-red-500/30 text-red-400'
    };

    const isLiveTask = task.status === 'done';

    return (
        <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 space-y-3 relative group/item hover:bg-white/[0.04] transition-colors">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-widest ${statusColors[task.status]}`}>
                        {task.status === 'not-done' ? 'Fault' : task.status}
                    </span>
                    <span className="text-[9px] text-slate-600 font-mono">
                        {new Date(task.scheduledTime || task.createdAt).toLocaleString()}
                    </span>
                </div>

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-1 hover:bg-white/10 rounded transition text-slate-500 hover:text-white"
                    >
                        <EllipsisVerticalIcon />
                    </button>

                    {showMenu && (
                        <div className="absolute right-0 top-full mt-1 w-40 bg-[#0f0f0f] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
                            <button
                                onClick={() => { onView(task); setShowMenu(false); }}
                                className="w-full text-left px-4 py-2.5 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white transition font-bold uppercase tracking-wider flex items-center gap-2"
                            >
                                <span>👁</span> View Directive
                            </button>
                            {!isLiveTask && (
                                <button
                                    onClick={() => { onEdit(task); setShowMenu(false); }}
                                    className="w-full text-left px-4 py-2.5 text-[10px] text-slate-300 hover:bg-white/10 hover:text-white transition font-bold uppercase tracking-wider border-t border-white/5 flex items-center gap-2"
                                >
                                    <span>✎</span> Update Task
                                </button>
                            )}
                            {task.status === 'scheduled' && (
                                <button
                                    onClick={() => { onUpdateStatus(task.id, 'not-done'); setShowMenu(false); }}
                                    className="w-full text-left px-4 py-2.5 text-[10px] text-red-400 hover:bg-red-900/40 transition font-bold uppercase tracking-wider border-t border-white/5 flex items-center gap-2"
                                >
                                    <span>✕</span> Cancel Task
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <h5 className="text-xs font-bold text-slate-200 line-clamp-2 leading-relaxed">{task.label}</h5>

            {task.status === 'processing' && (
                <div className="flex items-center gap-2 py-2">
                    <div className="w-3 h-3 border-2 border-white/40 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-[10px] text-slate-300 font-mono animate-pulse uppercase tracking-tighter">Synthesizing Directive...</span>
                </div>
            )}

            {task.output && (
                <div className="mt-2 p-1.5 bg-transparent rounded-lg border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Synthesis Output</span>
                        <button
                            onClick={() => setShowOutput(!showOutput)}
                            className="text-[9px] text-slate-500 hover:text-white underline font-bold"
                        >
                            {showOutput ? 'Collapse' : 'Expand Result'}
                        </button>
                    </div>

                    {showOutput && (
                        <div className="p-2 text-[10px] text-slate-400 font-mono leading-relaxed max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap italic border-l-2 border-white/20 pl-3">
                            {task.output}
                        </div>
                    )}
                </div>
            )}

            {!task.output && task.isRecurring && task.status !== 'processing' && (
                <div className="flex items-center gap-2 pt-1">
                    <span className="text-[9px] text-slate-600 uppercase font-bold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse"></span>
                        Recurring Automation
                    </span>
                </div>
            )}
        </div>
    );
};
