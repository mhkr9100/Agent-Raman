/**
 * RamN AI — Tool Registry Lambda
 * 
 * Returns all available tools from the registry.
 * GET /api/tools
 */

import { listTools } from '../../shared/dynamo.js';

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
        console.log('TOOL-REGISTRY: Listing all tools');
        const tools = await listTools();
        console.log(`TOOL-REGISTRY: ✅ Found ${tools.length} tools`);

        return respond(200, { tools });
    } catch (error) {
        console.error('TOOL-REGISTRY: ❌ Error:', error);
        return respond(500, { error: 'Failed to list tools', message: error.message });
    }
};
