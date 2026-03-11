import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import * as crypto from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { buildCorsHeaders, requireAuth } from './security.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME || 'RamN-Entities';
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';

function apiError(statusCode: number, message: string): APIGatewayProxyResult {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: message }) };
}

function apiSuccess(data: any): APIGatewayProxyResult {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

// ─── Decode Service Account Key ───
const GCP_SERVICE_ACCOUNT_SECRET_ARN = process.env.GCP_SERVICE_ACCOUNT_SECRET_ARN || '';

let cachedGcpKey: any = null;

async function getServiceAccountKey(): Promise<any | null> {
    if (cachedGcpKey) return cachedGcpKey;
    if (!GCP_SERVICE_ACCOUNT_SECRET_ARN) return null;

    try {
        const client = new SecretsManagerClient({});
        const response = await client.send(new GetSecretValueCommand({ SecretId: GCP_SERVICE_ACCOUNT_SECRET_ARN }));
        if (response.SecretString) {
            let secretString = response.SecretString;
            try {
                const parsed = JSON.parse(secretString);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    return parsed;
                }
            } catch { /* not raw JSON */ }
            try {
                const decoded = Buffer.from(secretString, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    return parsed;
                }
            } catch { /* base64 failed */ }
        }
    } catch (error) {
        console.error('[AI Proxy] Failed to fetch GCP key from Secrets Manager', error);
    }
    return null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;
async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) return cachedToken.token;
    const sa = await getServiceAccountKey();
    if (!sa) throw new Error('No valid GCP service account key available');

    const { client_email, private_key } = sa;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: client_email, sub: client_email, aud: 'https://oauth2.googleapis.com/token',
        iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/cloud-platform'
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(private_key, 'base64url');
    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!res.ok) throw new Error(`OAuth2 token exchange failed: ${res.status}`);
    const data = await res.json() as any;
    cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return data.access_token;
}

/**
 * Generate text embedding using Vertex AI text-embedding-004
 * Uses the REST API directly (no SDK dependency needed)
 */
async function getEmbedding(text: string): Promise<number[]> {
    const accessToken = await getAccessToken();
    const url = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/text-embedding-004:predict`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            instances: [{ content: text }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[Embedding Error - Vertex AI]', err);
        throw new Error(`Embedding API error: ${response.status}`);
    }

    const data = await response.json();
    return data.predictions?.[0]?.embeddings?.values || [];
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: buildCorsHeaders(event.headers, 'OPTIONS,POST'), body: '' };
    }

    try {
        const auth = await requireAuth(event.headers);
        const userId = auth.userId;

        const reqContext = event.requestContext as any;
        const path = reqContext?.http?.path || event.path;

        if (event.httpMethod === 'POST') {
            if (path.endsWith('/add')) return await handleAdd(event, userId);
            if (path.endsWith('/search')) return await handleSearch(event, userId);
        }

        return { ...apiError(404, 'Not Found'), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    } catch (error: any) {
        console.error('Memory Error:', error);
        const status = (error.message || '').startsWith('Unauthorized') ? 401 : 500;
        const safeMessage = status === 401 ? 'Unauthorized' : 'An internal error occurred. Please try again.';
        return { ...apiError(status, safeMessage), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    }
};

/**
 * POST /api/memory/add
 * { userId, content, agentId?, category? }
 * Embeds the content using Vertex AI and stores with embedding in DynamoDB
 */
async function handleAdd(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { content, agentId, category } = body;

    if (!content) {
        return { ...apiError(400, 'Missing content'), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    }

    // Generate embedding
    let embedding: number[] = [];
    try {
        embedding = await getEmbedding(content);
    } catch (e: any) {
        console.error('[Embedding failed, storing without]', e.message);
    }

    const memoryId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pk = `USER#${userId}`;
    const sk = `memories#${memoryId}`;

    await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
            PK: pk,
            SK: sk,
            storeName: 'memories',
            originalId: memoryId,
            data: {
                id: memoryId,
                userId,
                agentId: agentId || null,
                content,
                category: category || 'general',
                embedding,
                createdAt: new Date().toISOString()
            },
            updatedAt: new Date().toISOString()
        }
    }));

    return { ...apiSuccess({ success: true, memoryId, hasEmbedding: embedding.length > 0 }), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
}

/**
 * POST /api/memory/search
 * { userId, query, limit? }
 * Embeds the query, fetches all user memories, does cosine similarity, returns top K
 */
async function handleSearch(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
    const body = JSON.parse((event as any).body || '{}');
    const { query, limit = 5 } = body;

    if (!query) {
        return { ...apiError(400, 'Missing query'), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    }

    // Embed the query
    let queryEmbedding: number[] = [];
    try {
        queryEmbedding = await getEmbedding(query);
    } catch (e: any) {
        console.error('[Query embedding failed]', e.message);
        return { ...apiError(500, 'Failed to embed query'), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    }

    // Fetch all user memories
    const pk = `USER#${userId}`;
    const response = await docClient.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
            ':pk': pk,
            ':skPrefix': 'memories#'
        }
    }));

    const items = response.Items || [];
    if (items.length === 0) {
        return { ...apiSuccess({ results: [], count: 0 }), headers: buildCorsHeaders(event.headers, 'OPTIONS,POST') };
    }

    // Compute similarity and rank
    const scored = items
        .filter(item => item.data?.embedding?.length > 0)
        .map(item => ({
            content: item.data.content,
            category: item.data.category,
            score: cosineSimilarity(queryEmbedding, item.data.embedding),
            createdAt: item.data.createdAt
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    // Also include recent items without embeddings (fallback)
    const noEmbedding = items
        .filter(item => !item.data?.embedding?.length)
        .sort((a, b) => (b.data?.createdAt || '').localeCompare(a.data?.createdAt || ''))
        .slice(0, 3)
        .map(item => ({
            content: item.data.content,
            category: item.data.category,
            score: 0,
            createdAt: item.data.createdAt
        }));

    return {
        ...apiSuccess({
        results: [...scored, ...noEmbedding].slice(0, limit),
        count: items.length
        }),
        headers: buildCorsHeaders(event.headers, 'OPTIONS,POST')
    };
}
