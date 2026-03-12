/**
 * RamN AI — Agent List Lambda
 * 
 * Returns all agents belonging to a user.
 * GET /api/agents?userId=...
 */

import { listAgentsByUser } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

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
        console.log(`AGENT-LIST: ✅ Found ${agents.length} agents`);

        return respond(event, 200, { agents });
    } catch (error) {
        console.error('AGENT-LIST: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, { error: 'Failed to list agents', message: error.message });
    }
};
