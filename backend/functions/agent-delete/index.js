/**
 * RamN AI — Agent Delete Lambda
 *
 * DELETE /api/v2/agents/{agentId}
 */

import { deleteAgent, getAgent, getUserMap, updateUserMap } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';

const CORS = {
    'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN || 'https://www.ramnai.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,DELETE',
    'Content-Type': 'application/json'
};

function respond(statusCode, body) {
    return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {});

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const agentId = event.pathParameters?.agentId || event.queryStringParameters?.agentId;
        if (!agentId) return respond(400, { error: 'Missing agentId' });

        const existing = await getAgent(agentId, userId);
        if (!existing) {
            return respond(404, { error: 'Agent not found for this user', agentId });
        }

        await deleteAgent(agentId, userId);

        // Keep user map history consistent after deletion.
        const userMap = await getUserMap(userId);
        const nextHistory = (userMap.agentHistory || []).filter((entry) => entry.agentId !== agentId);
        await updateUserMap(userId, { agentHistory: nextHistory });

        return respond(200, { success: true, agentId });
    } catch (error) {
        console.error('AGENT-DELETE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message });
        }
        return respond(500, { error: 'Failed to delete agent', message: error.message });
    }
};
