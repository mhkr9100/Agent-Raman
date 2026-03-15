import { useState } from 'react';
import { Agent, Message, UserProfile, ToolCall, Team } from '../types';
import { AGENTS } from '../constants';
// import { generateSingleAgentResponse, generatePrismResponse, executeInterceptedCommand } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';

import { createAgent, fabricateTeam as fabricateTeamApi } from '../services/apiV2';
import { normalizeToolIds } from '../services/toolIds';

export const useAgentExecution = (
    currentUser: UserProfile | null
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
                    throw new Error('No specialists provided for group fabrication.');
                }

                const fabricatorResponse = await fabricateTeamApi({
                    teamName: toolCall.args.teamName || 'New Group',
                    objective: toolCall.args.objective || '',
                    specialists
                });

                const createdAgents: Agent[] = (fabricatorResponse.agents || []).map((agentRecord) => ({
                    id: agentRecord.agentId,
                    userId: currentUser?.id,
                    name: agentRecord.name,
                    type: 'agent',
                    role: agentRecord.role || 'Specialist',
                    jobDescription: agentRecord.blueprint?.agentDescription || `A specialized ${agentRecord.role || 'AI'} chatbot.`,
                    icon: agentRecord.icon || '🤖',
                    provider: 'google',
                    model: agentRecord.modelId || 'gemini-2.5-flash',
                    capabilities: normalizeToolIds(agentRecord.toolIds || []) as any,
                    blueprint: agentRecord.blueprint,
                    status: agentRecord.status || 'active',
                    isDeletable: true,
                    isSystem: false
                }));

                createdAgents.forEach((agent) => onRecruitAgent(agent));

                const teamPayload: Team = {
                    id: fabricatorResponse.team.teamId,
                    userId: fabricatorResponse.team.userId || currentUser?.id,
                    name: fabricatorResponse.team.name || toolCall.args.teamName || 'New Group',
                    description: fabricatorResponse.team.description || toolCall.args.objective,
                    type: 'rouge',
                    agents: createdAgents,
                    isSystem: false
                };
                const persistedTeam = await onCreateTeam(teamPayload);
                const newTeam = (persistedTeam && (persistedTeam as Team).id)
                    ? persistedTeam as Team
                    : null;
                if (!newTeam) {
                    throw new Error('Group could not be persisted by backend.');
                }

                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: { ...updatedHistory[msgIndex].content, text: `✅ Command Initialized: The **${newTeam.name}** group has been deployed.`, toolCall: undefined }
                };

                const introMessage: Message = {
                    id: `intro-${Date.now()}`,
                    userId: currentUser?.id,
                    agent: AGENTS.PRISM,
                    content: { type: 'text', text: `The **${newTeam.name}** group has been successfully deployed and synchronized. Instruct them when ready.` },
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
                        text: `⚠️ Group Fabrication Failed: ${err?.message || 'Unknown error'}`,
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
                    agentDescription: toolCall.args.description || toolCall.args.agentDescription || `A specialized ${toolCall.args.role || 'AI'} chatbot.`,
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
                    content: { ...updatedHistory[msgIndex].content, text: `✅ ChatBot creation successful: ${res.name} has been deployed.`, toolCall: undefined }
                };

                const introMessage: Message = {
                    id: `intro-${Date.now()}`,
                    userId: currentUser?.id,
                    agent: agentParam as Agent,
                    content: { type: 'text', text: `Initialization complete. I am **${agentParam.name}**, your new ${agentParam.role} chatbot. How can I assist you today?` },
                    type: 'agent'
                };

                useAppStore.getState().setChatHistory(prev => ({
                    ...prev,
                    [activeChatId]: updatedHistory,
                    [agentParam.id]: [introMessage]
                }));
                setActiveChatId(agentParam.id);
            } catch (err: any) {
                console.error("ChatBot creation failed:", err);
                // Optionally show error message in chat history
                const updatedHistory = [...history];
                updatedHistory[msgIndex] = {
                    ...updatedHistory[msgIndex],
                    content: { ...updatedHistory[msgIndex].content, text: `⚠️ ChatBot creation failed: ${err.message}`, toolCall: undefined }
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
