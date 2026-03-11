/**
 * RamN AI — Documents Registry
 *
 * POST   /api/v2/documents/register
 * GET    /api/v2/documents?ownerType=<agent|user>&ownerId=<id>
 * DELETE /api/v2/documents/{docId}
 */

import {
    saveDocument,
    listDocumentsByOwner,
    getDocument,
    deleteDocument
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

function respond(statusCode, body, eventHeaders) {
    return { statusCode, headers: buildCorsHeaders(eventHeaders, 'OPTIONS,GET,POST,DELETE'), body: JSON.stringify(body) };
}

function parseOwner(ownerType, ownerId) {
    const normalizedType = String(ownerType || '').trim().toLowerCase();
    const normalizedOwnerId = String(ownerId || '').trim();
    if (!['agent', 'user'].includes(normalizedType)) {
        throw new Error('ownerType must be "agent" or "user"');
    }
    if (!normalizedOwnerId) {
        throw new Error('ownerId is required');
    }
    return { ownerType: normalizedType, ownerId: normalizedOwnerId };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return respond(200, {}, event.headers);

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        if (event.httpMethod === 'GET') {
            const { ownerType, ownerId } = parseOwner(
                event.queryStringParameters?.ownerType,
                event.queryStringParameters?.ownerId
            );
            const documents = await listDocumentsByOwner(userId, ownerType, ownerId);
            return respond(200, { documents }, event.headers);
        }

        if (event.httpMethod === 'POST') {
            const body = JSON.parse(event.body || '{}');
            const { ownerType, ownerId } = parseOwner(body.ownerType, body.ownerId);
            const fileName = String(body.fileName || '').trim();
            const fileKey = String(body.fileKey || '').trim();
            const fileUrl = body.fileUrl ? String(body.fileUrl) : null;
            const textKey = body.textKey ? String(body.textKey).trim() : null;
            const textUrl = body.textUrl ? String(body.textUrl) : null;
            const contentType = body.contentType ? String(body.contentType).trim() : 'application/octet-stream';
            const size = Number(body.size || 0);

            if (!fileName) return respond(400, { error: 'fileName is required' }, event.headers);
            if (!fileKey) return respond(400, { error: 'fileKey is required' }, event.headers);

            const docId = crypto.randomUUID();
            const document = await saveDocument({
                docId,
                userId,
                ownerType,
                ownerId,
                fileName,
                fileKey,
                fileUrl,
                textKey,
                textUrl,
                contentType,
                size
            });

            return respond(200, { document }, event.headers);
        }

        if (event.httpMethod === 'DELETE') {
            const docId = String(event.pathParameters?.docId || '').trim();
            if (!docId) return respond(400, { error: 'docId is required' }, event.headers);

            const existing = await getDocument(docId, userId);
            if (!existing) return respond(404, { error: 'Document not found' }, event.headers);

            await deleteDocument(docId, userId);
            return respond(200, { success: true, docId }, event.headers);
        }

        return respond(405, { error: 'Method Not Allowed' }, event.headers);
    } catch (error) {
        console.error('DOCUMENTS: ❌ Error:', error.message);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }
        return respond(500, { error: 'An internal error occurred. Please try again.' }, event.headers);
    }
};
