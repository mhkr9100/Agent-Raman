/**
 * RamN AI — Special Agents Lambda
 * 
 * Returns all special agent templates.
 * GET /api/special-agents
 */

import { listSpecialAgents } from '../../shared/dynamo.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
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
        console.log('SPECIAL-AGENTS: Listing all templates');
        const templates = await listSpecialAgents();
        console.log(`SPECIAL-AGENTS: ✅ Found ${templates.length} templates`);

        return respond(200, { templates });
    } catch (error) {
        console.error('SPECIAL-AGENTS: ❌ Error:', error);
        return respond(500, { error: 'Failed to list special agents', message: error.message });
    }
};
