/**
 * RamN AI — Model Registry Lambda (V2)
 *
 * Returns all available models from DynamoDB.
 * GET /api/v2/models
 */

import { listModels } from '../../shared/dynamo.js';
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

        console.log('MODEL-REGISTRY: Listing all models');
        const models = await listModels();
        console.log(`MODEL-REGISTRY: ✅ Found ${models.length} models`);

        return respond(event, 200, { models });
    } catch (error) {
        console.error('MODEL-REGISTRY: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to list models', message: error.message });
    }
};
