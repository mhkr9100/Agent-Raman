/**
 * RamN AI — Tool Registry Lambda
 * 
 * Returns all available tools from the registry.
 * GET /api/tools
 */

import { listTools } from '../../shared/dynamo.js';
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
        await validateToken(authHeader);

        console.log('TOOL-REGISTRY: Listing all tools');
        const tools = await listTools();
        console.log(`TOOL-REGISTRY: ✅ Found ${tools.length} tools`);

        return respond(event, 200, { tools });
    } catch (error) {
        console.error('TOOL-REGISTRY: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, { error: 'Failed to list tools', message: error.message });
    }
};
