import React, { useEffect, useState } from 'react';
import { listTools, ToolRegistryItem } from '../services/apiV2';

export const ToolsView: React.FC = () => {
    const [tools, setTools] = useState<ToolRegistryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await listTools();
                if (!mounted) return;
                setTools(Array.isArray(response.tools) ? response.tools : []);
            } catch (err: any) {
                if (!mounted) return;
                setTools([]);
                setError(err?.message || 'Failed to load capabilities registry.');
            } finally {
                if (mounted) setIsLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <div className="max-w-5xl mx-auto p-8">
            <div className="mb-8 flex items-center gap-4">
                <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Capabilities</h3>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                <span className="text-[9px] text-gray-400 dark:text-white/20 font-mono tracking-widest">{tools.length} ACTIVE</span>
            </div>

            {isLoading && (
                <div className="p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                    Loading Capabilities...
                </div>
            )}

            {!isLoading && error && (
                <div className="p-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-center text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-[0.15em]">
                    {error}
                </div>
            )}

            {!isLoading && !error && tools.length === 0 && (
                <div className="p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                    No Capabilities Found
                </div>
            )}

            {!isLoading && !error && tools.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {tools.map(cap => (
                    <div
                        key={cap.toolId}
                        className="group bg-white dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-2xl p-5 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300"
                    >
                        <div className="w-12 h-12 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-2xl mb-4">
                            {cap.icon || '🧩'}
                        </div>
                        <h4 className="text-[13px] font-black text-gray-900 dark:text-white uppercase tracking-tight mb-1">{cap.name || cap.toolId}</h4>
                        <p className="text-[11px] text-gray-600 dark:text-white/60 leading-relaxed mb-3">
                            {cap.summary || cap.description || 'No summary provided.'}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-white/40 leading-relaxed">
                            {cap.behavior || `Category: ${cap.category || 'general'}`}
                        </p>
                    </div>
                ))}
            </div>
            )}
        </div>
    );
};
