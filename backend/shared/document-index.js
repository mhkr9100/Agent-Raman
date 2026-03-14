import crypto from 'crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { embedTexts } from './vertex-ai.js';
import { saveDocumentChunks, deleteDocumentChunksByDocId } from './dynamo.js';

const s3Client = new S3Client({
    region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2'
});

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 220;
const MAX_CHUNKS = 48;
const EMBEDDING_BATCH_SIZE = 8;

async function streamToString(stream) {
    if (!stream) return '';
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf-8');
}

function normalizeText(text) {
    return String(text || '')
        .replace(/\u0000/g, '')
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[\t ]+/g, ' ')
        .trim();
}

function chooseChunkEnd(text, start, suggestedEnd) {
    if (suggestedEnd >= text.length) return text.length;

    const paragraphBreak = text.lastIndexOf('\n\n', suggestedEnd);
    if (paragraphBreak > start + Math.floor(CHUNK_TARGET_CHARS * 0.55)) {
        return paragraphBreak + 2;
    }

    const sentenceBreak = Math.max(
        text.lastIndexOf('. ', suggestedEnd),
        text.lastIndexOf('? ', suggestedEnd),
        text.lastIndexOf('! ', suggestedEnd)
    );
    if (sentenceBreak > start + Math.floor(CHUNK_TARGET_CHARS * 0.45)) {
        return sentenceBreak + 1;
    }

    const whitespaceBreak = text.lastIndexOf(' ', suggestedEnd);
    if (whitespaceBreak > start + Math.floor(CHUNK_TARGET_CHARS * 0.65)) {
        return whitespaceBreak;
    }

    return suggestedEnd;
}

export function chunkDocumentText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return [];

    const chunks = [];
    let start = 0;

    while (start < normalized.length && chunks.length < MAX_CHUNKS) {
        const proposedEnd = Math.min(normalized.length, start + CHUNK_TARGET_CHARS);
        const end = chooseChunkEnd(normalized, start, proposedEnd);
        const chunkText = normalized.slice(start, end).trim();

        if (!chunkText) break;

        chunks.push({
            chunkIndex: chunks.length,
            text: chunkText,
            charStart: start,
            charEnd: end
        });

        if (end >= normalized.length) break;
        const nextStart = Math.max(end - CHUNK_OVERLAP_CHARS, start + 1);
        start = nextStart;
    }

    return chunks;
}

async function loadDocumentText(textKey) {
    const bucket = process.env.S3_BUCKET_NAME || '';
    if (!bucket) {
        throw new Error('S3 bucket is not configured for document indexing.');
    }
    if (!textKey) {
        throw new Error('Document textKey is required for semantic indexing.');
    }

    const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: textKey
    }));

    const text = await streamToString(response.Body);
    return normalizeText(text);
}

async function embedChunkTexts(chunks) {
    const embeddings = [];
    for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
        const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
        const batchEmbeddings = await embedTexts(batch.map((chunk) => chunk.text));
        embeddings.push(...batchEmbeddings);
    }
    return embeddings;
}

export async function indexRegisteredDocument(document) {
    const sourceText = await loadDocumentText(document.textKey);
    const chunks = chunkDocumentText(sourceText);

    if (chunks.length === 0) {
        throw new Error(`Document "${document.fileName}" does not contain any indexable text.`);
    }

    const embeddings = await embedChunkTexts(chunks);
    await deleteDocumentChunksByDocId(document.docId);

    const records = chunks.map((chunk, index) => ({
        chunkId: `${document.docId}#${index}#${crypto.randomUUID()}`,
        docId: document.docId,
        userId: document.userId,
        ownerType: document.ownerType,
        ownerId: document.ownerId,
        fileName: document.fileName,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        embedding: Array.isArray(embeddings[index]) ? embeddings[index] : [],
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        createdAt: document.createdAt || new Date().toISOString()
    }));

    await saveDocumentChunks(records);

    return {
        chunkCount: records.length,
        indexedChars: sourceText.length
    };
}
