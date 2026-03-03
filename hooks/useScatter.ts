import { useState, useEffect, useCallback } from 'react';
import { Agent, Team, Message, UserProfile, MessageContent, Task, ToolCall, GlobalTask } from '../types';
import { AGENTS } from '../constants';
import { generateSingleAgentResponse, generatePrismResponse } from '../services/aiService';
import { dbService, STORES_ENUM } from '../services/db';
import { canMakeRequest, recordRequest, getUsageInfo, formatResetTime } from '../services/rateLimiter';
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
        loadEntities, recruitAgent, deleteAgent, deleteTeam, createTeam
    } = useEntities(currentUser);

    const {
        activeChatId, setActiveChatId,
        chatSessions, activeSessionId,
        loadSessions, addMessage, clearChat, loadChatHistory,
        startNewSession, resumeSession, getSessionsForEntity
    } = useChatSessions(currentUser);

    // === Rate Limit State ===
    const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo>({
        blocked: false, remaining: 15, limit: 15, resetTime: null, resetTimeFormatted: null
    });

    // Refresh rate limit info periodically
    useEffect(() => {
        if (!currentUser) return;
        const refreshRate = () => {
            const usage = getUsageInfo(currentUser.id);
            setRateLimitInfo({
                blocked: usage.remaining <= 0,
                remaining: usage.remaining,
                limit: usage.limit,
                resetTime: usage.resetTime,
                resetTimeFormatted: usage.resetTime ? formatResetTime(usage.resetTime) : null
            });
        };
        refreshRate();
        const interval = setInterval(refreshRate, 10_000); // refresh every 10s
        return () => clearInterval(interval);
    }, [currentUser]);

    // === Load Data on Auth ===
    useEffect(() => {
        if (currentUser) {
            const init = async () => {
                try {
                    await loadEntities(currentUser.id);
                    await loadSessions(currentUser.id);
                } catch (e) {
                    console.error(e);
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
        const userKeys = getUserKeys();
        const response = await generateSingleAgentResponse(
            [{ id: 'task-trigger', agent: { ...AGENTS.PRISM, name: currentUser?.name || 'User', type: 'user' } as Agent, content: { type: 'text', text: task.label }, type: 'user' }],
            agent, [], [], 'SOLUTION', userKeys, currentUser?.id
        );
        return response && response.type === 'text' ? response.text : undefined;
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
            (team) => { setTeams(prev => [...prev, team]); dbService.put(STORES_ENUM.GROUPS, team); },
            recruitAgent,
            setActiveChatId
        );
    };

    // === Send Message (Core Orchestration) ===
    const handleSendMessage = useCallback(async (text: string, responseSteps: number = 1, file?: { data: string, mimeType: string }, searchEnabled?: boolean, createEnabled?: boolean, prismMode?: 'ask' | 'create') => {
        const chatId = activeChatId;
        if (!currentUser) return;

        // ── STRICT RATE LIMIT CHECK ──
        const rateCheck = canMakeRequest(currentUser.id);
        if (!rateCheck.allowed) {
            const usage = getUsageInfo(currentUser.id);
            setRateLimitInfo({
                blocked: true,
                remaining: 0,
                limit: usage.limit,
                resetTime: usage.resetTime,
                resetTimeFormatted: usage.resetTime ? formatResetTime(usage.resetTime) : null
            });
            // Show rate limit as a system message
            addMessage(chatId, {
                id: `ratelimit-${Date.now()}`,
                agent: AGENTS.PRISM,
                content: {
                    type: 'text',
                    text: `⏳ **Hourly Quota Reached.** You've used your limit of 15 requests per hour. Please come back after 1 hour (resets at **${usage.resetTime ? formatResetTime(usage.resetTime) : 'soon'}**).`
                },
                type: 'agent'
            });
            return; // BLOCK — do not send
        }

        // Record this request
        recordRequest(currentUser.id);
        const updatedUsage = getUsageInfo(currentUser.id);
        setRateLimitInfo({
            blocked: updatedUsage.remaining <= 0,
            remaining: updatedUsage.remaining,
            limit: updatedUsage.limit,
            resetTime: updatedUsage.resetTime,
            resetTimeFormatted: updatedUsage.resetTime ? formatResetTime(updatedUsage.resetTime) : null
        });
        // ── END RATE LIMIT ──

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
                    text: `${(lastMsg.content as any).text}\n\n[SYSTEM DIRECTIVE: The user has toggled 'Create Agents'. You MUST analyze the request and immediately use your 'fabricateAgent' tool to deploy the requested specialist. Do NOT just output conversational text.]`
                }
            };
        }

        const team = teams.find(g => g.id === chatId);
        const agent = agents.find(e => e.id === chatId);
        setActiveRequests(prev => prev + 1);

        try {
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
                        const response = await generateSingleAgentResponse(currentSnapshot, targetAgent, team.agents, [], 'CHAT', undefined, currentUser?.id);
                        if (response) addMessage(chatId, { id: `msg-${Date.now()}-${targetAgent.id}`, userId: currentUser.id, agent: targetAgent, content: response, type: 'agent' });
                    }));
                } else {
                    setPrismStatus("No mention detected. Consulting Core...");
                    const response = await generatePrismResponse(currentSnapshot, AGENTS.PRISM, setPrismStatus, undefined, undefined, currentUser?.id, prismMode);
                    if (response) {
                        const msgId = `msg-${Date.now()}`;
                        addMessage(chatId, { id: msgId, userId: currentUser.id, agent: AGENTS.PRISM, content: response, type: 'agent' });
                        // Auto-execute READ_ONLY tool calls silently (e.g., web search)
                        if (response.toolCall && response.toolCall.safetyType === 'READ_ONLY') {
                            await handleExecuteCommand(chatId, msgId, response.toolCall,
                                (team) => { setTeams(prev => [...prev, team]); dbService.put(STORES_ENUM.GROUPS, team); },
                                recruitAgent, setActiveChatId
                            );
                        }
                    }
                }
            } else if (agent || chatId === 'prism-core') {
                const target = agent || AGENTS.PRISM;
                setTypingAgent(target);
                let response;
                if (target.id === 'prism-core') {
                    response = await generatePrismResponse(currentSnapshot, target, setPrismStatus, undefined, undefined, currentUser?.id, prismMode);
                } else {
                    response = await generateSingleAgentResponse(currentSnapshot, target, [], [], 'CHAT', undefined, currentUser?.id);
                }

                if (response) {
                    const msgId = `msg-${Date.now()}`;
                    addMessage(chatId, { id: msgId, userId: currentUser.id, agent: target, content: response, type: 'agent' });
                    // Auto-execute READ_ONLY tool calls silently (e.g., web search)
                    if (response.toolCall && response.toolCall.safetyType === 'READ_ONLY') {
                        await handleExecuteCommand(chatId, msgId, response.toolCall,
                            (team) => { setTeams(prev => [...prev, team]); dbService.put(STORES_ENUM.GROUPS, team); },
                            recruitAgent, setActiveChatId
                        );
                    }
                }
            }
        } finally {
            setActiveRequests(prev => prev - 1);
            setPrismStatus("");
            setTypingAgents([]);
            setTypingAgent(null);
            setOrchestrationWeights({});
        }
    }, [currentUser, activeChatId, agents, teams, addMessage, getUserKeys]);

    return {
        currentUser, isInitializing, userProfile: currentUser as UserProfile, setUserProfile: setCurrentUser,
        login, logout,
        agents, setAgents, teams, setTeams,
        activeChatId, setActiveChatId,
        isProcessing, typingAgent, typingAgents, prismStatus, orchestrationWeights, agentModes,
        handleSendMessage, handleExecuteCommand: _executeCmdProxy,
        processSilentDirective, injectOutputToChat,
        clearChat, loadChatHistory, recruitAgent, deleteAgent, deleteTeam,
        createTeam: (data: any) => createTeam(data, setActiveChatId),
        rateLimitInfo,
        // Session Management
        chatSessions, activeSessionId, startNewSession, resumeSession, getSessionsForEntity
    };
};
