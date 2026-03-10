import { useState, useEffect, useCallback } from 'react';
import { Agent, Team, Message, UserProfile, MessageContent, Task, ToolCall, GlobalTask } from '../types';
import { AGENTS } from '../constants';
import { prismChat, prismChatStream, agentChat } from '../services/apiV2';
import { useAppStore } from '../store/useAppStore';

// Composed Hooks
import { useAuth } from './useAuth';
import { useEntities } from './useEntities';
import { useChatSessions } from './useChatSessions';
import { useAgentExecution } from './useAgentExecution';

export interface TypingState {
    agent: Agent;
    tasks: Task[];
    weight?: number;
    mode?: 'CHAT' | 'SOLUTION' | 'TASK' | 'VOID';
}

export interface RateLimitInfo {
    blocked: boolean;
    remaining: number;
    limit: number;
    resetTime: Date | null;
    resetTimeFormatted: string | null;
}

export const useScatter = () => {
    // === Composed Hooks ===
    const {
        currentUser, setCurrentUser, isInitializing, setIsInitializing,
        login, logout, getUserKeys
    } = useAuth();

    const {
        agents, setAgents, teams, setTeams,
        loadEntities, addDynamoAgent, deleteAgent, deleteTeam, createTeam, addTeam
    } = useEntities(currentUser);

    const {
        activeChatId, setActiveChatId,
        chatSessions, activeSessionId,
        loadSessions, addMessage, clearChat, loadChatHistory,
        startNewSession, resumeSession, getSessionsForEntity
    } = useChatSessions(currentUser);

    // === Rate Limit State ===
    const [rateLimitInfo] = useState<RateLimitInfo>({
        blocked: false, remaining: 15, limit: 15, resetTime: null, resetTimeFormatted: null
    });

    // === Load Data on Auth ===
    useEffect(() => {
        if (currentUser) {
            const init = async () => {
                try {
                    const { dbService, STORES_ENUM } = await import('../services/db');
                    // 1. Core Hydration
                    await loadEntities(currentUser.id);
                    await loadSessions(currentUser.id);

                    // 2. Enterprise Data Sync (Prevent cross-browser data loss)
                    console.log('[useScatter] Syncing UserMap & Memories from cloud...');
                    await dbService.pullFromCloud(STORES_ENUM.USERMAP, currentUser.id);
                    await dbService.pullFromCloud(STORES_ENUM.MEMORIES, currentUser.id);
                } catch (e) {
                    console.error('[useScatter] Initialization Error:', e);
                } finally {
                    setIsInitializing(false);
                }
            };
            init();
        }
    }, [currentUser]);

    // === Agent Execution ===
    const {
        isProcessing, setActiveRequests,
        typingAgent, setTypingAgent,
        typingAgents, setTypingAgents,
        prismStatus, setPrismStatus,
        orchestrationWeights, setOrchestrationWeights,
        agentModes, setAgentModes,
        handleExecuteCommand
    } = useAgentExecution(currentUser, getUserKeys, addMessage);

    // === Background Directives ===
    const processSilentDirective = useCallback(async (task: GlobalTask) => {
        const agent = agents.find(a => a.id === task.agentId);
        if (!agent) return "Error: Agent not found.";
        const response = await agentChat({
            agentId: agent.id,
            message: task.label,
            conversationId: task.teamId // Or appropriate conversation ID
        });
        return response ? response.response : undefined;
    }, [agents, currentUser, getUserKeys]);

    const injectOutputToChat = useCallback((task: GlobalTask) => {
        if (!task.output) return;
        const targetAgent = agents.find(a => a.id === task.agentId) || AGENTS.PRISM;
        const chatId = task.teamId || task.agentId;
        addMessage(chatId, {
            id: `output-${Date.now()}`,
            userId: currentUser?.id,
            agent: targetAgent,
            content: { type: 'text', text: task.output, mode: 'SOLUTION' },
            type: 'agent'
        });
    }, [agents, currentUser, addMessage]);

    // === Proxy Functions ===
    const _executeCmdProxy = async (messageId: string, toolCall: ToolCall) => {
        return handleExecuteCommand(activeChatId, messageId, toolCall,
            addTeam,
            addDynamoAgent,
            setActiveChatId
        );
    };

    // === Send Message (Core Orchestration) ===
    const handleSendMessage = useCallback(async (
        text: string,
        responseSteps: number = 1,
        file?: { data: string, mimeType: string },
        searchEnabled?: boolean,
        createEnabled?: boolean,
        prismMode?: 'ask' | 'create' | 'council',
        specialAgentContext?: { name: string; role: string; predefinedPrompt: string; defaultTools: string[]; suggestedModel: string },
        councilConfig?: { councilModelIds: string[]; decisionModelId: string },
        targetChatId?: string
    ) => {
        const chatId = targetChatId || activeChatId;
        if (!currentUser) return;

        const newMessage: Message = {
            id: Date.now().toString(),
            userId: currentUser.id,
            agent: { ...AGENTS.PRISM, name: currentUser.name, type: 'user', icon: '👤' } as Agent,
            content: { type: 'text', text },
            type: 'user'
        };

        addMessage(chatId, newMessage);
        let currentSnapshot = [...(useAppStore.getState().chatHistory[chatId] || []), newMessage];

        if (createEnabled && chatId === 'prism-core') {
            const lastMsg = currentSnapshot[currentSnapshot.length - 1];
            currentSnapshot[currentSnapshot.length - 1] = {
                ...lastMsg,
                content: {
                    ...lastMsg.content, type: 'text',
                    text: `${(lastMsg.content as any).text}\n\n[SYSTEM DIRECTIVE: The user has toggled 'Create Agents'. You MUST analyze the request and output a deployable command. If the user asks for a single specialist, use 'fabricateAgent'. If the user asks for a team/group/squad, use 'fabricateTeam'. Do NOT respond with conversational-only output.]`
                }
            };
        }

        const team = teams.find(g => g.id === chatId);
        const agent = agents.find(e => e.id === chatId);
        setActiveRequests(prev => prev + 1);

        try {
            const callPrism = async () => {
                const request = {
                    message: text,
                    mode: prismMode || 'ask',
                    conversationId: activeSessionId || undefined,
                    ...(councilConfig ? { councilConfig } : {}),
                    ...(specialAgentContext ? { specialAgentContext } : {})
                } as const;

                try {
                    return await prismChatStream(request, (event) => {
                        if (event?.type === 'status' && event.phase) {
                            setPrismStatus(event.phase);
                        }
                    });
                } catch (streamErr) {
                    console.warn('[useScatter] Stream endpoint unavailable; falling back to JSON response.', streamErr);
                    return await prismChat(request);
                }
            };

            if (team) {
                setPrismStatus("Scanning for Mentions...");
                const mentionedNames = text.match(/@(\w+)/g)?.map(m => m.slice(1).toLowerCase()) || [];
                const mentionedAgents = team.agents.filter(a => mentionedNames.includes(a.name.toLowerCase()));

                if (mentionedAgents.length > 0) {
                    setPrismStatus(`Initializing ${mentionedAgents.length} unit(s)...`);
                    const weights: Record<string, number> = {};
                    mentionedAgents.forEach(a => weights[a.id] = 1 / mentionedAgents.length);
                    setOrchestrationWeights(weights);
                    setTypingAgents(mentionedAgents.map(a => ({ agent: a, tasks: [], mode: 'CHAT' as const })));

                    await Promise.all(mentionedAgents.map(async (targetAgent) => {
                        const response = await agentChat({
                            agentId: targetAgent.id,
                            message: text,
                            conversationId: activeSessionId || undefined
                        });
                        const responseContent = { type: 'text', text: response.response } as any;
                        if (responseContent) addMessage(chatId, { id: `msg-${Date.now()}-${targetAgent.id}`, userId: currentUser.id, agent: targetAgent, content: responseContent, type: 'agent' });
                    }));
                } else {
                    setPrismStatus("No mention detected. Consulting Core...");
                    const response = await callPrism();

                    if (response) {
                        const msgId = `msg-${Date.now()}`;

                        addMessage(chatId, {
                            id: msgId,
                            userId: currentUser.id,
                            agent: AGENTS.PRISM,
                            content: {
                                type: 'text',
                                text: response.text || '',
                                toolCall: response.toolCall
                            },
                            type: 'agent'
                        });

                        // Auto-execute READ_ONLY tool calls silently (e.g., search)
                        if (response.toolCall && response.toolCall.safetyType === 'READ_ONLY') {
                            await handleExecuteCommand(chatId, msgId, response.toolCall,
                                addTeam,
                                addDynamoAgent, setActiveChatId
                            );
                        }
                    }
                }
            } else if (agent || chatId === 'prism-core') {
                const target = agent || AGENTS.PRISM;
                setTypingAgent(target);

                let responseContent: any;

                if (target.id === 'prism-core') {
                    const prismRes = await callPrism();
                    responseContent = {
                        type: 'text',
                        text: prismRes.text,
                        toolCall: prismRes.toolCall
                    };
                } else {
                    const agentRes = await agentChat({
                        agentId: target.id,
                        message: text,
                        conversationId: activeSessionId || undefined
                    });
                    // For now map string response to content interface
                    responseContent = { type: 'text', text: agentRes.response };
                }

                if (responseContent) {
                    const msgId = `msg-${Date.now()}`;
                    const toolCallInfo = responseContent.toolCall ? { toolCall: responseContent.toolCall } : {};

                    addMessage(chatId, {
                        id: msgId,
                        userId: currentUser.id,
                        agent: target,
                        content: { type: 'text', text: responseContent.text || '', ...toolCallInfo },
                        type: 'agent'
                    });

                    if (responseContent.toolCall && responseContent.toolCall.safetyType === 'READ_ONLY') {
                        await handleExecuteCommand(chatId, msgId, responseContent.toolCall,
                            addTeam,
                            addDynamoAgent, setActiveChatId
                        );
                    }
                }
            }
        } catch (e: any) {
            console.error("Chat Error:", e);
            addMessage(chatId, {
                id: `error-${Date.now()}`,
                userId: currentUser.id,
                agent: chatId === 'prism-core' ? AGENTS.PRISM : (agents.find(a => a.id === chatId) || AGENTS.PRISM),
                content: { type: 'text', text: `⚠️ Error connecting to AI: ${e.message}` },
                type: 'agent'
            });
        } finally {
            setActiveRequests(prev => prev - 1);
            setPrismStatus("");
            setTypingAgents([]);
            setTypingAgent(null);
            setOrchestrationWeights({});
        }
    }, [currentUser, activeChatId, agents, teams, addMessage, getUserKeys, addTeam]);

    // === Special Agent → Prism Flow ===
    const sendSpecialAgentToPrism = useCallback((template: { name: string; role: string; predefinedPrompt: string; defaultTools: string[]; suggestedModel: string }) => {
        // Switch to Prism chat
        setActiveChatId('prism-core');
        // Auto-send create-mode message with special agent context
        const message = `Personalize and deploy the "${template.name}" agent for me.`;
        handleSendMessage(message, 1, undefined, false, false, 'create', template, undefined, 'prism-core');
    }, [setActiveChatId, handleSendMessage]);

    return {
        currentUser, isInitializing, userProfile: currentUser as UserProfile, setUserProfile: setCurrentUser,
        login, logout,
        agents, setAgents, teams, setTeams,
        activeChatId, setActiveChatId,
        isProcessing, typingAgent, typingAgents, prismStatus, orchestrationWeights, agentModes,
        handleSendMessage, handleExecuteCommand: _executeCmdProxy,
        processSilentDirective, injectOutputToChat,
        clearChat, loadChatHistory, recruitAgent: addDynamoAgent, deleteAgent, deleteTeam,
        createTeam: (data: any) => createTeam(data, setActiveChatId),
        rateLimitInfo,
        // Session Management
        chatSessions, activeSessionId, startNewSession, resumeSession, getSessionsForEntity,
        // Special Agent Flow
        sendSpecialAgentToPrism
    };
};
