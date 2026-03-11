import { useState, useCallback } from 'react';
import { Message, ChatSession, UserProfile } from '../types';
import { AGENTS } from '../constants';
import { useAppStore } from '../store/useAppStore';
import { dbService, STORES_ENUM } from '../services/db';

const PRISM_INTRO = `Prism is Active. I am your Meta Agent and Workspace Architect.

**Quick Guide:**
- **Ask Prism** (Default): Get answers to any general question.
- **Route**: Find the best AI model for your objective without creating an agent.
- **Create Agents**: Fabricate specialized units for dedicated tasks.
- **Chat Interval**: Pace the interaction for multi-step reasoning.

How can I help you build your workspace today? Tell me about a project, a workflow, or a specific problem you're looking to solve.

Let's start with "create an agent....!"`;

const getAgentIntro = (name: string, role: string) => `**${name}** is Online. I am a specialized unit assigned the role of **${role}**. How can I assist you in my area of expertise today? Use the input bar below to send instructions.`;

const getTeamIntro = (name: string) => `**${name}** Squad is Synchronized. Mention an agent using **@Name** to trigger their specialized expertise. How can the team collaborate on your project today?`;

export const useChatSessions = (currentUser: UserProfile | null) => {
    const chatHistory = useAppStore(state => state.chatHistory);
    const setChatHistory = useAppStore(state => state.setChatHistory);
    const addMessageToHistory = useAppStore(state => state.addMessageToHistory);
    const clearChatHistory = useAppStore(state => state.clearChatHistory);

    const [activeChatId, setActiveChatId] = useState<string>('prism-core');

    const persistSession = useCallback((session: ChatSession) => {
        void dbService.put(STORES_ENUM.SESSIONS as any, {
            ...session,
            userId: session.userId
        }, session.id);
    }, []);

    const persistChatMessage = useCallback((userId: string, chatId: string, message: Message) => {
        const recordId = `${chatId}::${message.id}`;
        void dbService.put(STORES_ENUM.CHATS as any, {
            id: recordId,
            userId,
            chatId,
            message,
            createdAt: Date.now()
        }, recordId);
    }, []);

    // Helper to get initial message for a new session
    const getInitialMessage = useCallback((entityId: string): Message | null => {
        if (entityId === 'prism-core' || entityId === 'prism-core-member') {
            return {
                id: `msg-prism-init-${Date.now()}`,
                agent: AGENTS.PRISM,
                content: { type: 'text', text: PRISM_INTRO },
                type: 'agent'
            };
        }

        // Search for agent in constants
        const agent = Object.values(AGENTS).find(a => a.id === entityId);
        if (agent && !agent.isSystem) {
            return {
                id: `msg-init-${Date.now()}`,
                agent: agent,
                content: { type: 'text', text: getAgentIntro(agent.name, agent.role) },
                type: 'agent'
            };
        }

        // For custom agents or teams, have a helpful fallback
        if (entityId.startsWith('agent-') || entityId.indexOf('-') > -1) {
            return {
                id: `msg-gen-init-${Date.now()}`,
                agent: { id: entityId, name: 'Agent', role: 'Specialist', type: 'agent', icon: '🤖' } as any,
                content: { type: 'text', text: `Welcome to your specialized session. I am your assigned AI unit. How can I assist you with your objective today?` },
                type: 'agent'
            };
        }

        if (entityId.startsWith('session-')) return null;

        return {
            id: `msg-squad-init-${Date.now()}`,
            agent: { id: entityId, name: 'Squad', type: 'team', icon: '👥' } as any,
            content: { type: 'text', text: `This squad is synchronized. Use **@Name** to trigger a specialist's expertise or ask a general question to start the coordination.` },
            type: 'agent'
        };
    }, []);

    const createSession = useCallback((userId: string, entityId: string, isActive: boolean = true): ChatSession => ({
        id: `session-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        entityId,
        userId,
        title: 'New Chat',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
        isActive
    }), []);

    // Initialize sessions — cloud/local persistent via dbService
    const loadSessions = useCallback(async (userId: string) => {
        const rawSessions = await dbService.getAll<ChatSession & { entityId: string }>(STORES_ENUM.SESSIONS as any, userId);
        const normalizedSessions = (rawSessions || [])
            .filter(s => s && s.entityId && s.userId === userId)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        let sessions = normalizedSessions;
        if (sessions.length === 0) {
            const first = createSession(userId, 'prism-core', true);
            sessions = [first];
            persistSession(first);
        }

        const active = sessions.find(s => s.isActive) || sessions[0];
        setActiveChatId(active.entityId);

        const rawChats = await dbService.getAll<any>(STORES_ENUM.CHATS as any, userId);
        const grouped: Record<string, { createdAt: number; message: Message }[]> = {};

        for (const row of rawChats || []) {
            if (row?.userId && row.userId !== userId) continue;
            if (!row?.chatId || !row?.message) continue;
            if (!grouped[row.chatId]) grouped[row.chatId] = [];
            grouped[row.chatId].push({
                createdAt: Number(row.createdAt || Date.now()),
                message: row.message as Message
            });
        }

        const hydrated: Record<string, Message[]> = {};
        Object.entries(grouped).forEach(([chatId, rows]) => {
            hydrated[chatId] = rows
                .sort((a, b) => a.createdAt - b.createdAt)
                .map(r => r.message);
        });

        if (!hydrated['prism-core'] || hydrated['prism-core'].length === 0) {
            const initMsg = getInitialMessage('prism-core');
            hydrated['prism-core'] = initMsg ? [initMsg] : [];
            if (initMsg) persistChatMessage(userId, 'prism-core', initMsg);
        }

        setChatHistory(hydrated);
    }, [createSession, getInitialMessage, persistSession, persistChatMessage]);

    const addMessage = useCallback((chatId: string, message: Message) => {
        addMessageToHistory(chatId, message);
        if (currentUser?.id) {
            persistChatMessage(currentUser.id, chatId, message);
        }
    }, [addMessageToHistory, currentUser, persistChatMessage]);

    const clearChat = useCallback((chatId: string) => {
        clearChatHistory(chatId);
    }, [clearChatHistory]);

    const loadChatHistory = useCallback((chatId: string, messages: Message[]) => {
        setChatHistory(prev => ({ ...prev, [chatId]: messages }));
        if (currentUser?.id) {
            messages.forEach(msg => persistChatMessage(currentUser.id, chatId, msg));
        }
    }, [currentUser, persistChatMessage]);

    const switchChat = useCallback(async (entityId: string) => {
        setActiveChatId(entityId);
        if (!currentUser) return;

        const existingMessages = useAppStore.getState().chatHistory[entityId];
        if (!existingMessages || existingMessages.length === 0) {
            const initMsg = getInitialMessage(entityId);
            const seeded = initMsg ? [initMsg] : [];
            setChatHistory(prev => ({ ...prev, [entityId]: seeded }));
            if (initMsg) persistChatMessage(currentUser.id, entityId, initMsg);
        }
    }, [currentUser, getInitialMessage, persistChatMessage]);

    return {
        chatHistory, setChatHistory,
        activeChatId, setActiveChatId: switchChat,
        loadSessions, addMessage, clearChat, loadChatHistory
    };
};
