/**
 * RamN AI — Agent Delete Lambda
 *
 * DELETE /api/v2/agents/{agentId}
 */

import { deleteAgent, getAgent, getUserMap, updateUserMap } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,DELETE'),
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

        const agentId = event.pathParameters?.agentId || event.queryStringParameters?.agentId;
        if (!agentId) return respond(event, 400, { error: 'Missing agentId' });

        const existing = await getAgent(agentId, userId);
        if (!existing) {
            return respond(event, 404, { error: 'Agent not found for this user', agentId });
        }

        await deleteAgent(agentId, userId);

        // Keep user map history consistent after deletion.
        const userMap = await getUserMap(userId);
        const nextHistory = (userMap.agentHistory || []).filter((entry) => entry.agentId !== agentId);
        await updateUserMap(userId, { agentHistory: nextHistory });

        return respond(event, 200, { success: true, agentId });
    } catch (error) {
        console.error('AGENT-DELETE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to delete agent', message: error.message });
    }
};
