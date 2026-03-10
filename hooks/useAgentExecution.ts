import { useState } from 'react';
import { Agent, Message, UserProfile, ToolCall, Team } from '../types';
import { AGENTS } from '../constants';
// import { generateSingleAgentResponse, generatePrismResponse, executeInterceptedCommand } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';

import { createAgent } from '../services/apiV2';
import { normalizeToolIds } from '../services/toolIds';

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



    const handleExecuteCommand = async (
        activeChatId: string,
        messageId: string,
        toolCall: ToolCall,
        onCreateTeam: (team: Team) => void | Promise<void | Team> | Team,
        onRecruitAgent: (agent: Agent) => void,
        setActiveChatId: (id: string) => void
    ) => {
        const history = useAppStore.getState().chatHistory[activeChatId] || [];
        const msgIndex = history.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        if (toolCall.name === 'fabricateTeam') {
            try {
                const specialists = Array.isArray(toolCall.args?.specialists) ? toolCall.args.specialists : [];
                if (specialists.length === 0) {
                    throw new Error('No specialists provided for team fabrication.');
                }

                const createdAgents: Agent[] = [];
                for (const spec of specialists) {
                    const toolIds = normalizeToolIds(spec.capabilities || spec.toolIds || spec.tools || []);
                    const response = await createAgent({
                        agentName: spec.name || spec.agentName,
                        role: spec.role || 'Specialist',
                        agentDescription: spec.jobDescription || spec.description || `A specialized ${spec.role || 'AI'} agent.`,
                        systemPrompt: spec.jobDescription || spec.systemPrompt || `You are a ${spec.role || 'Specialist'} agent.`,
                        icon: spec.icon || '🤖',
                        model: {
                            modelId: spec.modelId || 'gemini-2.5-flash',
                            temperature: 0.3
                        },
                        toolIds
                    });

                    const newAgent: Agent = {
                        id: response.agentId,
                        userId: currentUser?.id,
                        name: response.name,
                        type: 'agent',
                        role: spec.role || 'Specialist',
                        jobDescription: spec.jobDescription || spec.description || `A specialized ${spec.role || 'AI'} agent.`,
                        icon: spec.icon || '🤖',
                        provider: 'google',
                        model: spec.modelId || 'gemini-2.5-flash',
                        capabilities: toolIds as any,
                        isDeletable: true,
                        isSystem: false
                    };
                    onRecruitAgent(newAgent);
                    createdAgents.push(newAgent);
                }

                const newTeam: Team = {
                    id: `team-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    userId: currentUser?.id,
                    name: toolCall.args.teamName || 'New Team',
                    description: toolCall.args.objective,
                    type: 'rouge',
                    agents: createdAgents,
                    isSystem: false
                };
                await onCreateTeam(newTeam);

                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: { ...updatedHistory[msgIndex].content, text: `✅ Command Initialized: The **${newTeam.name}** squad has been deployed.`, toolCall: undefined }
                };

                const introMessage: Message = {
                    id: `intro-${Date.now()}`,
                    userId: currentUser?.id,
                    agent: AGENTS.PRISM,
                    content: { type: 'text', text: `The **${newTeam.name}** squad has been successfully deployed and synchronized. Instruct them when ready.` },
                    type: 'agent'
                };

                useAppStore.getState().setChatHistory(prev => ({
                    ...prev,
                    [activeChatId]: updatedHistory,
                    [newTeam.id]: [introMessage]
                }));
                setActiveChatId(newTeam.id);
            } catch (err: any) {
                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: {
                        ...updatedHistory[msgIndex].content,
                        text: `⚠️ Team Fabrication Failed: ${err?.message || 'Unknown error'}`,
                        toolCall: undefined
                    }
                };
                useAppStore.getState().setChatHistory(prev => ({
                    ...prev,
                    [activeChatId]: updatedHistory
                }));
            }
            return;
        }

        if (toolCall.name === 'fabricateAgent') {
            try {
                const toolIds = normalizeToolIds(toolCall.args.toolIds || toolCall.args.capabilities || toolCall.args.tools || []);
                // Call actual V2 API to handle saving to DB
                console.log('API: POST /api/v2/agents/create (fabricateAgent UI intercept)');
                const res = await createAgent({
                    agentName: toolCall.args.name || toolCall.args.agentName,
                    role: toolCall.args.role,
                    agentDescription: toolCall.args.description || toolCall.args.agentDescription || `A specialized ${toolCall.args.role || 'AI'} agent.`,
                    systemPrompt: toolCall.args.jobDescription || toolCall.args.systemPrompt,
                    icon: toolCall.args.icon,
                    model: {
                        modelId: toolCall.args.modelId || 'gemini-2.5-flash',
                        temperature: 0.3
                    },
                    toolIds
                });

                const agentParam = {
                    ...toolCall.args,
                    id: res.agentId,
                    name: res.name,
                    type: 'agent',
                    userId: currentUser?.id,
                    model: toolCall.args.modelId || 'gemini-2.5-flash',
                    capabilities: toolIds as any,
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

        // No simulated execution for unsupported action tools.
        const targetIndex = updatedHistory.findIndex(m => m.id === messageId);
        if (targetIndex !== -1) {
            updatedHistory[targetIndex] = {
                ...updatedHistory[targetIndex],
                content: {
                    ...updatedHistory[targetIndex].content,
                    isExecuting: false,
                    text: `${updatedHistory[targetIndex].content.text || ''}\n\n⚠️ This tool call cannot be executed client-side. Please wire a backend task endpoint for this action.`
                }
            };
            useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: updatedHistory }));
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
