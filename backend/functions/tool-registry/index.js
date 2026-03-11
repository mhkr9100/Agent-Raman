/**
 * RamN AI — Tool Registry Lambda
 * 
 * Returns all available tools from the registry.
 * GET /api/tools
 */

import { listTools } from '../../shared/dynamo.js';
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

        console.log('TOOL-REGISTRY: Listing all tools');
        const tools = await listTools();
        console.log(`TOOL-REGISTRY: ✅ Found ${tools.length} tools`);

        return respond(200, { tools }, event.headers);
    } catch (error) {
        console.error('TOOL-REGISTRY: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }

        return respond(500, { error: 'Failed to list tools', message: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
