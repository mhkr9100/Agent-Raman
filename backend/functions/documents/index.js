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

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,GET,POST,DELETE'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
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
    if (event.httpMethod === 'OPTIONS') return respond(event, 200, {});

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
            return respond(event, 200, { documents });
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

            if (!fileName) return respond(event, 400, { error: 'fileName is required' });
            if (!fileKey) return respond(event, 400, { error: 'fileKey is required' });

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

            return respond(event, 200, { document });
        }

        if (event.httpMethod === 'DELETE') {
            const docId = String(event.pathParameters?.docId || '').trim();
            if (!docId) return respond(event, 400, { error: 'docId is required' });

            const existing = await getDocument(docId, userId);
            if (!existing) return respond(event, 404, { error: 'Document not found' });

            await deleteDocument(docId, userId);
            return respond(event, 200, { success: true, docId });
        }

        return respond(event, 405, { error: 'Method Not Allowed' });
    } catch (error) {
        console.error('DOCUMENTS: ❌ Error:', error);
        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }
        return respond(event, 500, { error: 'Failed to handle documents', message: error.message });
    }
};
