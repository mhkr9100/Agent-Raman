import React, { useMemo, useState } from 'react';

interface MemoryImportModalProps {
    isOpen: boolean;
    isImporting: boolean;
    onSkip: () => void;
    onImport: (rawText: string) => Promise<void>;
}

const SAMPLE_IMPORT_PROMPT = `Import memory/context to Prism.

Export all stored memories and context you have learned about me from prior conversations. Preserve my wording where possible, especially for instructions and preferences.

Return categories in this order:
1. Instructions (explicit rules I asked you to follow)
2. Identity (name, location, background, personal context)
3. Career (roles, skills, domains)
4. Projects (one entry per meaningful project with current status)
5. Preferences (style, workflow, communication, decision preferences)

Formatting requirements:
- Use section headers for each category
- One entry per line
- Sort by oldest date first
- Format each line as: [YYYY-MM-DD] - Entry content
- If date unknown, use [unknown]

Output requirements:
- Wrap everything in one code block
- After the code block, state whether this is complete or partial`;

export const MemoryImportModal: React.FC<MemoryImportModalProps> = ({
    isOpen,
    isImporting,
    onSkip,
    onImport
}) => {
    const [mode, setMode] = useState<'choice' | 'import'>('choice');
    const [pasted, setPasted] = useState('');
    const [copied, setCopied] = useState(false);

    const canImport = useMemo(() => pasted.trim().length > 0, [pasted]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-3xl bg-white dark:bg-[#1A1A1A] border border-black/10 dark:border-white/10 rounded-3xl shadow-2xl overflow-hidden">
                <div className="px-8 py-6 border-b border-black/5 dark:border-white/10">
                    <h2 className="text-lg font-black tracking-tight text-gray-900 dark:text-white">
                        Bring Context From Your Other AI Tools
                    </h2>
                    <p className="mt-1 text-[12px] text-gray-600 dark:text-white/60">
                        Import your existing memory so Prism and your agents can respond with better continuity from day one.
                    </p>
                </div>

                {mode === 'choice' ? (
                    <div className="p-8 flex flex-col md:flex-row gap-3">
                        <button
                            onClick={() => setMode('import')}
                            className="flex-1 h-11 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-[11px] font-black uppercase tracking-[0.12em]"
                        >
                            Yes, Import Context
                        </button>
                        <button
                            onClick={onSkip}
                            className="flex-1 h-11 rounded-xl border border-black/10 dark:border-white/10 text-[11px] font-black uppercase tracking-[0.12em] text-gray-600 dark:text-white/60"
                        >
                            Skip
                        </button>
                    </div>
                ) : (
                    <div className="p-8 space-y-4">
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500 dark:text-white/40">
                                Step 1: Copy Prompt, Run It In Your Other AI, Then Paste Results
                            </p>
                            <button
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(SAMPLE_IMPORT_PROMPT);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 1500);
                                    } catch { }
                                }}
                                className="px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-[0.12em] text-gray-600 dark:text-white/60"
                            >
                                {copied ? 'Copied' : 'Copy Prompt'}
                            </button>
                        </div>

                        <textarea
                            value={SAMPLE_IMPORT_PROMPT}
                            readOnly
                            rows={12}
                            className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-gray-50 dark:bg-black/20 text-[11px] font-mono text-gray-700 dark:text-white/70 p-3 outline-none"
                        />

                        <p className="text-[11px] font-black uppercase tracking-[0.12em] text-gray-500 dark:text-white/40">
                            Step 2: Paste Exported Memory Below
                        </p>
                        <textarea
                            value={pasted}
                            onChange={(e) => setPasted(e.target.value)}
                            rows={8}
                            placeholder="Paste the exported memory/context output here..."
                            className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-black/20 text-[12px] text-gray-800 dark:text-white/80 p-3 outline-none focus:border-black/20 dark:focus:border-white/20"
                        />

                        <div className="flex flex-col md:flex-row gap-3 pt-2">
                            <button
                                onClick={() => setMode('choice')}
                                className="md:w-auto w-full px-4 h-10 rounded-xl border border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-[0.12em] text-gray-600 dark:text-white/60"
                            >
                                Back
                            </button>
                            <button
                                onClick={onSkip}
                                className="md:w-auto w-full px-4 h-10 rounded-xl border border-black/10 dark:border-white/10 text-[10px] font-black uppercase tracking-[0.12em] text-gray-600 dark:text-white/60"
                            >
                                Skip
                            </button>
                            <button
                                onClick={() => onImport(pasted)}
                                disabled={!canImport || isImporting}
                                className="md:ml-auto w-full md:w-auto px-5 h-10 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-[0.12em] disabled:opacity-50"
                            >
                                {isImporting ? 'Importing...' : 'Add To Memory'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
