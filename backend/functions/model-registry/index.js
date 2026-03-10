/**
 * RamN AI — Model Registry Lambda (V2)
 *
 * Returns all available models from DynamoDB.
 * GET /api/v2/models
 */

import { listModels } from '../../shared/dynamo.js';

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
        console.log('MODEL-REGISTRY: Listing all models');
        const models = await listModels();
        console.log(`MODEL-REGISTRY: ✅ Found ${models.length} models`);

        return respond(200, { models });
    } catch (error) {
        console.error('MODEL-REGISTRY: ❌ Error:', error);
        return respond(500, { error: 'Failed to list models', message: error.message });
    }
};
