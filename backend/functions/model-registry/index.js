/**
 * RamN AI — Model Registry Lambda (V2)
 *
 * Returns all available models from DynamoDB.
 * GET /api/v2/models
 */

import { listModels } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

const SUPPORTED_VERTEX_MODELS = new Set([
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash-lite'
]);

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

        console.log('MODEL-REGISTRY: Listing Vertex-supported models');
        const models = await listModels();
        const vertexModels = (models || []).filter((model) =>
            SUPPORTED_VERTEX_MODELS.has(String(model?.modelId || ''))
        );
        console.log(`MODEL-REGISTRY: ✅ Found ${vertexModels.length} Vertex models (from ${models.length} total)`);

        return respond(event, 200, { models: vertexModels });
    } catch (error) {
        console.error('MODEL-REGISTRY: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to list models', message: error.message });
    }
};
