/**
 * RamN AI — Special Agents Lambda
 * 
 * Returns all special agent templates.
 * GET /api/special-agents
 */

import { listSpecialAgents } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(statusCode, body, eventHeaders) {
    return { statusCode, headers: buildCorsHeaders(eventHeaders, 'OPTIONS,GET'), body: JSON.stringify(body) };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {}, event.headers);

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        await validateToken(authHeader);

        console.log('SPECIAL-AGENTS: Listing all templates');
        const templates = await listSpecialAgents();
        console.log(`SPECIAL-AGENTS: ✅ Found ${templates.length} templates`);

        return respond(200, { templates }, event.headers);
    } catch (error) {
        console.error('SPECIAL-AGENTS: ❌ Error:', error.message);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }

        return respond(500, { error: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
