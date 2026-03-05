import { useState, useEffect, useCallback } from 'react';
import { Message, ChatSession, UserProfile } from '../types';
import { AGENTS } from '../constants';
import { useAppStore } from '../store/useAppStore';

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
    const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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

    // Initialize sessions — pure in-memory (backend Lambda saves conversations to DynamoDB)
    const loadSessions = useCallback(async (userId: string) => {
        // Start with a fresh Prism session on each page load
        const newSession: ChatSession = {
            id: `session-${Date.now()}`,
            entityId: 'prism-core',
            userId,
            title: 'New Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 1,
            isActive: true
        };
        setChatSessions([newSession]);
        setActiveSessionId(newSession.id);
        const initMsg = getInitialMessage('prism-core');
        setChatHistory({
            'prism-core': initMsg ? [initMsg] : []
        });
    }, [getInitialMessage]);

    const addMessage = useCallback((chatId: string, message: Message) => {
        addMessageToHistory(chatId, message);
    }, [addMessageToHistory]);

    const clearChat = useCallback((chatId: string) => {
        clearChatHistory(chatId);
    }, [clearChatHistory]);

    const loadChatHistory = useCallback((chatId: string, messages: Message[]) => {
        setChatHistory(prev => ({ ...prev, [chatId]: messages }));
    }, []);

    const startNewSession = useCallback(async (entityId: string) => {
        if (!currentUser) return;

        // Deactivate existing sessions for this entity
        setChatSessions(prev =>
            prev.map(s =>
                s.entityId === entityId && s.isActive ? { ...s, isActive: false } : s
            )
        );

        const newSession: ChatSession = {
            id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            entityId,
            userId: currentUser.id,
            title: 'New Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 0,
            isActive: true
        };
        setChatSessions(prev => [...prev, newSession]);
        setActiveSessionId(newSession.id);
        const initMsg = getInitialMessage(entityId);
        setChatHistory(prev => ({ ...prev, [entityId]: initMsg ? [initMsg] : [] }));
    }, [currentUser, getInitialMessage]);

    const resumeSession = useCallback(async (session: ChatSession) => {
        // In-memory: just switch to the entity's existing chat history
        setActiveSessionId(session.id);
        setActiveChatId(session.entityId);
    }, []);

    const getSessionsForEntity = useCallback((entityId: string) => {
        return chatSessions.filter(s => s.entityId === entityId).sort((a, b) => b.updatedAt - a.updatedAt);
    }, [chatSessions]);

    const switchChat = useCallback(async (entityId: string) => {
        setActiveChatId(entityId);
        if (!currentUser) return;

        const entitySessions = chatSessions.filter(s => s.entityId === entityId).sort((a, b) => b.updatedAt - a.updatedAt);
        const activeSession = entitySessions.find(s => s.isActive) || entitySessions[0];

        if (activeSession) {
            setActiveSessionId(activeSession.id);
        } else {
            // Create new session for this entity
            const newSession: ChatSession = {
                id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                entityId,
                userId: currentUser.id,
                title: 'New Chat',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messageCount: 0,
                isActive: true
            };
            setChatSessions(prev => [...prev, newSession]);
            setActiveSessionId(newSession.id);
            const initMsg = getInitialMessage(entityId);
            setChatHistory(prev => ({ ...prev, [entityId]: initMsg ? [initMsg] : [] }));
        }
    }, [currentUser, chatSessions, getInitialMessage]);

    return {
        chatHistory, setChatHistory,
        activeChatId, setActiveChatId: switchChat,
        chatSessions, activeSessionId,
        loadSessions, addMessage, clearChat, loadChatHistory,
        startNewSession, resumeSession, getSessionsForEntity
    };
};
