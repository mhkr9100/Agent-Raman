/**
 * RamN AI — Agent List Lambda
 * 
 * Returns all agents belonging to a user.
 * GET /api/agents?userId=...
 */

import { listAgentsByUser } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(statusCode, body, eventHeaders) {
    return { statusCode, headers: buildCorsHeaders(eventHeaders, 'OPTIONS,GET'), body: JSON.stringify(body) };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {}, event.headers);

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        console.log('AGENT-LIST: Listing agents');
        const agents = await listAgentsByUser(userId);
        console.log(`AGENT-LIST: ✅ Found ${agents.length} agents`);

        return respond(200, { agents }, event.headers);
    } catch (error) {
        console.error('AGENT-LIST: ❌ Error:', error.message);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }

        return respond(500, { error: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
