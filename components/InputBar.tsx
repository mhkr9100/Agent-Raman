import React, { useEffect, useRef, useState } from 'react';
import { Agent } from '../types';
import { MAX_DOCUMENT_BYTES } from '../services/documentParser';
import { validateChatAttachment } from '../services/runtimeAttachments';

export type PrismMode = 'create' | 'ask';
export type RequestedCapability = 'auto' | 'web-search' | 'thinking';

interface InputBarProps {
  onSubmit: (
    prompt: string,
    steps: number,
    attachments?: File[],
    searchEnabled?: boolean,
    createEnabled?: boolean,
    prismMode?: PrismMode,
    requestedCapability?: RequestedCapability
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
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [requestedCapability, setRequestedCapability] = useState<RequestedCapability>('auto');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE_BYTES = MAX_DOCUMENT_BYTES;
  const MAX_ATTACHMENTS = 5;

  const filteredCandidates = (mentionCandidates || []).filter(candidate =>
    candidate &&
    candidate.name &&
    typeof candidate.name === 'string' &&
    candidate.name.toLowerCase().includes((mentionFilter || '').toLowerCase()) &&
    candidate.id !== 'prism-core' &&
    candidate.id !== 'prism-core-member'
  );

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
  }, [prompt]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!prompt.trim() && attachments.length === 0) || isLoading) return;

    const finalPrompt = prompt.trim() || 'Please analyze the attached files and use them when responding.';

    onSubmit(
      finalPrompt,
      1,
      attachments,
      false,
      prismMode === 'create',
      isPrism ? prismMode : undefined,
      requestedCapability
    );

    setPrompt('');
    setAttachments([]);
    setShowMentions(false);
    setMentionFilter('');
    setAttachmentError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setPrompt(newValue);

    const cursor = e.target.selectionStart;
    const textUpToCursor = newValue.slice(0, cursor || 0);
    const lastAt = textUpToCursor.lastIndexOf('@');
    if (lastAt === -1) {
      setShowMentions(false);
      return;
    }

    const query = textUpToCursor.slice(lastAt + 1);
    if (!query.includes('\n') && !query.includes(' ')) {
      setMentionFilter(query);
      setShowMentions(true);
      return;
    }

    setShowMentions(false);
  };

  const selectMention = (agent: Agent) => {
    const lastAt = prompt.lastIndexOf('@');
    const prefix = prompt.substring(0, lastAt);
    const nextPrompt = `${prefix}@${agent.name} `;
    setPrompt(nextPrompt);
    setShowMentions(false);
    textareaRef.current?.focus();
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

    const accepted: File[] = [];
    for (const file of filesToProcess) {
      try {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new Error(`"${file.name}" exceeds ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))}MB limit.`);
        }
        validateChatAttachment(file);
        accepted.push(file);
      } catch (err: any) {
        setAttachmentError(err?.message || 'Failed to validate selected file.');
      }
    }

    if (accepted.length > 0) {
      setAttachments(prev => [...prev, ...accepted].slice(0, MAX_ATTACHMENTS));
    }

    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const prismModes: { key: PrismMode; label: string; icon: string }[] = [
    { key: 'ask', label: 'Ask Prism', icon: '△' },
    { key: 'create', label: 'Create ChatBots', icon: '⚡' }
  ];

  const capabilityOptions: { key: RequestedCapability; label: string }[] = [
    { key: 'auto', label: 'Auto' },
    { key: 'web-search', label: 'Web Search' },
    { key: 'thinking', label: 'Deep Thinking' }
  ];

  return (
    <div className="w-full border-t border-black/10 dark:border-white/10 bg-white/80 dark:bg-[#141619]/90 backdrop-blur-xl px-4 pb-6 pt-4">
      <div className="mx-auto max-w-3xl relative">
        {isPrism && (
          <div className="mb-3 flex items-center gap-2">
            {prismModes.map(mode => {
              const isActive = prismMode === mode.key;
              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setPrismMode(mode.key)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.16em] transition-all ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : 'border-black/10 bg-white text-gray-600 hover:border-black/20 hover:text-gray-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/50 dark:hover:border-white/20 dark:hover:text-white'
                  }`}
                >
                  <span className="text-xs">{mode.icon}</span>
                  {mode.label}
                </button>
              );
            })}
          </div>
        )}

        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <span
                key={`${file.name}-${file.size}-${index}`}
                className="inline-flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-2.5 py-1 text-[10px] font-mono text-gray-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/65"
              >
                <span className="max-w-[180px] truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(index)}
                  className="text-gray-400 hover:text-gray-900 dark:text-white/40 dark:hover:text-white"
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

        {showMentions && filteredCandidates.length > 0 && (
          <div className="absolute bottom-full left-0 mb-4 w-72 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl dark:border-white/10 dark:bg-[#141619]">
            <div className="border-b border-black/5 bg-black/[0.02] px-3 py-2 text-[8px] font-black uppercase tracking-[0.24em] text-gray-500 dark:border-white/5 dark:bg-white/[0.02] dark:text-white/45">
              Select ChatBot
            </div>
            <ul className="max-h-56 overflow-y-auto custom-scrollbar">
              {filteredCandidates.map(agent => (
                <li
                  key={agent.id}
                  onClick={() => selectMention(agent)}
                  className="flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-black/[0.03] text-sm dark:border-white/10 dark:bg-white/[0.05]">
                    {agent.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-gray-900 dark:text-white">
                      {agent.name}
                    </div>
                    <div className="truncate text-[9px] font-mono uppercase tracking-[0.12em] text-gray-500 dark:text-white/45">
                      {agent.role}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3 rounded-[28px] border border-black/10 bg-white px-3 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[#17191d]"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mb-1 inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-black/10 text-gray-500 transition-colors hover:border-black/20 hover:text-gray-900 dark:border-white/10 dark:text-white/45 dark:hover:border-white/20 dark:hover:text-white"
            disabled={isLoading}
            title={isPrism ? 'Attach files to your account context' : 'Attach files to this chatbot context'}
          >
            +
          </button>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleAttachmentPick}
            disabled={isLoading}
            accept=".pdf,.txt,.doc,.docx,.csv,.md,.json,.yaml,.yml,.xml,.png,.jpg,.jpeg,.webp,.gif,image/*"
            multiple
          />

          <div className="flex-1">
            {!isPrism && (
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className="text-[8px] font-black uppercase tracking-[0.16em] text-gray-500 dark:text-white/35">
                  Capability
                </span>
                <select
                  value={requestedCapability}
                  onChange={(e) => setRequestedCapability(e.target.value as RequestedCapability)}
                  className="rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-gray-700 outline-none transition-colors hover:border-black/20 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/70 dark:hover:border-white/20"
                  disabled={isLoading}
                  title="Choose how this message should be handled"
                >
                  {capabilityOptions.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={handleChange}
              placeholder={
                isPrism
                  ? prismMode === 'create'
                    ? 'Describe the chatbot or group you want Prism to design...'
                    : 'Ask Prism for strategy, prompts, or help...'
                  : isGroup
                    ? 'Message the group. Use @Name to address a chatbot directly...'
                    : 'Message this chatbot...'
              }
              rows={1}
              className="max-h-[100px] w-full resize-none bg-transparent px-1 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:text-white dark:placeholder:text-white/28"
              disabled={isLoading}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || (!prompt.trim() && attachments.length === 0)}
            className={`mb-1 inline-flex h-10 w-10 items-center justify-center rounded-2xl transition-all ${
              prompt.trim() || attachments.length > 0
                ? 'bg-gray-900 text-white hover:bg-black dark:bg-white dark:text-black dark:hover:bg-white/90'
                : 'bg-black/[0.04] text-gray-400 dark:bg-white/[0.04] dark:text-white/20'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3 12m0 0 3-3m-3 3 3 3m3 0 3 0m0 0 3-3m-3 3 3 3M12 3v18" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};
