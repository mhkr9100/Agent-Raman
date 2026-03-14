/**
 * RamN AI — Team Fabricate Lambda
 *
 * POST /api/v2/teams/fabricate
 * Creates a team and its specialists server-side from a Prism tool call payload.
 */

import {
    saveAgent,
    saveTeam,
    getToolById,
    getModelById,
    getUserMap,
    updateUserMap
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { normalizeToolIds } from '../../shared/tool-ids.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import {
    SUPPORTED_TOOL_IDS,
    SUPPORTED_VERTEX_MODELS
} from '../../shared/runtime-policy.js';

const LEGACY_TOOL_CANDIDATES = {
    'web-search': ['webSearch', 'googleSearch', 'web_search'],
    'doc-reader': ['docReader', 'doc_reader', 'fileManipulation'],
    thinking: ['thinking']
};
function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

async function resolveToolRecords(toolIds) {
    const resolved = [];
    for (const toolId of toolIds) {
        let tool = await getToolById(toolId);
        if (!tool) {
            const legacyCandidates = LEGACY_TOOL_CANDIDATES[toolId] || [];
            for (const legacyId of legacyCandidates) {
                tool = await getToolById(legacyId);
                if (tool) break;
            }
        }
        if (tool) resolved.push(tool);
    }
    return resolved;
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(event, 200, {});

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const teamName = String(body.teamName || '').trim();
        const objective = String(body.objective || '').trim();
        const specialists = Array.isArray(body.specialists) ? body.specialists : [];

        if (!teamName) return respond(event, 400, { error: 'teamName is required' });
        if (specialists.length === 0) return respond(event, 400, { error: 'specialists must contain at least one specialist' });

        const prepared = [];
        for (let i = 0; i < specialists.length; i += 1) {
            const spec = specialists[i] || {};
            const name = String(spec.name || '').trim();
            const role = String(spec.role || '').trim() || 'Specialist';
            const agentDescription = String(spec.description || spec.agentDescription || spec.jobDescription || '').trim()
                || `A specialized ${role} agent.`;
            const systemPrompt = String(spec.jobDescription || spec.systemPrompt || '').trim()
                || `You are a ${role} specialist.`;
            const icon = String(spec.icon || '🤖').trim() || '🤖';
            const requestedModelId = String(spec.modelId || 'gemini-2.5-flash').trim();

            if (!name) {
                return respond(event, 400, { error: `specialists[${i}].name is required` });
            }
            if (!requestedModelId.startsWith('gemini-')) {
                return respond(event, 400, {
                    error: `specialists[${i}].modelId "${requestedModelId}" is not supported. Only Vertex Gemini models are allowed.`
                });
            }
            if (!SUPPORTED_VERTEX_MODELS.has(requestedModelId)) {
                return respond(event, 400, {
                    error: `specialists[${i}].modelId "${requestedModelId}" is not enabled. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`
                });
            }

            const toolIds = normalizeToolIds(spec.capabilities || spec.toolIds || spec.tools || [])
                .filter((toolId) => SUPPORTED_TOOL_IDS.has(toolId));
            if (toolIds.length === 0) {
                return respond(event, 400, {
                    error: `specialists[${i}] must include at least one allowed tool ID (${Array.from(SUPPORTED_TOOL_IDS).join(', ')})`
                });
            }

            const resolvedTools = await resolveToolRecords(toolIds);
            if (resolvedTools.length === 0) {
                return respond(event, 400, { error: `specialists[${i}] has no resolvable tools in ToolRegistry` });
            }

            const resolvedModel = await getModelById(requestedModelId);
            if (!resolvedModel) {
                return respond(event, 400, { error: `specialists[${i}] model not found: ${requestedModelId}` });
            }
            if (!String(resolvedModel.modelId || requestedModelId).startsWith('gemini-')) {
                return respond(event, 400, {
                    error: `specialists[${i}] model "${requestedModelId}" is not supported. Only Vertex Gemini models are allowed.`
                });
            }
            if (!SUPPORTED_VERTEX_MODELS.has(String(resolvedModel.modelId || requestedModelId))) {
                return respond(event, 400, {
                    error: `specialists[${i}] model "${requestedModelId}" is not enabled. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`
                });
            }

            prepared.push({
                name,
                role,
                agentDescription,
                systemPrompt,
                icon,
                toolIds,
                resolvedTools,
                resolvedModel
            });
        }

        const createdAgents = [];
        for (const item of prepared) {
            const agentId = crypto.randomUUID();
            const blueprint = {
                agentName: item.name,
                agentDescription: item.agentDescription,
                role: item.role,
                systemPrompt: item.systemPrompt,
                icon: item.icon,
                tools: item.resolvedTools,
                toolIds: item.toolIds,
                model: {
                    ...item.resolvedModel,
                    temperature: 0.3
                }
            };

            await saveAgent({
                agentId,
                userId,
                name: item.name,
                description: item.agentDescription,
                blueprint,
                status: 'active'
            });

            createdAgents.push({
                agentId,
                name: item.name,
                role: item.role,
                icon: item.icon,
                modelId: item.resolvedModel.modelId,
                toolIds: item.toolIds,
                status: 'active',
                blueprint
            });
        }

        const teamId = crypto.randomUUID();
        const agentIds = createdAgents.map((agent) => agent.agentId);
        await saveTeam({
            teamId,
            userId,
            name: teamName,
            description: objective,
            agentIds,
            status: 'active'
        });

        const userMap = await getUserMap(userId);
        const priorHistory = Array.isArray(userMap?.agentHistory) ? userMap.agentHistory : [];
        const nextHistory = [...priorHistory];
        const now = new Date().toISOString();
        for (const agent of createdAgents) {
            nextHistory.push({
                agentId: agent.agentId,
                name: agent.name,
                createdAt: now,
                source: 'team-fabricate'
            });
        }
        await updateUserMap(userId, { agentHistory: nextHistory });

        return respond(event, 200, {
            team: {
                teamId,
                userId,
                name: teamName,
                description: objective,
                agentIds,
                status: 'active'
            },
            agents: createdAgents,
            message: 'Team fabricated successfully'
        });
    } catch (error) {
        console.error('TEAM-FABRICATE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, {
            error: 'Failed to fabricate team',
            message: error.message || 'Unknown error'
        });
    }
};
