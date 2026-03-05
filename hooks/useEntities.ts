import { useState, useCallback } from 'react';
import { Agent, Team, UserProfile } from '../types';
import { AGENTS, SYSTEM_TEAMS } from '../constants';
import { listAgents } from '../services/apiV2';

export const useEntities = (currentUser: UserProfile | null) => {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);

    /**
     * Loads entities on login.
     * System agents come from constants.
     * User agents come from the real DynamoDB backend via listAgents().
     */
    const loadEntities = useCallback(async (userId: string) => {
        const systemAgents = Object.values(AGENTS).filter(a => a.isSystem && a.id !== 'prism-core');

        try {
            const { agents: dbAgents } = await listAgents();
            // Map DynamoDB agent shape → frontend Agent shape
            const userAgents: Agent[] = dbAgents.map((a: any) => ({
                id: a.agentId,
                name: a.name || a.blueprint?.agentName,
                jobDescription: a.description || a.blueprint?.agentDescription,
                role: a.blueprint?.role || 'Specialist',
                systemPrompt: a.blueprint?.systemPrompt,
                icon: a.blueprint?.icon || '🤖',
                model: a.blueprint?.model?.modelId || 'gemini-2.0-flash',
                provider: 'google',
                type: 'agent',
                userId: a.userId,
                status: a.status,
                blueprint: a.blueprint,
                isDeletable: true,
                isSystem: false
            }));
            setAgents([...systemAgents, ...userAgents]);
        } catch (err) {
            console.error('[useEntities] Failed to load agents from backend, falling back to system agents:', err);
            setAgents([...systemAgents]);
        }

        // Teams remain local for now (no backend equivalent yet)
        setTeams([...SYSTEM_TEAMS]);
    }, []);

    /**
     * addDynamoAgent — called after a successful agent-create API response.
     * Adds the new agent to React state (source of truth is DynamoDB, not IndexedDB).
     */
    const addDynamoAgent = useCallback((data: any) => {
        const newAgent: Agent = {
            id: data.id || data.agentId,
            name: data.name,
            jobDescription: data.jobDescription || data.description || data.agentDescription || `A specialized ${data.role || 'AI'} agent.`,
            role: data.role || 'Specialist',
            systemPrompt: data.systemPrompt || data.blueprint?.systemPrompt,
            icon: data.icon || '🤖',
            model: data.model?.modelId || data.modelId || 'gemini-2.0-flash',
            provider: 'google',
            type: 'agent',
            userId: currentUser?.id,
            status: 'active',
            blueprint: data.blueprint,
            isDeletable: true,
            isSystem: false
        };
        setAgents(prev => [...prev, newAgent]);
        return newAgent;
    }, [currentUser]);

    const deleteAgent = useCallback((id: string) => {
        setAgents(prev => prev.filter(a => a.id !== id));
        // TODO: wire to DELETE /api/v2/agents/:id when backend endpoint exists
    }, []);

    const deleteTeam = useCallback((id: string) => {
        setTeams(prev => prev.filter(t => t.id !== id));
    }, []);

    const createTeam = useCallback((data: any, switchChatFn: (id: string) => void) => {
        const newTeam = {
            ...data,
            id: `team-${Date.now()}`,
            userId: currentUser?.id,
            agents: agents.filter(a => data.agentIds?.includes(a.id)),
            isSystem: false
        };
        setTeams(prev => [...prev, newTeam]);
        switchChatFn(newTeam.id);
    }, [currentUser, agents]);

    return {
        agents, setAgents,
        teams, setTeams,
        loadEntities, addDynamoAgent, deleteAgent, deleteTeam, createTeam
    };
};
