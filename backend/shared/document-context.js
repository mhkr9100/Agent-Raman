import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { listDocumentsByOwner } from './dynamo.js';

const DEFAULT_MAX_FILES = 3;
const DEFAULT_MAX_CHARS = 1800;

const s3Client = new S3Client({
    region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2'
});

async function streamToString(stream) {
    if (!stream) return '';
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function tokenizeSearch(input) {
    return String(input || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(Boolean)
        .filter(token => token.length > 2)
        .slice(0, 24);
}

function buildSnippet(text, queryTokens, maxChars) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (!queryTokens.length) return normalized.slice(0, maxChars);

    const lower = normalized.toLowerCase();
    let bestIndex = -1;
    for (const token of queryTokens) {
        const idx = lower.indexOf(token);
        if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
            bestIndex = idx;
        }
    }

    if (bestIndex === -1) return normalized.slice(0, maxChars);
    const start = Math.max(0, bestIndex - 280);
    const end = Math.min(normalized.length, bestIndex + maxChars);
    return normalized.slice(start, end);
}

export async function getRelevantDocumentContext({
    userId,
    agentId,
    query,
    maxFiles = DEFAULT_MAX_FILES,
    maxChars = DEFAULT_MAX_CHARS
}) {
    if (!userId) {
        return { documents: [], text: '', error: 'Missing user context for document retrieval.' };
    }

    const bucket = process.env.S3_BUCKET_NAME || '';
    if (!bucket) {
        return { documents: [], text: '', error: 'Document retrieval is unavailable because S3 bucket configuration is missing.' };
    }

    const docsFromAgent = agentId
        ? await listDocumentsByOwner(userId, 'agent', agentId)
        : [];
    const docsFromUser = await listDocumentsByOwner(userId, 'user', userId);
    const allDocs = [...docsFromAgent, ...docsFromUser];

    if (allDocs.length === 0) {
        return { documents: [], text: '' };
    }

    const queryTokens = tokenizeSearch(query);
    const hydrated = [];

    for (const doc of allDocs) {
        if (!doc?.textKey) continue;
        try {
            const result = await s3Client.send(new GetObjectCommand({
                Bucket: bucket,
                Key: doc.textKey
            }));
            const text = await streamToString(result.Body);
            if (!text.trim()) continue;

            const lower = text.toLowerCase();
            const score = queryTokens.length === 0
                ? 1
                : queryTokens.reduce((acc, token) => acc + (lower.includes(token) ? 1 : 0), 0);

            hydrated.push({
                doc,
                score,
                snippet: buildSnippet(text, queryTokens, maxChars)
            });
        } catch (error) {
            console.warn(`DOCUMENT-CONTEXT: Failed reading ${doc.docId}:`, error.message);
        }
    }

    if (hydrated.length === 0) {
        return {
            documents: [],
            text: '',
            error: 'Documents are registered, but parsed text payloads could not be loaded.'
        };
    }

    hydrated.sort((a, b) => b.score - a.score);
    const selected = hydrated.slice(0, maxFiles);

    const text = selected.map((item, index) => {
        const title = item.doc.fileName || `Document ${index + 1}`;
        return [
            `### ${title}`,
            `Relevance score: ${item.score}`,
            item.snippet
        ].join('\n');
    }).join('\n\n');

    return {
        documents: selected.map(item => item.doc),
        text
    };
}
