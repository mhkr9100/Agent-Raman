import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
    listDocumentsByOwner,
    listDocumentChunksByOwnerKey,
    listDocumentChunksByDocId
} from './dynamo.js';
import { embedText, cosineSimilarity } from './vertex-ai.js';

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
        .filter((token) => token.length > 2)
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

function buildOwnerKeys(userId, agentId) {
    const ownerKeys = [`${userId}#user#${userId}`];
    if (agentId) ownerKeys.unshift(`${userId}#agent#${agentId}`);
    return ownerKeys;
}

function uniqueBy(items, keyFn) {
    const seen = new Set();
    const unique = [];
    for (const item of items) {
        const key = keyFn(item);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(item);
    }
    return unique;
}

function scoreSemanticChunk(chunk, queryEmbedding, { focusDocumentIds = [], agentId } = {}) {
    let score = 0;
    if (Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
        score += cosineSimilarity(queryEmbedding, chunk.embedding || []);
    }
    if (focusDocumentIds.includes(chunk.docId)) score += 0.18;
    if (agentId && chunk.ownerType === 'agent' && chunk.ownerId === agentId) score += 0.08;

    const createdAt = Date.parse(chunk.createdAt || '');
    if (Number.isFinite(createdAt)) {
        const ageHours = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60));
        score += Math.max(0, 0.05 - (ageHours / 24_000));
    }

    return score;
}

async function getSemanticDocumentContext({
    userId,
    agentId,
    query,
    documents,
    focusDocumentIds = [],
    maxFiles,
    maxChars
}) {
    const ownerKeys = buildOwnerKeys(userId, agentId);
    const focusIds = Array.isArray(focusDocumentIds)
        ? focusDocumentIds.map((docId) => String(docId || '').trim()).filter(Boolean)
        : [];

    const ownerChunkSets = await Promise.all(ownerKeys.map((ownerKey) => listDocumentChunksByOwnerKey(ownerKey, { limit: 120 })));
    const focusChunkSets = await Promise.all(focusIds.map((docId) => listDocumentChunksByDocId(docId, { limit: 12 })));

    const chunks = uniqueBy(
        [...ownerChunkSets.flat(), ...focusChunkSets.flat()].filter(Boolean),
        (chunk) => chunk.chunkId
    );

    if (chunks.length === 0) {
        return { documents: [], text: '' };
    }

    let queryEmbedding = [];
    if (String(query || '').trim()) {
        try {
            queryEmbedding = await embedText(query);
        } catch (error) {
            console.warn('DOCUMENT-CONTEXT: Semantic query embedding failed:', error.message);
        }
    }

    const scored = chunks
        .map((chunk) => ({
            ...chunk,
            _score: scoreSemanticChunk(chunk, queryEmbedding, { focusDocumentIds: focusIds, agentId })
        }))
        .sort((a, b) => b._score - a._score);

    const selected = [];
    const selectedDocIds = new Set();
    for (const chunk of scored) {
        if (selected.length >= Math.max(4, maxFiles)) break;
        if (selectedDocIds.size >= maxFiles && !selectedDocIds.has(chunk.docId)) continue;
        selected.push(chunk);
        selectedDocIds.add(chunk.docId);
    }

    if (selected.length === 0) {
        return { documents: [], text: '' };
    }

    const documentMap = new Map((documents || []).map((document) => [document.docId, document]));
    const text = selected.map((chunk, index) => {
        const document = documentMap.get(chunk.docId);
        const title = document?.fileName || chunk.fileName || `Document ${index + 1}`;
        return [
            `### ${title}`,
            `Semantic score: ${chunk._score.toFixed(3)}`,
            String(chunk.text || '').slice(0, maxChars)
        ].join('\n');
    }).join('\n\n');

    const semanticDocuments = Array.from(selectedDocIds)
        .map((docId) => documentMap.get(docId))
        .filter(Boolean);

    return {
        documents: semanticDocuments,
        text,
        strategy: 'semantic'
    };
}

async function getKeywordFallbackContext({
    bucket,
    documents,
    query,
    maxFiles,
    maxChars,
    focusDocumentIds = []
}) {
    const filteredDocuments = Array.isArray(focusDocumentIds) && focusDocumentIds.length > 0
        ? documents.filter((doc) => focusDocumentIds.includes(doc.docId))
        : documents;

    if (filteredDocuments.length === 0) {
        return { documents: [], text: '' };
    }

    const queryTokens = tokenizeSearch(query);
    const hydrated = [];

    for (const doc of filteredDocuments) {
        if (!doc?.textKey) continue;
        try {
            const result = await s3Client.send(new GetObjectCommand({
                Bucket: bucket,
                Key: doc.textKey
            }));
            const text = await streamToString(result.Body);
            if (!text.trim()) continue;

            const lower = text.toLowerCase();
            let score = queryTokens.length === 0
                ? 1
                : queryTokens.reduce((acc, token) => acc + (lower.includes(token) ? 1 : 0), 0);
            if (Array.isArray(focusDocumentIds) && focusDocumentIds.includes(doc.docId)) score += 3;

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
            `Keyword score: ${item.score}`,
            item.snippet
        ].join('\n');
    }).join('\n\n');

    return {
        documents: selected.map((item) => item.doc),
        text,
        strategy: 'keyword'
    };
}

export async function getRelevantDocumentContext({
    userId,
    agentId,
    query,
    focusDocumentIds = [],
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

    try {
        const semantic = await getSemanticDocumentContext({
            userId,
            agentId,
            query,
            documents: allDocs,
            focusDocumentIds,
            maxFiles,
            maxChars
        });
        if (semantic.text) return semantic;
    } catch (error) {
        console.warn('DOCUMENT-CONTEXT: Semantic retrieval failed, falling back to keyword snippets:', error.message);
    }

    return getKeywordFallbackContext({
        bucket,
        documents: allDocs,
        query,
        focusDocumentIds,
        maxFiles,
        maxChars
    });
}
