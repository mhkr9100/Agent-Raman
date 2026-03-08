import React from 'react';

const CAPABILITIES = [
    {
        id: 'thinking',
        name: 'Thinking',
        icon: '🧠',
        summary: 'Structured reasoning for planning, decomposition, and decision support.',
        behavior: 'Best for complex multi-step tasks where quality matters more than raw speed.'
    },
    {
        id: 'googleSearch',
        name: 'Web Search',
        icon: '🔎',
        summary: 'Live web lookup for current facts, sources, and validation.',
        behavior: 'Use when timeliness matters or when responses must reference external evidence.'
    },
    {
        id: 'imageGeneration',
        name: 'Image Generation',
        icon: '🎨',
        summary: 'Prompt-to-image generation for concept visuals and content drafts.',
        behavior: 'Use for ideation, creative mockups, and rapid visual prototyping.'
    }
];

export const ToolsView: React.FC = () => {
    return (
        <div className="max-w-5xl mx-auto p-8">
            <div className="mb-8 flex items-center gap-4">
                <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.3em]">Capabilities</h3>
                <div className="h-px flex-1 bg-black/10 dark:bg-white/5" />
                <span className="text-[9px] text-gray-400 dark:text-white/20 font-mono tracking-widest">{CAPABILITIES.length} ACTIVE</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {CAPABILITIES.map(cap => (
                    <div
                        key={cap.id}
                        className="group bg-white dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-2xl p-5 hover:border-black/20 dark:hover:border-white/20 transition-all duration-300"
                    >
                        <div className="w-12 h-12 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center text-2xl mb-4">
                            {cap.icon}
                        </div>
                        <h4 className="text-[13px] font-black text-gray-900 dark:text-white uppercase tracking-tight mb-1">{cap.name}</h4>
                        <p className="text-[11px] text-gray-600 dark:text-white/60 leading-relaxed mb-3">
                            {cap.summary}
                        </p>
                        <p className="text-[10px] text-gray-500 dark:text-white/40 leading-relaxed">
                            {cap.behavior}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
};
