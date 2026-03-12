/**
 * RamN AI — Vertex AI Connection Module
 * 
 * Shared utility for all Lambda functions to call Google Vertex AI (Gemini).
 * Uses the same GCP service account authentication as ai-proxy.ts:
 *   1. Reads GCP service account key from AWS Secrets Manager (Lambda)
 *      OR from a local JSON file (local dev/testing)
 *   2. Generates OAuth2 access token via JWT assertion
 *   3. Calls Vertex AI REST API
 * 
 * Environment Variables:
 *   GCP_PROJECT_ID                - Google Cloud project ID (default: 'ramn-ai')
 *   GCP_LOCATION                  - GCP region (default: 'us-central1')
 *   GCP_SERVICE_ACCOUNT_SECRET_ARN - ARN of Secrets Manager secret (Lambda mode)
 *   GCP_SERVICE_ACCOUNT_KEY_FILE   - Path to local JSON key file (local dev mode)
 */

import { createSign } from 'crypto';
import { readFileSync } from 'fs';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// ─── Configuration ───────────────────────────────────────────────

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCP_SERVICE_ACCOUNT_SECRET_ARN = process.env.GCP_SERVICE_ACCOUNT_SECRET_ARN || '';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_TEMPERATURE = 0.3;
const MAX_RETRIES = 3;
const SUPPORTED_VERTEX_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']);

// ─── Cached Credentials ─────────────────────────────────────────

let cachedGcpKey = null;
let cachedToken = null; // { token: string, expiresAt: number }

// ─── GCP Service Account Key (from AWS Secrets Manager) ─────────

async function getServiceAccountKey() {
    if (cachedGcpKey) return cachedGcpKey;

    // ── MODE 1: Local file (for dev/testing) ──
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

    // ── MODE 2: AWS Secrets Manager (for Lambda) ──
    if (GCP_SERVICE_ACCOUNT_SECRET_ARN) {
        console.log('[vertex-ai] Fetching GCP service account key from Secrets Manager...');

        const client = new SecretsManagerClient({});
        const response = await client.send(
            new GetSecretValueCommand({ SecretId: GCP_SERVICE_ACCOUNT_SECRET_ARN })
        );

        if (response.SecretString) {
            // Try parsing as raw JSON first
            try {
                const parsed = JSON.parse(response.SecretString);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    console.log('[vertex-ai] ✅ GCP key loaded (raw JSON)');
                    return parsed;
                }
            } catch { /* not raw JSON */ }

            // Try Base64 decoding
            try {
                const decoded = Buffer.from(response.SecretString, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    console.log('[vertex-ai] ✅ GCP key loaded (base64)');
                    return parsed;
                }
            } catch { /* not base64 JSON */ }

            throw new Error('[vertex-ai] Could not parse a valid GCP service account key from Secrets Manager');
        } else {
            throw new Error('[vertex-ai] Secrets Manager returned no SecretString');
        }
    }

    throw new Error('[vertex-ai] No credentials configured. Set GCP_SERVICE_ACCOUNT_KEY_FILE or GCP_SERVICE_ACCOUNT_SECRET_ARN');
}

// ─── OAuth2 Access Token via JWT Assertion ──────────────────────

async function getAccessToken() {
    const sa = await getServiceAccountKey();

    // Return cached token if still valid (with 60s buffer)
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

// ─── Build Vertex AI Request Payload ────────────────────────────

const MODEL_TOKEN_LIMITS = {
    'gemini-2.5-flash-lite': 2048,
    'gemini-2.5-flash': 4096,
    'gemini-2.5-pro': 8192
};

function buildPayload({ systemPrompt, userMessage, history = [], tools, temperature, modelName }) {
    const contents = [];

    // Convert history: [{role: 'user'|'model', content: string}] → Vertex format
    for (const msg of history) {
        contents.push({
            role: msg.role === 'assistant' ? 'model' : msg.role,
            parts: [{ text: msg.content }]
        });
    }

    // Append current user message
    if (userMessage) {
        contents.push({
            role: 'user',
            parts: [{ text: userMessage }]
        });
    }

    const payload = {
        contents,
        generationConfig: {
            temperature: temperature ?? DEFAULT_TEMPERATURE,
            topP: 0.95,
            maxOutputTokens: MODEL_TOKEN_LIMITS[modelName] || 4096
        }
    };

    // System instruction
    if (systemPrompt) {
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    // Tool definitions for function calling
    if (tools && tools.length > 0) {
        payload.tools = [{ functionDeclarations: tools }];
    }

    return payload;
}

// ─── Parse Vertex AI Response ───────────────────────────────────

function parseResponse(data) {
    const result = {
        text: '',
        toolCalls: [],
        usage: data.usageMetadata || null
    };

    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
        console.warn('[vertex-ai] Response has no content parts:', JSON.stringify(data).substring(0, 500));
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

// ─── Core: Send Request to Vertex AI with Retries ───────────────

async function sendVertexRequest(payload, modelName) {
    const model = modelName || DEFAULT_MODEL;
    if (!String(model).startsWith('gemini-')) {
        throw new Error(`[vertex-ai] Model "${model}" is not supported. Only Vertex Gemini models are allowed.`);
    }
    if (!SUPPORTED_VERTEX_MODELS.has(String(model))) {
        throw new Error(`[vertex-ai] Model "${model}" is not enabled. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`);
    }
    // Ensure credentials are loaded and validated before generating token.
    await getServiceAccountKey();

    const url = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${model}:generateContent`;
    const accessToken = await getAccessToken();
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
    };

    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[vertex-ai] Request → model: ${model}, mode: Vertex, attempt: ${attempt}/${MAX_RETRIES}`);

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                const parsed = parseResponse(data);
                console.log(`[vertex-ai] ✅ Response received — ${parsed.text.length} chars, ${parsed.toolCalls.length} tool calls`);
                return parsed;
            }

            // Handle specific error codes
            const status = response.status;
            const errText = await response.text();
            let errorData = {};
            try { errorData = JSON.parse(errText); } catch (e) { }

            // 429 = rate limited, 503 = service unavailable → retry
            if (status === 429 || status === 503) {
                if (attempt < MAX_RETRIES) {
                    const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 1000); // add jitter
                    console.warn(`[vertex-ai] ⚠️ ${status} on attempt ${attempt}, retrying in ${Math.round(delay / 1000)}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // If it's 429 and we're out of retries, and we're NOT already on the lite model, try the lite model ONCE
                if (status === 429 && model !== 'gemini-2.5-flash-lite') {
                    console.warn(`[vertex-ai] 🚨 429 Quota Exhausted for ${model}. Attempting EMERGENCY FALLBACK to gemini-2.5-flash-lite...`);
                    const fallbackModel = 'gemini-2.5-flash-lite';
                    const fallbackUrl = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${fallbackModel}:generateContent`;

                    const fallbackResponse = await fetch(fallbackUrl, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify(payload)
                    });

                    if (fallbackResponse.ok) {
                        const data = await fallbackResponse.json();
                        const parsed = parseResponse(data);
                        console.log(`[vertex-ai] ✅ Fallback Response received — ${parsed.text.length} chars`);
                        return parsed;
                    }
                    console.error(`[vertex-ai] ❌ Fallback also failed: ${fallbackResponse.status}`);
                }
            }

            // 401 = token expired → clear cache and retry
            if (status === 401 && attempt < MAX_RETRIES) {
                console.warn('[vertex-ai] ⚠️ 401 Unauthorized — clearing token cache and retrying...');
                cachedToken = null;
                const accessToken = await getAccessToken();
                headers['Authorization'] = `Bearer ${accessToken}`;
                continue;
            }

            throw new Error(`Vertex AI API error (${status}): ${JSON.stringify(errorData.error || errText).substring(0, 300)}`);

        } catch (error) {
            lastError = error;

            if (attempt < MAX_RETRIES && !error.message?.includes('API error')) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[vertex-ai] ⚠️ Error on attempt ${attempt}: ${error.message}. Retrying in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
        }
    }

    console.error(`[vertex-ai] ❌ All ${MAX_RETRIES} attempts failed`);
    throw lastError;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * callAI — General purpose AI call.
 * 
 * @param {Object} params
 * @param {string} params.systemPrompt - System instructions for the AI
 * @param {string} params.userMessage - Current user message
 * @param {Array}  [params.history=[]] - Previous messages [{role: 'user'|'model', content: string}]
 * @param {Array}  [params.tools] - Tool definitions for function calling (optional)
 * @param {string} [params.modelName='gemini-2.5-flash'] - Vertex AI model name
 * @param {number} [params.temperature=0.3] - Temperature for generation
 * 
 * @returns {Promise<{text: string, toolCalls: Array, usage: Object|null}>}
 */
export async function callAI({
    systemPrompt,
    userMessage,
    history = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE
}) {
    if (!userMessage && history.length === 0) {
        throw new Error('[vertex-ai] callAI requires at least userMessage or history');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, tools, temperature, modelName });
    return sendVertexRequest(payload, modelName);
}

/**
 * callAIWithTools — AI call specifically designed for function calling flows.
 * 
 * Same as callAI but tools parameter is required and response handling
 * is optimized for tool call extraction.
 * 
 * @param {Object} params
 * @param {string} params.systemPrompt - System instructions
 * @param {string} params.userMessage - Current user message
 * @param {Array}  [params.history=[]] - Previous messages
 * @param {Array}  params.tools - REQUIRED: Tool/function declarations
 * @param {string} [params.modelName='gemini-2.5-flash'] - Model name
 * @param {number} [params.temperature=0.3] - Temperature
 * 
 * @returns {Promise<{text: string, toolCalls: Array, usage: Object|null}>}
 */
export async function callAIWithTools({
    systemPrompt,
    userMessage,
    history = [],
    tools,
    modelName = DEFAULT_MODEL,
    temperature = DEFAULT_TEMPERATURE
}) {
    if (!tools || tools.length === 0) {
        throw new Error('[vertex-ai] callAIWithTools requires at least one tool definition');
    }

    const payload = buildPayload({ systemPrompt, userMessage, history, tools, temperature, modelName });
    return sendVertexRequest(payload, modelName);
}

export default { callAI, callAIWithTools };
