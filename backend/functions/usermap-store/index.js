/**
 * RamN AI — UserMap Store Lambda
 *
 * GET  /api/v2/usermap      -> returns persisted user map tree
 * POST /api/v2/usermap      -> upserts user map tree
 */

import { getUserMap, updateUserMap } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,GET,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(event, 200, {});

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        if (event.httpMethod === 'GET') {
            const userMap = await getUserMap(userId);
            return respond(event, 200, {
                userId,
                tree: userMap.tree || null,
                updatedAt: userMap.updatedAt || null
            });
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const tree = body?.tree;
            const expectedUpdatedAt = body?.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null;
            if (!tree || tree.id !== 'root') {
                return respond(event, 400, { error: 'Missing or invalid tree payload' });
            }

            const current = await getUserMap(userId);
            const currentUpdatedAt = current?.updatedAt ? String(current.updatedAt) : null;
            if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
                return respond(event, 409, {
                    error: 'Conflict',
                    message: 'UserMap has been updated from another session.',
                    currentTree: current.tree || null,
                    currentUpdatedAt
                });
            }

            await updateUserMap(userId, { tree });
            const updated = await getUserMap(userId);
            return respond(event, 200, {
                success: true,
                userId,
                updatedAt: updated?.updatedAt || null
            });
        }

        return respond(event, 405, { error: 'Method Not Allowed' });
    } catch (error) {
        console.error('USERMAP-STORE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to handle user map', message: error.message });
    }
};
