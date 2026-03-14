import { useState, useEffect, useCallback } from 'react';
import { Agent, Team, Message, UserProfile, MessageContent, Task, ToolCall, GlobalTask } from '../types';
import { AGENTS } from '../constants';
import { prismChat, prismChatStream, agentChat, agentChatStream } from '../services/apiV2';
import { isImageAttachment, serializeRuntimeImageAttachment } from '../services/runtimeAttachments';

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
        login, logout
    } = useAuth();

    const {
        agents, setAgents, teams, setTeams,
        loadEntities, addDynamoAgent, deleteAgent, deleteTeam, createTeam, addTeam
    } = useEntities(currentUser);

    const {
        activeChatId, setActiveChatId,
        loadSessions, addMessage, upsertMessage, updateMessage, clearChat, loadChatHistory
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
                    await loadEntities(currentUser.id);
                    await loadSessions(currentUser.id);
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
    } = useAgentExecution(currentUser);

    // === Background Directives ===
    const processSilentDirective = useCallback(async (task: GlobalTask) => {
        const agent = agents.find(a => a.id === task.agentId);
        if (!agent) return "Error: ChatBot not found.";
        const response = await agentChat({
            agentId: agent.id,
            message: task.label,
            conversationId: task.teamId // Or appropriate conversation ID
        });
        return response ? response.response : undefined;
    }, [agents, currentUser]);

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

    const createStreamMessage = useCallback((chatId: string, agent: Agent) => {
        const streamMessage: Message = {
            id: `stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            userId: currentUser?.id,
            agent,
            content: { type: 'text', text: '' },
            type: 'agent'
        };
        upsertMessage(chatId, streamMessage);
        return streamMessage.id;
    }, [currentUser?.id, upsertMessage]);

    const applyStreamDelta = useCallback((chatId: string, messageId: string, delta: string) => {
        if (!delta) return;
        updateMessage(chatId, messageId, (message) => ({
            ...message,
            content: {
                ...(message.content as any),
                type: 'text',
                text: `${((message.content as any).text || '')}${delta}`
            }
        }));
    }, [updateMessage]);

    const finalizeStreamMessage = useCallback((chatId: string, messageId: string, text: string, extra?: Partial<MessageContent>) => {
        updateMessage(chatId, messageId, (message) => ({
            ...message,
            content: {
                type: 'text',
                text,
                ...((extra || {}) as any)
            }
        }));
    }, [updateMessage]);

    const prepareRuntimeAttachments = useCallback(async (files: File[] | undefined, ownerType: 'agent' | 'user', ownerId: string) => {
        const runtimeAttachments: any[] = [];
        const focusDocumentIds: string[] = [];
        if (!files || files.length === 0) {
            return { runtimeAttachments, focusDocumentIds };
        }

        const { uploadAndRegisterDocument } = await import('../services/documentService');
        for (const file of files.slice(0, 5)) {
            if (isImageAttachment(file)) {
                runtimeAttachments.push(await serializeRuntimeImageAttachment(file));
                continue;
            }

            const document = await uploadAndRegisterDocument({ ownerType, ownerId, file });
            if (document?.docId) {
                focusDocumentIds.push(document.docId);
            }
        }

        return { runtimeAttachments, focusDocumentIds };
    }, []);

    // === Send Message (Core Orchestration) ===
    const handleSendMessage = useCallback(async (
        text: string,
        responseSteps: number = 1,
        attachments?: File[],
        searchEnabled?: boolean,
        createEnabled?: boolean,
        prismMode?: 'ask' | 'create',
        specialAgentContext?: { name: string; role: string; predefinedPrompt: string; defaultTools: string[]; suggestedModel: string },
        requestedCapability?: 'auto' | 'web-search' | 'thinking',
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

        const team = teams.find(g => g.id === chatId);
        const agent = agents.find(e => e.id === chatId);
        setActiveRequests(prev => prev + 1);

        try {
            const runtimeMessage = text;
            const ownerType: 'agent' | 'user' = agent ? 'agent' : 'user';
            const ownerId = agent ? agent.id : currentUser.id;
            const { runtimeAttachments, focusDocumentIds } = await prepareRuntimeAttachments(attachments, ownerType, ownerId);

            const prismRequest = {
                message: runtimeMessage,
                mode: prismMode || 'ask',
                conversationId: chatId,
                attachments: runtimeAttachments,
                focusDocumentIds,
                ...(specialAgentContext ? { specialAgentContext } : {})
            } as const;

            const runPrism = async (messageId: string) => {
                try {
                    const response = await prismChatStream(prismRequest, (event) => {
                        if (event?.type === 'status' && event.phase) {
                            setPrismStatus(event.phase);
                        }
                        if (event?.type === 'text-delta' && event.delta) {
                            applyStreamDelta(chatId, messageId, event.delta);
                        }
                    });
                    finalizeStreamMessage(chatId, messageId, response.text || '', response.toolCall ? { toolCall: response.toolCall } : undefined);
                    return response;
                } catch (streamErr) {
                    console.warn('[useScatter] Prism stream unavailable; falling back to JSON response.', streamErr);
                    try {
                        const response = await prismChat(prismRequest);
                        finalizeStreamMessage(chatId, messageId, response.text || '', response.toolCall ? { toolCall: response.toolCall } : undefined);
                        return response;
                    } catch (jsonErr: any) {
                        finalizeStreamMessage(chatId, messageId, `⚠️ Error connecting to AI: ${jsonErr.message}`);
                        return null;
                    }
                }
            };

            const runAgent = async (targetAgent: Agent, messageId: string) => {
                const request = {
                    agentId: targetAgent.id,
                    message: runtimeMessage,
                    conversationId: chatId,
                    attachments: runtimeAttachments,
                    focusDocumentIds,
                    requestedCapability: requestedCapability && requestedCapability !== 'auto' ? requestedCapability : undefined
                };

                try {
                    const response = await agentChatStream(request, (event) => {
                        if (event?.type === 'status' && event.phase) {
                            setPrismStatus(event.phase);
                        }
                        if (event?.type === 'text-delta' && event.delta) {
                            applyStreamDelta(chatId, messageId, event.delta);
                        }
                    });
                    finalizeStreamMessage(chatId, messageId, response.response || '');
                    return response;
                } catch (streamErr) {
                    console.warn('[useScatter] Agent stream unavailable; falling back to JSON response.', streamErr);
                    try {
                        const response = await agentChat(request);
                        finalizeStreamMessage(chatId, messageId, response.response || '');
                        return response;
                    } catch (jsonErr: any) {
                        finalizeStreamMessage(chatId, messageId, `⚠️ Error connecting to AI: ${jsonErr.message}`);
                        return null;
                    }
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
                        const streamMessageId = createStreamMessage(chatId, targetAgent);
                        try {
                            await runAgent(targetAgent, streamMessageId);
                        } catch (error: any) {
                            finalizeStreamMessage(chatId, streamMessageId, `⚠️ Error connecting to AI: ${error.message}`);
                        }
                    }));
                } else {
                    setPrismStatus("No mention detected. Consulting Core...");
                    const streamMessageId = createStreamMessage(chatId, AGENTS.PRISM);
                    const response = await runPrism(streamMessageId);

                    if (response) {
                        // Auto-execute READ_ONLY tool calls silently (e.g., search)
                        if (response.toolCall && response.toolCall.safetyType === 'READ_ONLY') {
                            await handleExecuteCommand(chatId, streamMessageId, response.toolCall,
                                addTeam,
                                addDynamoAgent, setActiveChatId
                            );
                        }
                    }
                }
            } else if (agent || chatId === 'prism-core') {
                const target = agent || AGENTS.PRISM;
                setTypingAgent(target);
                const streamMessageId = createStreamMessage(chatId, target);
                if (target.id === 'prism-core') {
                    const prismRes = await runPrism(streamMessageId);
                    if (prismRes?.toolCall && prismRes.toolCall.safetyType === 'READ_ONLY') {
                        await handleExecuteCommand(chatId, streamMessageId, prismRes.toolCall,
                            addTeam,
                            addDynamoAgent, setActiveChatId
                        );
                    }
                } else {
                    await runAgent(target, streamMessageId);
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
    }, [currentUser, activeChatId, agents, teams, addMessage, addTeam, addDynamoAgent, applyStreamDelta, createStreamMessage, finalizeStreamMessage, handleExecuteCommand, prepareRuntimeAttachments, setActiveChatId]);

    // === Special Agent → Prism Flow ===
    const sendSpecialAgentToPrism = useCallback((template: { name: string; role: string; predefinedPrompt: string; defaultTools: string[]; suggestedModel: string }) => {
        // Switch to Prism chat
        setActiveChatId('prism-core');
        // Auto-send create-mode message with special agent context
        const message = `Personalize and deploy the "${template.name}" chatbot for me.`;
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
        // Special Agent Flow
        sendSpecialAgentToPrism
    };
};
