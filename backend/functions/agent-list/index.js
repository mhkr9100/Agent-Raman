/**
 * RamN AI — Agent List Lambda
 * 
 * Returns all agents belonging to a user.
 * GET /api/agents?userId=...
 */

import { listAgentsByUser } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';

const CORS = {
    'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN || 'https://www.ramnai.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,GET',
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

        console.log(`AGENT-LIST: Listing agents for userId=${userId}`);
        const agents = await listAgentsByUser(userId);
        console.log(`AGENT-LIST: ✅ Found ${agents.length} agents`);

        return respond(200, { agents });
    } catch (error) {
        console.error('AGENT-LIST: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message });
        }

        return respond(500, { error: 'Failed to list agents', message: error.message });
    }
};
