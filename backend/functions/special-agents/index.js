/**
 * RamN AI — Special Agents Lambda
 * 
 * Returns all special agent templates.
 * GET /api/special-agents
 */

import { listSpecialAgents } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import { toCanonicalToolId } from '../../shared/tool-ids.js';
import { PUBLIC_TOOL_IDS } from '../../shared/runtime-policy.js';

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

        console.log('SPECIAL-AGENTS: Listing all templates');
        const templates = (await listSpecialAgents()).map((template) => ({
            ...template,
            tools: Array.from(new Set(
                (Array.isArray(template.tools) ? template.tools : [])
                    .map((toolId) => toCanonicalToolId(toolId))
                    .filter((toolId) => PUBLIC_TOOL_IDS.has(toolId))
            ))
        }));
        console.log(`SPECIAL-AGENTS: ✅ Found ${templates.length} templates`);

        return respond(event, 200, { templates });
    } catch (error) {
        console.error('SPECIAL-AGENTS: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, { error: 'Failed to list special agents', message: error.message });
    }
};
