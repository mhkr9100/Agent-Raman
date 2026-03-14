/**
 * RamN AI — Vertex AI Connection Module
 *
 * Shared utility for all Lambda functions to call Google Vertex AI (Gemini).
 * Also provides text embedding helpers for semantic retrieval.
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCP_SERVICE_ACCOUNT_SECRET_ARN = process.env.GCP_SERVICE_ACCOUNT_SECRET_ARN || '';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-005';
const MAX_RETRIES = 3;
const SUPPORTED_VERTEX_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']);

const MODEL_TOKEN_LIMITS = {
    'gemini-2.5-flash-lite': 2048,
    'gemini-2.5-flash': 4096,
    'gemini-2.5-pro': 8192
};

let cachedGcpKey = null;
let cachedToken = null;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildModelUrl(modelName, mode = 'generate') {
    const suffix = mode === 'stream' ? ':streamGenerateContent?alt=sse' : ':generateContent';
    return `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${modelName}${suffix}`;
}

function validateRuntimeModel(modelName) {
    const model = modelName || DEFAULT_MODEL;
    if (!String(model).startsWith('gemini-')) {
        throw new Error(`[vertex-ai] Model "${model}" is not supported. Only Vertex Gemini models are allowed.`);
    }
    if (!SUPPORTED_VERTEX_MODELS.has(String(model))) {
        throw new Error(`[vertex-ai] Model "${model}" is not enabled. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`);
    }
    return model;
}

async function getServiceAccountKey() {
    if (cachedGcpKey) return cachedGcpKey;

    const keyFilePath = process.env.GCP_SERVICE_ACCOUNT_KEY_FILE;
    if (keyFilePath) {
        try {
            console.log(`[vertex-ai] Loading GCP key from local file: ${keyFilePath}`);
            const raw = readFileSync(keyFilePath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed.private_key && parsed.client_email) {
                cachedGcpKey = parsed;
                console.log('[vertex-ai] ✅ GCP key loaded from local file');
                return parsed;
            }
        } catch (err) {
            console.warn(`[vertex-ai] ⚠️ Could not load local key file: ${err.message}`);
        }
    }

    if (GCP_SERVICE_ACCOUNT_SECRET_ARN) {
        console.log('[vertex-ai] Fetching GCP service account key from Secrets Manager...');
        const client = new SecretsManagerClient({});
        const response = await client.send(new GetSecretValueCommand({ SecretId: GCP_SERVICE_ACCOUNT_SECRET_ARN }));

        if (response.SecretString) {
            try {
                const parsed = JSON.parse(response.SecretString);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    console.log('[vertex-ai] ✅ GCP key loaded (raw JSON)');
                    return parsed;
                }
            } catch {
                // continue
            }

            try {
                const decoded = Buffer.from(response.SecretString, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    console.log('[vertex-ai] ✅ GCP key loaded (base64)');
                    return parsed;
                }
            } catch {
                // continue
            }

            throw new Error('[vertex-ai] Could not parse a valid GCP service account key from Secrets Manager');
        }

        throw new Error('[vertex-ai] Secrets Manager returned no SecretString');
    }

    throw new Error('[vertex-ai] No credentials configured. Set GCP_SERVICE_ACCOUNT_KEY_FILE or GCP_SERVICE_ACCOUNT_SECRET_ARN');
}

async function getAccessToken() {
    const sa = await getServiceAccountKey();

    if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
        return cachedToken.token;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: sa.client_email,
        sub: sa.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform'
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signer = createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(sa.private_key, 'base64url');
    const jwt = `${signatureInput}.${signature}`;

    console.log('[vertex-ai] Exchanging JWT for OAuth2 access token...');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        throw new Error(`[vertex-ai] OAuth2 token exchange failed (${tokenResponse.status}): ${errText}`);
    }

    const tokenData = await tokenResponse.json();
    cachedToken = {
        token: tokenData.access_token,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
    };

    console.log('[vertex-ai] ✅ Access token acquired');
    return tokenData.access_token;
}

function normalizeHistoryMessage(msg) {
    if (!msg || !msg.content) return null;
    return {
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: String(msg.content) }]
    };
}

function normalizeUserParts(userParts = []) {
    return userParts
        .map((part) => {
            if (!part || typeof part !== 'object') return null;
            if (typeof part.text === 'string') return { text: part.text };
            if (part.inlineData?.mimeType && part.inlineData?.data) {
                return {
                    inlineData: {
                        mimeType: String(part.inlineData.mimeType),
                        data: String(part.inlineData.data)
                    }
                };
            }
            if (part.fileData?.mimeType && part.fileData?.fileUri) {
                return {
                    fileData: {
                        mimeType: String(part.fileData.mimeType),
                        fileUri: String(part.fileData.fileUri)
                    }
                };
            }
            return null;
        })
        .filter(Boolean);
}

function normalizeTools(tools = []) {
    if (!Array.isArray(tools) || tools.length === 0) return [];

    const normalized = [];
    const functionDeclarations = [];

    for (const tool of tools) {
        if (!tool || typeof tool !== 'object') continue;

        if (Array.isArray(tool.functionDeclarations)) {
            functionDeclarations.push(...tool.functionDeclarations.filter(Boolean));
            continue;
        }

        if (tool.googleSearch) {
            normalized.push({ googleSearch: {} });
            continue;
        }

        if (tool.retrieval) {
            normalized.push({ retrieval: tool.retrieval });
            continue;
        }

        if (tool.googleSearchRetrieval) {
            normalized.push({ googleSearchRetrieval: tool.googleSearchRetrieval });
            continue;
        }

        if (tool.name) {
            functionDeclarations.push(tool);
        }
    }

    if (functionDeclarations.length > 0) {
        normalized.unshift({ functionDeclarations });
    }

    return normalized;
}

function buildPayload({ systemPrompt, userMessage, history = [], userParts = [], tools, temperature, modelName }) {
    const contents = [];

    for (const message of history) {
        const normalized = normalizeHistoryMessage(message);
        if (normalized) contents.push(normalized);
    }

    const currentParts = [];
    if (userMessage) currentParts.push({ text: userMessage });
    currentParts.push(...normalizeUserParts(userParts));

    if (currentParts.length > 0) {
        contents.push({ role: 'user', parts: currentParts });
    }

    const payload = {
        contents,
        generationConfig: {
            temperature: temperature ?? DEFAULT_TEMPERATURE,
            topP: 0.95,
            maxOutputTokens: MODEL_TOKEN_LIMITS[modelName] || 4096
        }
    };

    if (systemPrompt) {
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const normalizedTools = normalizeTools(tools);
    if (normalizedTools.length > 0) {
        payload.tools = normalizedTools;
    }

    return payload;
}

function parseResponse(data) {
    const result = {
        text: '',
        toolCalls: [],
        usage: data.usageMetadata || null
    };

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
        return result;
    }

    for (const part of candidate.content.parts) {
        if (part.text) {
            result.text += part.text;
        }
        if (part.functionCall) {
            result.toolCalls.push({
                id: part.functionCall.name,
                name: part.functionCall.name,
                args: part.functionCall.args || {}
            });
        }
    }

    return result;
}

function parseStreamChunk(data) {
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const chunk = {
        textDelta: '',
        toolCalls: [],
        usage: data.usageMetadata || null
    };

    for (const part of parts) {
        if (part.text) {
            chunk.textDelta += part.text;
        }
        if (part.functionCall?.name) {
            chunk.toolCalls.push({
                id: part.functionCall.name,
                name: part.functionCall.name,
                args: part.functionCall.args || {}
            });
        }
    }

    return chunk;
}

async function performVertexFetch(url, accessToken, payload) {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify(payload)
    });
}

async function sendVertexRequest(payload, modelName) {
    const model = validateRuntimeModel(modelName);
    await getServiceAccountKey();

    let accessToken = await getAccessToken();
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[vertex-ai] Request → model: ${model}, mode: Vertex, attempt: ${attempt}/${MAX_RETRIES}`);
            const response = await performVertexFetch(buildModelUrl(model, 'generate'), accessToken, payload);

            if (response.ok) {
                const data = await response.json();
                const parsed = parseResponse(data);
                console.log(`[vertex-ai] ✅ Response received — ${parsed.text.length} chars, ${parsed.toolCalls.length} tool calls`);
                return parsed;
            }

            const status = response.status;
            const errText = await response.text();
            let errorData = {};
            try { errorData = JSON.parse(errText); } catch { }

            if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                console.warn(`[vertex-ai] ⚠️ ${status} on attempt ${attempt}, retrying in ${Math.round(delay / 1000)}s...`);
                await sleep(delay);
                continue;
            }

            if (status === 401 && attempt < MAX_RETRIES) {
                console.warn('[vertex-ai] ⚠️ 401 Unauthorized — clearing token cache and retrying...');
                cachedToken = null;
                accessToken = await getAccessToken();
                continue;
            }

            throw new Error(`Vertex AI API error (${status}): ${JSON.stringify(errorData.error || errText).substring(0, 300)}`);
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && !String(error.message || '').includes('API error')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[vertex-ai] ⚠️ Error on attempt ${attempt}: ${error.message}. Retrying in ${delay / 1000}s...`);
                await sleep(delay);
                continue;
            }
        }
    }

    console.error(`[vertex-ai] ❌ All ${MAX_RETRIES} attempts failed`);
    throw lastError;
}

function readSseEvents(buffer) {
    const normalized = buffer.replace(/\r\n/g, '\n');
    const blocks = normalized.split('\n\n');
    const remainder = blocks.pop() || '';
    const events = [];

    for (const block of blocks) {
        const dataLines = block
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .filter(Boolean);

        if (dataLines.length === 0) continue;
        events.push(dataLines.join('\n'));
    }

    return { events, remainder };
}

async function sendVertexStreamRequest(payload, modelName, { onTextDelta, onToolCall } = {}) {
    const model = validateRuntimeModel(modelName);
    await getServiceAccountKey();

    let accessToken = await getAccessToken();
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[vertex-ai] Stream request → model: ${model}, attempt: ${attempt}/${MAX_RETRIES}`);
            const response = await performVertexFetch(buildModelUrl(model, 'stream'), accessToken, payload);

            if (!response.ok) {
                const status = response.status;
                const errText = await response.text();
                let errorData = {};
                try { errorData = JSON.parse(errText); } catch { }

                if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                    console.warn(`[vertex-ai] ⚠️ Stream ${status} on attempt ${attempt}, retrying in ${Math.round(delay / 1000)}s...`);
                    await sleep(delay);
                    continue;
                }

                if (status === 401 && attempt < MAX_RETRIES) {
                    console.warn('[vertex-ai] ⚠️ Stream 401 Unauthorized — clearing token cache and retrying...');
                    cachedToken = null;
                    accessToken = await getAccessToken();
                    continue;
                }

                throw new Error(`Vertex AI API error (${status}): ${JSON.stringify(errorData.error || errText).substring(0, 300)}`);
            }

            if (!response.body) {
                throw new Error('Vertex stream response did not include a body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const seenToolCalls = new Set();
            const aggregated = {
                text: '',
                toolCalls: [],
                usage: null
            };

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parsed = readSseEvents(buffer);
                buffer = parsed.remainder;

                for (const eventPayload of parsed.events) {
                    if (!eventPayload || eventPayload === '[DONE]') continue;

                    let data;
                    try {
                        data = JSON.parse(eventPayload);
                    } catch {
                        continue;
                    }

                    const chunk = parseStreamChunk(data);
                    if (chunk.textDelta) {
                        aggregated.text += chunk.textDelta;
                        if (onTextDelta) await onTextDelta(chunk.textDelta, data);
                    }

                    if (chunk.usage) {
                        aggregated.usage = chunk.usage;
                    }

                    for (const toolCall of chunk.toolCalls) {
                        const key = `${toolCall.name}:${JSON.stringify(toolCall.args || {})}`;
                        if (seenToolCalls.has(key)) continue;
                        seenToolCalls.add(key);
                        aggregated.toolCalls.push(toolCall);
                        if (onToolCall) await onToolCall(toolCall, data);
                    }
                }
            }

            console.log(`[vertex-ai] ✅ Stream completed — ${aggregated.text.length} chars, ${aggregated.toolCalls.length} tool calls`);
            return aggregated;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && !String(error.message || '').includes('API error')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[vertex-ai] ⚠️ Stream error on attempt ${attempt}: ${error.message}. Retrying in ${delay / 1000}s...`);
                await sleep(delay);
                continue;
            }
        }
    }

    console.error(`[vertex-ai] ❌ Stream failed after ${MAX_RETRIES} attempts`);
    throw lastError;
}

async function sendEmbeddingRequest(texts, modelName = DEFAULT_EMBEDDING_MODEL) {
    const normalized = (Array.isArray(texts) ? texts : [texts])
        .map((text) => String(text || '').trim())
        .filter(Boolean);

    if (normalized.length === 0) return [];

    await getServiceAccountKey();
    const accessToken = await getAccessToken();
    const url = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${modelName}:predict`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            instances: normalized.map((content) => ({ content }))
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Embedding API error (${response.status}): ${errText.substring(0, 300)}`);
    }

    const data = await response.json();
    const predictions = Array.isArray(data.predictions) ? data.predictions : [];
    return predictions.map((prediction) => prediction?.embeddings?.values || []);
}

export function cosineSimilarity(a = [], b = []) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0 || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let index = 0; index < a.length; index++) {
        const valueA = Number(a[index]) || 0;
        const valueB = Number(b[index]) || 0;
        dot += valueA * valueB;
        normA += valueA * valueA;
        normB += valueB * valueB;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function embedText(text, modelName = DEFAULT_EMBEDDING_MODEL) {
    const [embedding] = await sendEmbeddingRequest([text], modelName);
    return embedding || [];
}

export async function embedTexts(texts, modelName = DEFAULT_EMBEDDING_MODEL) {
    return sendEmbeddingRequest(texts, modelName);
}

export async function callAI({
    systemPrompt,
    userMessage,
    history = [],
    userParts = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE
}) {
    if (!userMessage && history.length === 0 && userParts.length === 0) {
        throw new Error('[vertex-ai] callAI requires at least userMessage, userParts, or history');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, userParts, tools, temperature, modelName });
    return sendVertexRequest(payload, modelName);
}

export async function callAIStream({
    systemPrompt,
    userMessage,
    history = [],
    userParts = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    onTextDelta,
    onToolCall
}) {
    if (!userMessage && history.length === 0 && userParts.length === 0) {
        throw new Error('[vertex-ai] callAIStream requires at least userMessage, userParts, or history');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, userParts, tools, temperature, modelName });
    return sendVertexStreamRequest(payload, modelName, { onTextDelta, onToolCall });
}

export async function callAIWithTools({
    systemPrompt,
    userMessage,
    history = [],
    userParts = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE
}) {
    if (!tools || tools.length === 0) {
        throw new Error('[vertex-ai] callAIWithTools requires at least one tool definition');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, userParts, tools, temperature, modelName });
    return sendVertexRequest(payload, modelName);
}

export async function callAIWithToolsStream({
    systemPrompt,
    userMessage,
    history = [],
    userParts = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE,
    onTextDelta,
    onToolCall
}) {
    if (!tools || tools.length === 0) {
        throw new Error('[vertex-ai] callAIWithToolsStream requires at least one tool definition');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, userParts, tools, temperature, modelName });
    return sendVertexStreamRequest(payload, modelName, { onTextDelta, onToolCall });
}

export default {
    callAI,
    callAIStream,
    callAIWithTools,
    callAIWithToolsStream,
    embedText,
    embedTexts,
    cosineSimilarity
};
