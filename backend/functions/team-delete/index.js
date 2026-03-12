/**
 * RamN AI — Team Delete Lambda
 *
 * DELETE /api/v2/teams/{teamId}
 */

import { deleteTeam, getTeam } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,DELETE'),
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

        const teamId = String(event.pathParameters?.teamId || '').trim();
        if (!teamId) return respond(event, 400, { error: 'teamId is required' });

        const existing = await getTeam(teamId, userId);
        if (!existing) {
            return respond(event, 404, { error: 'Team not found for this user', teamId });
        }

        await deleteTeam(teamId, userId);
        return respond(event, 200, { success: true, teamId });
    } catch (error) {
        console.error('TEAM-DELETE: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to delete team', message: error.message });
    }
};
