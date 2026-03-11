/**
 * RamN AI — Agent Delete Lambda
 *
 * DELETE /api/v2/agents/{agentId}
 */

import { deleteAgent, getAgent, getUserMap, updateUserMap } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(statusCode, body, eventHeaders) {
    return { statusCode, headers: buildCorsHeaders(eventHeaders, 'OPTIONS,DELETE'), body: JSON.stringify(body) };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {}, event.headers);

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const agentId = event.pathParameters?.agentId || event.queryStringParameters?.agentId;
        if (!agentId) return respond(400, { error: 'Missing agentId' }, event.headers);

        const existing = await getAgent(agentId, userId);
        if (!existing) {
            return respond(404, { error: 'Agent not found for this user', agentId }, event.headers);
        }

        await deleteAgent(agentId, userId);

        // Keep user map history consistent after deletion.
        const userMap = await getUserMap(userId);
        const nextHistory = (userMap.agentHistory || []).filter((entry) => entry.agentId !== agentId);
        await updateUserMap(userId, { agentHistory: nextHistory });

        return respond(200, { success: true, agentId }, event.headers);
    } catch (error) {
        console.error('AGENT-DELETE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }
        return respond(500, { error: 'Failed to delete agent', message: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
