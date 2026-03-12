/**
 * RamN AI — Team Upsert Lambda
 *
 * POST /api/v2/teams
 */

import { saveTeam } from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,POST'),
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

        const body = JSON.parse(event.body || '{}');
        const name = String(body.name || '').trim();
        const description = String(body.description || '').trim();
        const requestedTeamId = body.teamId ? String(body.teamId).trim() : '';
        const agentIds = Array.isArray(body.agentIds)
            ? Array.from(new Set(body.agentIds.map((id) => String(id).trim()).filter(Boolean)))
            : [];

        if (!name) {
            return respond(event, 400, { error: 'name is required' });
        }

        let teamId = requestedTeamId;
        if (!teamId) {
            teamId = crypto.randomUUID();
        }

        await saveTeam({
            teamId,
            userId,
            name,
            description,
            agentIds,
            status: 'active'
        });

        return respond(event, 200, {
            team: {
                teamId,
                userId,
                name,
                description,
                agentIds,
                status: 'active'
            }
        });
    } catch (error) {
        console.error('TEAM-UPSERT: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to save team', message: error.message });
    }
};
