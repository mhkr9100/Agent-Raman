import { useState, useCallback } from 'react';
import { Agent, Team, UserProfile } from '../types';
import { AGENTS } from '../constants';
import {
    listAgents,
    deleteAgent as deleteAgentApi,
    listTeams,
    upsertTeam,
    deleteTeamApi
} from '../services/apiV2';
import { normalizeToolIds } from '../services/toolIds';

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

        const allAgents: Agent[] = [];

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
                model: a.blueprint?.model?.modelId || 'gemini-2.5-flash',
                provider: 'google',
                capabilities: normalizeToolIds(a.blueprint?.toolIds || a.blueprint?.tools || []) as any,
                type: 'agent',
                userId: a.userId,
                status: a.status,
                blueprint: a.blueprint,
                isDeletable: true,
                isSystem: false
            }));
            allAgents.push(...systemAgents, ...userAgents);
            setAgents(allAgents);
        } catch (err) {
            console.error('[useEntities] Failed to load agents from backend, falling back to system agents:', err);
            allAgents.push(...systemAgents);
            setAgents(allAgents);
        }

        try {
            const { teams: dbTeams } = await listTeams();
            const normalizedTeams = (dbTeams || [])
                .filter((team: any) => !!team?.teamId)
                .map((team) => ({
                    id: team.teamId,
                    name: team.name,
                    description: team.description || '',
                    type: 'rouge' as const,
                    ...team,
                    userId: team.userId || userId,
                    agents: allAgents.filter((agent) => (team.agentIds || []).includes(agent.id)),
                    isSystem: false
                }));
            setTeams(normalizedTeams);
        } catch (err) {
            console.error('[useEntities] Failed to load teams from backend:', err);
            setTeams([]);
        }
    }, []);

    /**
     * addDynamoAgent — called after a successful agent-create API response.
     * Adds the new agent to React state (source of truth is DynamoDB, not IndexedDB).
     */
    const addDynamoAgent = useCallback((data: any) => {
        const newAgent: Agent = {
            id: data.id || data.agentId,
            name: data.name,
            jobDescription: data.jobDescription || data.description || data.agentDescription || `A specialized ${data.role || 'AI'} chatbot.`,
            role: data.role || 'Specialist',
            systemPrompt: data.systemPrompt || data.blueprint?.systemPrompt,
            icon: data.icon || '🤖',
            model: data.model?.modelId || data.modelId || 'gemini-2.5-flash',
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

    const deleteAgent = useCallback(async (id: string) => {
        const previous = agents;
        setAgents(prev => prev.filter(a => a.id !== id));
        try {
            await deleteAgentApi(id);
        } catch (err) {
            console.error('[useEntities] Failed to delete agent from backend, rolling back:', err);
            setAgents(previous);
            throw err;
        }
    }, [agents]);

    const deleteTeam = useCallback(async (id: string) => {
        const previous = teams;
        setTeams(prev => prev.filter(t => t.id !== id));
        try {
            await deleteTeamApi(id);
        } catch (err) {
            console.error('[useEntities] Failed to delete team from backend, rolling back:', err);
            setTeams(previous);
            throw err;
        }
    }, [teams]);

    const addTeam = useCallback(async (teamInput: Team | any) => {
        const ownerId = currentUser?.id || teamInput.userId;
        if (!ownerId) throw new Error('Cannot create team without user context');

        const teamAgentIds = Array.isArray(teamInput.agents)
            ? teamInput.agents.map((a: Agent) => a.id).filter(Boolean)
            : [];
        const response = await upsertTeam({
            teamId: teamInput.id,
            name: teamInput.name,
            description: teamInput.description || '',
            agentIds: teamAgentIds
        });

        const allAgents = agents;
        const normalizedTeam: Team = {
            id: response.team.teamId,
            userId: response.team.userId || ownerId,
            name: response.team.name || teamInput.name,
            description: response.team.description || teamInput.description || '',
            type: 'rouge',
            agents: allAgents.filter((agent) => (response.team.agentIds || teamAgentIds).includes(agent.id)),
            isSystem: false
        };

        setTeams(prev => {
            const exists = prev.some(t => t.id === normalizedTeam.id);
            if (exists) {
                return prev.map(t => t.id === normalizedTeam.id ? normalizedTeam : t);
            }
            return [...prev, normalizedTeam];
        });

        return normalizedTeam;
    }, [currentUser, agents]);

    const createTeam = useCallback(async (data: any, switchChatFn: (id: string) => void) => {
        const resolvedAgents: Agent[] = Array.isArray(data.agents)
            ? data.agents
            : agents.filter(a => data.agentIds?.includes(a.id));
        const newTeam = await addTeam({
            id: data.id,
            name: data.name || 'New Team',
            description: data.description || '',
            userId: currentUser?.id,
            agents: resolvedAgents,
            type: 'rouge',
            isSystem: false
        });
        switchChatFn(newTeam.id);
        return newTeam;
    }, [currentUser, agents, addTeam]);

    return {
        agents, setAgents,
        teams, setTeams,
        loadEntities, addDynamoAgent, deleteAgent, deleteTeam, createTeam, addTeam
    };
};
