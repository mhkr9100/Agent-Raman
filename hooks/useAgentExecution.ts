import { useState, useCallback } from 'react';
import { Agent, Message, UserProfile, ToolCall, Team } from '../types';
import { AGENTS } from '../constants';
// import { generateSingleAgentResponse, generatePrismResponse, executeInterceptedCommand } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';

import { createAgent } from '../services/apiV2';

export const useAgentExecution = (
    currentUser: UserProfile | null,
    getUserKeys: () => { openAiKey?: string, anthropicKey?: string, geminiKey?: string },
    addMessage: (chatId: string, message: Message) => void
) => {
    const [activeRequests, setActiveRequests] = useState(0);
    const isProcessing = activeRequests > 0;

    const [typingAgent, setTypingAgent] = useState<Agent | null>(null);
    const [typingAgents, setTypingAgents] = useState<{ agent: Agent, tasks: any[], mode?: 'CHAT' | 'SOLUTION' | 'TASK' | 'VOID' }[]>([]);
    const [prismStatus, setPrismStatus] = useState<string>('');
    const [orchestrationWeights, setOrchestrationWeights] = useState<{ [key: string]: number }>({});
    const [agentModes, setAgentModes] = useState<{ [key: string]: 'CHAT' | 'SOLUTION' | 'TASK' | 'VOID' }>({});



    const handleExecuteCommand = async (activeChatId: string, messageId: string, toolCall: ToolCall, onCreateTeam: (team: Team) => void, onRecruitAgent: (agent: Agent) => void, setActiveChatId: (id: string) => void) => {
        const history = useAppStore.getState().chatHistory[activeChatId] || [];
        const msgIndex = history.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        if (toolCall.name === 'fabricateTeam') {
            const squad = toolCall.args.specialists.map((spec: any) => {
                const newAgent = { ...spec, id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, type: 'agent', userId: currentUser?.id, model: spec.modelId || 'gemini-3.0-flash', provider: 'google', isDeletable: true, isSystem: false };
                onRecruitAgent(newAgent);
                return newAgent;
            });
            const newTeam: Team = {
                id: `team-${Date.now()}`,
                userId: currentUser?.id,
                name: toolCall.args.teamName,
                description: toolCall.args.objective,
                type: 'rouge',
                agents: squad,
                isSystem: false
            };
            onCreateTeam(newTeam);

            const updatedHistory = [...history];
            updatedHistory[msgIndex] = {
                ...updatedHistory[msgIndex],
                content: { ...updatedHistory[msgIndex].content, text: `✅ Command Initialized: The **${newTeam.name}** squad has been deployed.`, toolCall: undefined }
            };

            const introMessage: Message = {
                id: `intro-${Date.now()}`,
                userId: currentUser?.id,
                agent: AGENTS.PRISM, // Prism introduces the team
                content: { type: 'text', text: `The **${newTeam.name}** squad has been successfully deployed and synchronized. Instruct them when ready.` },
                type: 'agent'
            };

            useAppStore.getState().setChatHistory(prev => ({
                ...prev,
                [activeChatId]: updatedHistory,
                [newTeam.id]: [introMessage]
            }));
            setActiveChatId(newTeam.id);
            return;
        }

        if (toolCall.name === 'fabricateAgent') {
            try {
                // Call actual V2 API to handle saving to DB
                console.log('API: POST /api/v2/agents/create (fabricateAgent UI intercept)');
                const res = await createAgent({
                    agentName: toolCall.args.name || toolCall.args.agentName,
                    role: toolCall.args.role,
                    agentDescription: toolCall.args.description || toolCall.args.agentDescription || `A specialized ${toolCall.args.role || 'AI'} agent.`,
                    systemPrompt: toolCall.args.jobDescription || toolCall.args.systemPrompt,
                    icon: toolCall.args.icon,
                    model: {
                        modelId: toolCall.args.modelId || 'gemini-3.0-flash',
                        temperature: 0.3
                    },
                    tools: toolCall.args.capabilities || toolCall.args.tools || []
                });

                const agentParam = {
                    ...toolCall.args,
                    id: res.agentId,
                    name: res.name,
                    type: 'agent',
                    userId: currentUser?.id,
                    model: toolCall.args.modelId || 'gemini-3.0-flash',
                    provider: 'google',
                    isDeletable: true,
                    isSystem: false
                };

                onRecruitAgent(agentParam);

                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: { ...updatedHistory[msgIndex].content, text: `✅ Agent Fabrication Successful: ${res.name} has been deployed.`, toolCall: undefined }
                };

                const introMessage: Message = {
                    id: `intro-${Date.now()}`,
                    userId: currentUser?.id,
                    agent: agentParam as Agent,
                    content: { type: 'text', text: `Initialization complete. I am **${agentParam.name}**, your new ${agentParam.role}. How can I assist you today?` },
                    type: 'agent'
                };

                useAppStore.getState().setChatHistory(prev => ({
                    ...prev,
                    [activeChatId]: updatedHistory,
                    [agentParam.id]: [introMessage]
                }));
                setActiveChatId(agentParam.id);
            } catch (err: any) {
                console.error("Agent creation failed:", err);
                // Optionally show error message in chat history
                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: { ...updatedHistory[msgIndex].content, text: `⚠️ Agent Fabrication Failed: ${err.message}`, toolCall: undefined }
                };
                useAppStore.getState().setChatHistory(prev => ({
                    ...prev,
                    [activeChatId]: updatedHistory
                }));
            }
            return;
        }

        const updatedHistory = [...history];
        updatedHistory[msgIndex] = {
            ...updatedHistory[msgIndex],
            content: { ...updatedHistory[msgIndex].content, isExecuting: true }
        };
        useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: updatedHistory }));

        // Simulate execution (we will wire up real tool execution later if needed via API)
        await new Promise(r => setTimeout(r, 1000));

        const finalHistory = [...useAppStore.getState().chatHistory[activeChatId]];
        const idx = finalHistory.findIndex(m => m.id === messageId);
        if (idx !== -1) {
            finalHistory[idx] = { ...finalHistory[idx], content: { ...finalHistory[idx].content, isExecuting: false } };
            useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: finalHistory }));
        }
    };

    return {
        isProcessing, setActiveRequests,
        typingAgent, setTypingAgent,
        typingAgents, setTypingAgents,
        prismStatus, setPrismStatus,
        orchestrationWeights, setOrchestrationWeights,
        agentModes, setAgentModes,
        handleExecuteCommand
    };
};
