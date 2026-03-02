import React, { useState, useEffect, useMemo } from 'react';
import { getToolCatalog, ToolEntry } from '../services/toolService';

// Category icons map
const CATEGORY_ICONS: Record<string, string> = {
    'Finance': '💹',
    'Search': '🔍',
    'Research': '📚',
    'Development': '⚙️',
    'Utility': '🛠️',
    'Creative': '🎨',
    'Data & Analytics': '📊',
    'Communication': '💬',
    'AI & ML': '🧠',
    'Infrastructure': '🏗️',
};

const ToolCard: React.FC<{ tool: ToolEntry }> = ({ tool }) => {
    return (
        <div className="group bg-white dark:bg-black/40 border border-black/5 dark:border-white/5 rounded-2xl p-4 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300 flex items-center gap-4 shadow-sm dark:shadow-none">
            <div className="w-10 h-10 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform">
                {CATEGORY_ICONS[tool.category] || '🔧'}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                    <h4 className="text-[13px] font-black text-gray-900 dark:text-white uppercase tracking-tight truncate">{tool.name}</h4>
                    <span className="text-[8px] font-mono text-gray-400 dark:text-white/10 uppercase">{tool.authType === 'none' ? 'Free' : 'Auth Required'}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[9px] text-gray-500 dark:text-white/40 font-mono uppercase tracking-widest">{tool.provider}</span>
                    <span className="text-gray-300 dark:text-white/10 text-[8px]">•</span>
                    <span className="text-[9px] text-gray-400 dark:text-white/20 uppercase font-black truncate">{tool.category}</span>
                </div>
            </div>
        </div>
    );
};

export const ToolsView: React.FC = () => {
    const [tools, setTools] = useState<ToolEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const catalog = await getToolCatalog();
                setTools(catalog);
            } catch (e) {
                console.error('[ToolsView] Failed to load catalog', e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const categories = useMemo(() => {
        const cats = [...new Set(tools.map(t => t.category))];
        return cats.sort();
    }, [tools]);

    const filteredTools = useMemo(() => {
        let result = tools;
        if (selectedCategory) {
            result = result.filter(t => t.category === selectedCategory);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(t =>
                t.name.toLowerCase().includes(q) ||
                t.description.toLowerCase().includes(q) ||
                t.provider.toLowerCase().includes(q) ||
                t.category.toLowerCase().includes(q)
            );
        }
        return result;
    }, [tools, searchQuery, selectedCategory]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <div className="text-gray-500 dark:text-white/30 text-xs font-black uppercase tracking-[0.3em] animate-pulse">Scanning Ecosystem...</div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto p-8">
            {/* Header */}
            <div className="mb-6 flex items-center gap-4">
                <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Hardware & Forge</h3>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                <span className="text-[9px] text-gray-400 dark:text-white/20 font-mono tracking-widest">{tools.length} EXTENSIONS SYNCED</span>
            </div>

            {/* Search + Filter */}
            <div className="flex flex-col sm:flex-row gap-4 mb-8">
                <div className="flex-1 relative group">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search extensions..."
                        className="w-full bg-black/5 dark:bg-black/40 border border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 focus:border-black/30 dark:focus:border-white/30 rounded-xl pl-4 pr-4 py-3 text-xs text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/10 outline-none transition-all"
                    />
                </div>
                <div className="flex gap-2 items-center overflow-x-auto pb-2 sm:pb-0 custom-scrollbar whitespace-nowrap">
                    <button
                        onClick={() => setSelectedCategory(null)}
                        className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${!selectedCategory ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-gray-900 dark:border-white' : 'bg-black/5 dark:bg-black/40 border-black/5 dark:border-white/5 text-gray-500 dark:text-white/30 hover:text-gray-900 dark:hover:text-white hover:border-black/20 dark:hover:border-white/20'}`}
                    >
                        ALL
                    </button>
                    {categories.map(cat => (
                        <button
                            key={cat}
                            onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                            className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border ${selectedCategory === cat ? 'bg-gray-900 dark:bg-white text-white dark:text-black border-gray-900 dark:border-white' : 'bg-black/5 dark:bg-black/40 border-black/5 dark:border-white/5 text-gray-500 dark:text-white/30 hover:text-gray-900 dark:hover:text-white hover:border-black/20 dark:hover:border-white/20'}`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tools Grid */}
            {filteredTools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 bg-black/[0.02] dark:bg-white/[0.01] border border-dashed border-black/10 dark:border-white/5 rounded-3xl">
                    <h4 className="text-gray-500 dark:text-white/40 font-black uppercase tracking-[0.3em] text-[10px]">Zero Matches</h4>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {filteredTools.map(tool => (
                        <ToolCard key={tool.id} tool={tool} />
                    ))}
                </div>
            )}

            <div className="mt-8 mb-16 text-center" />
        </div>
    );
};
