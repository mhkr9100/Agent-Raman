import React, { useEffect, useState } from 'react';
import { listModels, ModelRegistryItem } from '../services/apiV2';

export const ModelsView: React.FC = () => {
    const [models, setModels] = useState<ModelRegistryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        (async () => {
            setIsLoading(true);
            setError(null);
            try {
                const response = await listModels();
                if (!mounted) return;
                setModels(Array.isArray(response.models) ? response.models : []);
            } catch (err: any) {
                if (!mounted) return;
                setModels([]);
                setError(err?.message || 'Failed to load model registry.');
            } finally {
                if (mounted) setIsLoading(false);
            }
        })();
        return () => {
            mounted = false;
        };
    }, []);

    return (
        <div className="max-w-6xl mx-auto p-8">
            <div className="mb-8 flex items-center gap-4">
                <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Neural Fabric</h3>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                <span className="text-[9px] text-gray-400 dark:text-white/20 font-mono tracking-widest">{models.length} MODELS ONLINE</span>
            </div>

            {isLoading && (
                <div className="p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                    Loading Model Registry...
                </div>
            )}

            {!isLoading && error && (
                <div className="p-6 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-center text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-[0.15em]">
                    {error}
                </div>
            )}

            {!isLoading && !error && models.length === 0 && (
                <div className="p-6 rounded-2xl border border-dashed border-black/10 dark:border-white/10 text-center text-[10px] text-gray-500 dark:text-white/40 uppercase tracking-[0.15em]">
                    No Models Found
                </div>
            )}

            {!isLoading && !error && models.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {models.map(model => (
                    <div key={model.modelId} className="group bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl p-4 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 flex items-center gap-4 shadow-sm dark:shadow-none">
                        <div className="w-12 h-12 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-2xl group-hover:scale-105 transition-transform">
                            {model.icon || '🧠'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                                <h4 className="text-[13px] font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">{model.name || model.modelId}</h4>
                                <span className="text-[8px] font-mono text-gray-400 dark:text-white/10 uppercase">{model.version || 'n/a'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[9px] text-gray-500 dark:text-white/40 font-mono uppercase tracking-widest">{model.provider || 'unknown'}</span>
                                <span className="text-gray-300 dark:text-white/10 text-[8px]">•</span>
                                <span className="text-[9px] text-gray-400 dark:text-white/20 uppercase font-black truncate">{model.tagline || model.modelId}</span>
                            </div>
                        </div>
                    </div>
                    ))}
                </div>
            )}
            <div className="mt-8 text-center" />
        </div>
    );
};
