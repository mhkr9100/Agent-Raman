import { useState, useCallback } from 'react';
import { Agent, Message, UserProfile, ToolCall, Team } from '../types';
import { AGENTS } from '../constants';
import { generateSingleAgentResponse, generatePrismResponse, executeInterceptedCommand, generateExpandedSolution } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';

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

    const handleExpandMessage = async (activeChatId: string, messageId: string) => {
        const history = useAppStore.getState().chatHistory[activeChatId] || [];
        const msgIndex = history.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        const messageToExpand = history[msgIndex];
        if (messageToExpand.content.solution || messageToExpand.content.isExpanding) return;

        const updatedHistory = [...history];
        updatedHistory[msgIndex] = {
            ...updatedHistory[msgIndex],
            content: { ...updatedHistory[msgIndex].content, isExpanding: true }
        };
        useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: updatedHistory }));

        const solutionText = await generateExpandedSolution(history.slice(0, msgIndex + 1), messageToExpand.agent);

        useAppStore.getState().setChatHistory(prev => {
            const current = [...(prev[activeChatId] || [])];
            const idx = current.findIndex(m => m.id === messageId);
            if (idx !== -1) {
                current[idx] = {
                    ...current[idx],
                    content: { ...current[idx].content, isExpanding: false, solution: solutionText || "Unable to synthesize solution expansion." }
                };
            }
            return { ...prev, [activeChatId]: current };
        });
    };

    const handleExecuteCommand = async (activeChatId: string, messageId: string, toolCall: ToolCall, onCreateTeam: (team: Team) => void, onRecruitAgent: (agent: Agent) => void, setActiveChatId: (id: string) => void) => {
        const history = useAppStore.getState().chatHistory[activeChatId] || [];
        const msgIndex = history.findIndex(m => m.id === messageId);
        if (msgIndex === -1) return;

        if (toolCall.name === 'fabricateTeam') {
            const squad = toolCall.args.specialists.map((spec: any) => {
                const newAgent = { ...spec, id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, type: 'agent', userId: currentUser?.id, model: spec.modelId || 'gemini-2.5-flash', provider: 'google', isDeletable: true, isSystem: false };
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
            const agentParam = { ...toolCall.args, id: `agent-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, type: 'agent', userId: currentUser?.id, model: toolCall.args.modelId || 'gemini-2.5-flash', provider: 'google', isDeletable: true, isSystem: false };
            onRecruitAgent(agentParam);
            const updatedHistory = [...history];
            updatedHistory[msgIndex] = {
                ...updatedHistory[msgIndex],
                content: { ...updatedHistory[msgIndex].content, text: `✅ Agent Fabrication Successful: ${toolCall.args.name} has been deployed.`, toolCall: undefined }
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
            return;
        }

        const updatedHistory = [...history];
        updatedHistory[msgIndex] = {
            ...updatedHistory[msgIndex],
            content: { ...updatedHistory[msgIndex].content, isExecuting: true }
        };
        useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: updatedHistory }));

        const result = await executeInterceptedCommand(updatedHistory[msgIndex].agent, toolCall);

        if (result) {
            addMessage(activeChatId, {
                id: `res-${Date.now()}`,
                userId: currentUser?.id,
                agent: updatedHistory[msgIndex].agent,
                content: result,
                type: 'agent'
            });
            const finalHistory = [...useAppStore.getState().chatHistory[activeChatId]];
            const idx = finalHistory.findIndex(m => m.id === messageId);
            if (idx !== -1) {
                finalHistory[idx] = { ...finalHistory[idx], content: { ...finalHistory[idx].content, isExecuting: false } };
                useAppStore.getState().setChatHistory(prev => ({ ...prev, [activeChatId]: finalHistory }));
            }
        }
    };

    return {
        isProcessing, setActiveRequests,
        typingAgent, setTypingAgent,
        typingAgents, setTypingAgents,
        prismStatus, setPrismStatus,
        orchestrationWeights, setOrchestrationWeights,
        agentModes, setAgentModes,
        handleExpandMessage, handleExecuteCommand
    };
};
