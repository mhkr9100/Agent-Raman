
import React, { useState, useRef, useEffect } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { Agent } from '../types';
import { AI_RESUMES } from '../constants';

export type PrismMode = 'create' | 'ask' | 'council';

export interface CouncilConfig {
  councilModelIds: string[];
  decisionModelId: string;
}

interface ParsedAttachment {
  id: string;
  name: string;
  size: number;
  text: string;
}

interface InputBarProps {
  onSubmit: (
    prompt: string,
    steps: number,
    file?: undefined,
    searchEnabled?: boolean,
    createEnabled?: boolean,
    prismMode?: PrismMode,
    specialAgentContext?: any,
    councilConfig?: CouncilConfig
  ) => void;
  isLoading: boolean;
  mentionCandidates?: Agent[];
  isGroup?: boolean;
  isPrism?: boolean;
}

export const InputBar: React.FC<InputBarProps> = ({
  onSubmit,
  isLoading,
  mentionCandidates = [],
  isGroup = false,
  isPrism = false
}) => {
  const [prompt, setPrompt] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [prismMode, setPrismMode] = useState<PrismMode>('ask');
  const [councilModels, setCouncilModels] = useState<string[]>([
    'gemini-2.5-pro',
    'gpt-4o',
    'anthropic.claude-3-5-sonnet-20240620-v1:0'
  ]);
  const [decisionModelId, setDecisionModelId] = useState<string>('gemini-2.5-pro');
  const [attachments, setAttachments] = useState<ParsedAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
  const MAX_ATTACHMENTS = 3;

  const filteredCandidates = (mentionCandidates || []).filter(c =>
    c && c.name && typeof c.name === 'string' &&
    c.name.toLowerCase().includes((mentionFilter || '').toLowerCase()) &&
    c.id !== 'prism-core' && c.id !== 'prism-core-member'
  );

  const normalizeCouncilModels = () => {
    const unique = Array.from(new Set(councilModels.filter(Boolean)));
    const fallback = AI_RESUMES.map(m => m.modelId);
    const normalized = [...unique];

    for (const modelId of fallback) {
      if (normalized.length >= 3) break;
      if (!normalized.includes(modelId)) normalized.push(modelId);
    }

    return normalized.slice(0, 3);
  };

  const buildPromptWithAttachments = (basePrompt: string) => {
    if (attachments.length === 0) return basePrompt;
    const sections = attachments.map((file, idx) =>
      `[Document ${idx + 1}: ${file.name}]\n${file.text.slice(0, 6000)}`
    );

    return `${basePrompt}

[ATTACHED DOCUMENT CONTEXT]
Use this user-provided context as high-priority reference while responding.
${sections.join('\n\n')}
[/ATTACHED DOCUMENT CONTEXT]`;
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() && attachments.length === 0) return;

    const basePrompt = prompt.trim() || 'Analyze the uploaded document context and assist me.';
    const finalPrompt = buildPromptWithAttachments(basePrompt);

    const councilConfig = (isPrism && prismMode === 'council')
      ? {
        councilModelIds: normalizeCouncilModels(),
        decisionModelId: decisionModelId || 'gemini-2.5-pro'
      }
      : undefined;

    onSubmit(
      finalPrompt,
      1,
      undefined,
      false,
      prismMode === 'create',
      isPrism ? prismMode : undefined,
      undefined,
      councilConfig
    );

    setPrompt('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setShowMentions(false);
    setAttachmentError(null);
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  }, [prompt]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setPrompt(newVal);
    const cursor = e.target.selectionStart;
    const textUpToCursor = newVal.slice(0, cursor || 0);
    const lastAt = textUpToCursor.lastIndexOf('@');
    if (lastAt !== -1) {
      const query = textUpToCursor.slice(lastAt + 1);
      if (!query.includes('\n') && !query.includes(' ')) {
        setMentionFilter(query);
        setShowMentions(true);
      } else setShowMentions(false);
    } else setShowMentions(false);
  };

  const selectMention = (agent: Agent) => {
    const lastAt = prompt.lastIndexOf('@');
    const prefix = prompt.substring(0, lastAt);
    const newPrompt = `${prefix}@${agent.name} `;
    setPrompt(newPrompt);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const parseAttachment = async (file: File): Promise<ParsedAttachment | null> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const textOnlyExtensions = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yaml', 'yml'];

    if (!textOnlyExtensions.includes(ext)) {
      throw new Error(`"${file.name}" is not supported yet. Use TXT/MD/CSV/JSON/YAML files.`);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`"${file.name}" is larger than 2MB. Please upload a smaller file.`);
    }

    const text = await file.text();
    if (!text.trim()) {
      throw new Error(`"${file.name}" is empty.`);
    }

    return {
      id: `${file.name}-${file.size}-${Date.now()}`,
      name: file.name,
      size: file.size,
      text
    };
  };

  const handleAttachmentPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setAttachmentError(null);

    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const filesToProcess = files.slice(0, remainingSlots);

    if (files.length > remainingSlots) {
      setAttachmentError(`Only ${MAX_ATTACHMENTS} files are allowed per message.`);
    }

    const parsed: ParsedAttachment[] = [];
    for (const file of filesToProcess) {
      try {
        const result = await parseAttachment(file);
        if (result) parsed.push(result);
      } catch (err: any) {
        setAttachmentError(err.message || 'Failed to parse selected file.');
      }
    }

    if (parsed.length > 0) {
      setAttachments(prev => [...prev, ...parsed].slice(0, MAX_ATTACHMENTS));
    }

    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(file => file.id !== id));
  };

  const PRISM_MODES: { key: PrismMode; label: string; icon: string; color: string; activeColor: string }[] = [
    { key: 'ask', label: 'Ask Prism', icon: '💎', color: 'hover:border-indigo-500/30 hover:text-white', activeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.3)]' },
    { key: 'create', label: 'Create Agents', icon: '⚡', color: 'hover:border-emerald-500/30 hover:text-white', activeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.3)]' },
    { key: 'council', label: 'Council', icon: '🏛️', color: 'hover:border-amber-500/30 hover:text-white', activeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]' },
  ];

  return (
    <div className="w-full pb-6 pt-4 px-4 bg-gradient-to-t from-white via-white/95 dark:from-[#1A1A1A] dark:via-[#1A1A1A]/95 to-transparent relative z-20">
      <div className="mx-auto max-w-3xl relative">

        {/* Prism Mode Buttons */}
        {isPrism && (
          <div className="absolute -top-12 left-0 flex items-center gap-2 z-30">
            {PRISM_MODES.map(mode => (
              <button
                key={mode.key}
                onClick={() => setPrismMode(mode.key)}
                className={`px-3 py-1.5 border rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 ${prismMode === mode.key ? mode.activeColor : `bg-white dark:bg-[#0a0a0a] text-gray-500 dark:text-white/30 border-black/10 dark:border-white/10 ${mode.color}`}`}
              >
                <span className="text-xs">{mode.icon}</span>
                {mode.label}
              </button>
            ))}
          </div>
        )}

        {isPrism && prismMode === 'council' && (
          <div className="mb-2 p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-[9px] font-black uppercase tracking-[0.15em] text-amber-500 mb-2">
              Council Setup: Pick 3 Advisors + 1 Decision Model
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[0, 1, 2].map((idx) => (
                <select
                  key={idx}
                  value={councilModels[idx] || ''}
                  onChange={(e) => {
                    setCouncilModels(prev => {
                      const next = [...prev];
                      next[idx] = e.target.value;
                      return next;
                    });
                  }}
                  className="bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-gray-700 dark:text-white/70 outline-none"
                >
                  {AI_RESUMES.map(model => (
                    <option key={model.modelId} value={model.modelId}>
                      {`Advisor ${idx + 1}: ${model.name}`}
                    </option>
                  ))}
                </select>
              ))}
              <select
                value={decisionModelId}
                onChange={(e) => setDecisionModelId(e.target.value)}
                className="bg-white dark:bg-black/20 border border-black/10 dark:border-white/10 rounded-lg px-2 py-1.5 text-[10px] text-gray-700 dark:text-white/70 outline-none"
              >
                {AI_RESUMES.map(model => (
                  <option key={model.modelId} value={model.modelId}>
                    {`Decision: ${model.name}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map(file => (
              <span
                key={file.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/10 text-[9px] font-mono text-gray-600 dark:text-white/60"
              >
                <span className="truncate max-w-[160px]">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(file.id)}
                  className="text-gray-500 hover:text-gray-900 dark:text-white/40 dark:hover:text-white"
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {attachmentError && (
          <p className="mb-2 text-[10px] text-amber-600 dark:text-amber-400">{attachmentError}</p>
        )}

        {/* Mention Autocomplete */}
        {showMentions && filteredCandidates.length > 0 && (
          <div className="absolute bottom-full left-0 mb-4 w-64 bg-white dark:bg-[#0a0a0a] border border-black/10 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-3xl animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="p-2 text-[8px] text-gray-500 dark:text-white/40 border-b border-black/5 dark:border-white/5 font-black uppercase tracking-[0.3em] bg-black/[0.02] dark:bg-white/[0.02]">Identify Agent</div>
            <ul className="max-h-48 overflow-y-auto custom-scrollbar">
              {filteredCandidates.map((agent) => (
                <li key={agent.id} onClick={() => selectMention(agent)} className="flex items-center gap-3 p-3 cursor-pointer transition-all hover:bg-black/5 dark:hover:bg-white/10">
                  <span className="text-base">{agent.icon}</span>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs truncate uppercase font-bold text-gray-900 dark:text-white">{agent.name}</span>
                    <span className="text-[8px] uppercase font-mono truncate tracking-wider text-gray-500 dark:text-white/40">{agent.role}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Input Area */}
        <div className="flex items-center gap-3">
          <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2 bg-white dark:bg-white/[0.04] p-2 rounded-2xl shadow-lg border border-black/10 dark:border-white/5 focus-within:border-black/20 dark:focus-within:border-white/20 transition-all duration-300 backdrop-blur-xl">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".txt,.md,.markdown,.csv,.json,.log,.xml,.yaml,.yml"
              onChange={handleAttachmentPick}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Upload context files (TXT/MD/CSV/JSON/YAML)"
              aria-label="Upload context files"
              className="p-2.5 rounded-xl border border-black/10 dark:border-white/10 text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white hover:border-black/20 dark:hover:border-white/20 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V3m0 0 4.5 4.5M12 3 7.5 7.5M3 15.75v.75A2.25 2.25 0 0 0 5.25 18.75h13.5A2.25 2.25 0 0 0 21 16.5v-.75" />
              </svg>
            </button>
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={isPrism ? (prismMode === 'create' ? 'Describe the agent you need...' : 'Ask anything...') : 'Refract intelligence...'}
              aria-label={isPrism ? (prismMode === 'create' ? 'Agent creation prompt' : 'Prism prompt') : 'Chat prompt'}
              className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-white/20 focus:outline-none max-h-[100px] overflow-y-auto py-2.5 px-3 custom-scrollbar leading-relaxed"
              rows={1}
            />

            <button
              type="submit"
              disabled={!prompt.trim() && attachments.length === 0}
              aria-label={isLoading ? 'Sending message' : 'Send message'}
              title={isLoading ? 'Sending message...' : 'Send message (Enter)'}
              className={`p-2.5 rounded-xl transition-all duration-300 self-end ${(prompt.trim() || attachments.length > 0) ? 'bg-gray-900 text-white dark:bg-white dark:text-black shadow-md hover:bg-gray-800 dark:hover:bg-white/90' : 'bg-black/5 text-gray-400 dark:bg-transparent dark:text-white/5 cursor-not-allowed'}`}
            >
              {isLoading ? <LoadingSpinner width={20} height={10} /> : <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg>}
            </button>
          </form>
        </div>
        <p className="mt-2 px-1 text-[9px] text-gray-500 dark:text-white/30">
          Upload context files: TXT, MD, CSV, JSON, YAML (max 3 files, 2MB each).
        </p>
      </div>
    </div >
  );
};
