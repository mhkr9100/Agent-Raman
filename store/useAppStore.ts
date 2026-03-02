import { create } from 'zustand';
import { Message } from '../types';
import { TypingState } from '../hooks/useScatter';

interface AppState {
    chatHistory: Record<string, Message[]>;
    typingAgents: Record<string, TypingState>;

    // Actions
    setChatHistory: (history: Record<string, Message[]> | ((prev: Record<string, Message[]>) => Record<string, Message[]>)) => void;
    setTypingAgents: (typingAgents: Record<string, TypingState> | ((prev: Record<string, TypingState>) => Record<string, TypingState>)) => void;
    addMessageToHistory: (chatId: string, message: Message) => void;
    clearChatHistory: (chatId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
    chatHistory: {},
    typingAgents: {},

    setChatHistory: (updater) => set((state) => ({
        chatHistory: typeof updater === 'function' ? updater(state.chatHistory) : updater
    })),

    setTypingAgents: (updater) => set((state) => ({
        typingAgents: typeof updater === 'function' ? updater(state.typingAgents) : updater
    })),

    addMessageToHistory: (chatId, message) => set((state) => ({
        chatHistory: {
            ...state.chatHistory,
            [chatId]: [...(state.chatHistory[chatId] || []), message]
        }
    })),

    clearChatHistory: (chatId) => set((state) => ({
        chatHistory: {
            ...state.chatHistory,
            [chatId]: []
        }
    }))
}));
