import { callAI } from './vertex-ai.js';

const MAX_RECENT_MESSAGES = 10;
const SOFT_HISTORY_CHAR_BUDGET = 18000;
const MAX_MESSAGE_CHARS = 1400;
const MAX_SUMMARY_CHARS = 2600;

function normalizeContent(content) {
    if (typeof content === 'string') return content.trim();
    if (!content || typeof content !== 'object') return '';
    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.solution === 'string') return content.solution.trim();
    if (typeof content.content === 'string') return content.content.trim();
    return '';
}

function normalizeRole(role) {
    if (role === 'assistant' || role === 'model') return 'model';
    if (role === 'user') return 'user';
    return null;
}

function clampMessage(content) {
    const normalized = normalizeContent(content).replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= MAX_MESSAGE_CHARS) return normalized;
    return `${normalized.slice(0, MAX_MESSAGE_CHARS)}…`;
}

function estimateHistoryChars(history, currentUserMessage = '') {
    const historyChars = history.reduce((total, item) => total + item.content.length + 32, 0);
    return historyChars + String(currentUserMessage || '').length;
}

function buildTranscript(messages) {
    return messages
        .map((message, index) => `${index + 1}. ${message.role.toUpperCase()}: ${clampMessage(message.content)}`)
        .join('\n');
}

async function summarizeOlderMessages(messages, modelName) {
    if (!messages.length) return '';

    const transcript = buildTranscript(messages);
    const summaryPrompt = `Compress the older portion of an AI conversation for continued runtime context.

Keep only durable information:
- user goals and success criteria
- hard constraints and preferences
- key facts, numbers, names, deadlines, or decisions
- open questions and unresolved work
- important tool results or document findings

Rules:
- do not invent or generalize beyond the transcript
- omit filler, greetings, and repetition
- keep the output under 12 bullets
- plain text only`;

    const summaryResult = await callAI({
        systemPrompt: summaryPrompt,
        userMessage: transcript,
        modelName: modelName || 'gemini-2.5-flash-lite',
        temperature: 0.1
    });

    const summary = String(summaryResult.text || '').trim();
    if (!summary) return '';
    if (summary.length <= MAX_SUMMARY_CHARS) return summary;
    return `${summary.slice(0, MAX_SUMMARY_CHARS)}…`;
}

export async function buildConversationContext({
    messages = [],
    currentUserMessage = '',
    modelName = 'gemini-2.5-flash'
}) {
    const normalized = (messages || [])
        .map((message) => {
            const role = normalizeRole(message?.role);
            const content = clampMessage(message?.content);
            if (!role || !content) return null;
            return { role, content };
        })
        .filter(Boolean);

    if (normalized.length === 0) {
        return {
            history: [],
            summaryText: '',
            summaryUsed: false,
            rawMessageCount: 0,
            trimmedMessageCount: 0
        };
    }

    const estimatedChars = estimateHistoryChars(normalized, currentUserMessage);
    const withinWindow =
        normalized.length <= MAX_RECENT_MESSAGES &&
        estimatedChars <= SOFT_HISTORY_CHAR_BUDGET;

    if (withinWindow) {
        return {
            history: normalized,
            summaryText: '',
            summaryUsed: false,
            rawMessageCount: normalized.length,
            trimmedMessageCount: normalized.length
        };
    }

    const recentHistory = normalized.slice(-MAX_RECENT_MESSAGES);
    const olderHistory = normalized.slice(0, -MAX_RECENT_MESSAGES);
    const summaryText = await summarizeOlderMessages(olderHistory, modelName);

    return {
        history: recentHistory,
        summaryText,
        summaryUsed: Boolean(summaryText),
        rawMessageCount: normalized.length,
        trimmedMessageCount: recentHistory.length
    };
}
