/**
 * RamN AI — UserMap Store Lambda
 *
 * GET  /api/v2/usermap      -> returns persisted user map tree
 * POST /api/v2/usermap      -> upserts user map tree
 */

import { getUserMap, updateUserMap } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(statusCode, body, eventHeaders) {
    return { statusCode, headers: buildCorsHeaders(eventHeaders, 'OPTIONS,GET,POST'), body: JSON.stringify(body) };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {}, event.headers);

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        if (event.httpMethod === 'GET') {
            const userMap = await getUserMap(userId);
            return respond(200, {
                userId,
                tree: userMap.tree || null,
                updatedAt: userMap.updatedAt || null
            }, event.headers);
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const tree = body?.tree;
            const expectedUpdatedAt = body?.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null;
            if (!tree || tree.id !== 'root') {
                return respond(400, { error: 'Missing or invalid tree payload' }, event.headers);
            }

            const current = await getUserMap(userId);
            const currentUpdatedAt = current?.updatedAt ? String(current.updatedAt) : null;
            if (expectedUpdatedAt && currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
                return respond(409, {
                    error: 'Conflict',
                    message: 'UserMap has been updated from another session.',
                    currentTree: current.tree || null,
                    currentUpdatedAt
                }, event.headers);
            }

            await updateUserMap(userId, { tree });
            const updated = await getUserMap(userId);
            return respond(200, {
                success: true,
                userId,
                updatedAt: updated?.updatedAt || null
            }, event.headers);
        }

        return respond(405, { error: 'Method Not Allowed' }, event.headers);
    } catch (error) {
        console.error('USERMAP-STORE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }
        return respond(500, { error: 'Failed to handle user map', message: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
