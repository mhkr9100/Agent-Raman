/**
 * RamN AI — Model Registry Lambda (V2)
 *
 * Returns all available models from DynamoDB.
 * GET /api/v2/models
 */

import { listModels } from '../../shared/dynamo.js';
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

        console.log('MODEL-REGISTRY: Listing all models');
        const models = await listModels();
        console.log(`MODEL-REGISTRY: ✅ Found ${models.length} models`);

        return respond(200, { models }, event.headers);
    } catch (error) {
        console.error('MODEL-REGISTRY: ❌ Error:', error.message);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }
        return respond(500, { error: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
