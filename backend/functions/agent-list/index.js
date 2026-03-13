/**
 * RamN AI — Agent List Lambda
 * 
 * Returns all agents belonging to a user.
 * GET /api/agents?userId=...
 */

import { listAgentsByUser, updateAgent } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import { resolveSupportedVertexModelId } from '../../shared/runtime-policy.js';

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,GET'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(event, 200, {});

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        console.log(`AGENT-LIST: Listing agents for userId=${userId}`);
        const agents = await listAgentsByUser(userId);

        const repairedAgents = await Promise.all((agents || []).map(async (agent) => {
            const requestedModelId = agent?.blueprint?.model?.modelId || '';
            const resolution = resolveSupportedVertexModelId(requestedModelId);
            if (!resolution.migrated) return agent;

            const nextAgent = {
                ...agent,
                blueprint: {
                    ...(agent.blueprint || {}),
                    model: {
                        ...(agent.blueprint?.model || {}),
                        modelId: resolution.runtimeModelId
                    }
                }
            };

            try {
                await updateAgent(agent.agentId, userId, { blueprint: nextAgent.blueprint });
                console.log(`AGENT-LIST: Repaired legacy model ${requestedModelId || 'missing'} -> ${resolution.runtimeModelId} for ${agent.agentId}`);
            } catch (repairError) {
                console.warn(`AGENT-LIST: Failed to persist repaired model for ${agent.agentId}:`, repairError.message);
            }

            return nextAgent;
        }));

        console.log(`AGENT-LIST: ✅ Found ${repairedAgents.length} agents`);

        return respond(event, 200, { agents: repairedAgents });
    } catch (error) {
        console.error('AGENT-LIST: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, { error: 'Failed to list agents', message: error.message });
    }
};
