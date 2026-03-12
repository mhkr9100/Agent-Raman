import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { buildCorsHeaders, requireAuth } from './security.js';

/**
 * AI Proxy Lambda — Server-Side Vertex Gateway
 *
 * Strict provider policy:
 * 1. Google Vertex AI (service account OAuth2)
 */

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCP_SERVICE_ACCOUNT_SECRET_ARN = process.env.GCP_SERVICE_ACCOUNT_SECRET_ARN || '';

// ─── Decode Service Account Key ───

let cachedGcpKey: any = null;

async function getServiceAccountKey(): Promise<any | null> {
    if (cachedGcpKey) return cachedGcpKey;
    if (!GCP_SERVICE_ACCOUNT_SECRET_ARN) return null;

    try {
        const client = new SecretsManagerClient({});
        const response = await client.send(new GetSecretValueCommand({ SecretId: GCP_SERVICE_ACCOUNT_SECRET_ARN }));
        if (response.SecretString) {
            let secretString = response.SecretString;
            // 1. Try directly parsing as JSON
            try {
                const parsed = JSON.parse(secretString);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    return parsed;
                }
            } catch { /* not raw JSON */ }
            // 2. Try Base64 string decoding
            try {
                const decoded = Buffer.from(secretString, 'base64').toString('utf-8');
                const parsed = JSON.parse(decoded);
                if (parsed.private_key && parsed.client_email) {
                    cachedGcpKey = parsed;
                    return parsed;
                }
            } catch { /* not valid base64 JSON either */ }
        }
    } catch (error) {
        console.error('[AI Proxy] Failed to fetch GCP key from Secrets Manager', error);
    }

    console.error('[AI Proxy] Could not parse a valid GCP_SERVICE_ACCOUNT_KEY from Secrets Manager');
    return null;
}

// ─── JWT / OAuth2 Token Generation ───

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
        return cachedToken.token;
    }

    const sa = await getServiceAccountKey();
    if (!sa) throw new Error('No valid GCP service account key available');

    const { client_email, private_key } = sa;
    const now = Math.floor(Date.now() / 1000);

    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: client_email,
        sub: client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/cloud-platform'
    };

    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(private_key, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });

    if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        console.error('[Token Exchange Error]', errText);
        throw new Error(`OAuth2 token exchange failed: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json() as any;
    cachedToken = {
        token: tokenData.access_token,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
    };

    return tokenData.access_token;
}

// ─── Main Handler ───

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const corsHeaders = {
        ...buildCorsHeaders(event.headers, 'OPTIONS,POST,GET'),
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        const reqContext = event.requestContext as any;
        const path = reqContext?.http?.path || event.path || '';

        if (event.httpMethod === 'POST' && path.endsWith('/generate')) {
            await requireAuth(event.headers);
            return await handleGenerate(event, corsHeaders);
        }
        if (path.endsWith('/health')) return await handleHealth();

        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Not Found' }) };
    } catch (error: any) {
        console.error('[AI Proxy Error]', error);
        const status = (error.message || '').startsWith('Unauthorized') ? 401 : 500;
        const safeMessage = status === 401 ? error.message : 'An internal error occurred. Please try again.';
        return {
            statusCode: status,
            headers: corsHeaders,
            body: JSON.stringify({ error: safeMessage })
        };
    }
};

async function handleHealth(): Promise<APIGatewayProxyResult> {
    const corsHeaders = {
        ...buildCorsHeaders(undefined, 'OPTIONS,POST,GET'),
        'Content-Type': 'application/json'
    };
    const saKey = await getServiceAccountKey();
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            status: 'operational',
            providers: {
                vertexAI: !!saKey
            }
        })
    };
}

/**
 * POST /api/ai/generate
 *
 * Strict strategy:
 * 1. Vertex AI (service account)
 */
async function handleGenerate(
    event: APIGatewayProxyEvent,
    corsHeaders: Record<string, string>
): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const {
        model = 'gemini-2.5-flash',
        contents,
        systemInstruction,
        tools,
        generationConfig
    } = body;

    if (!contents || !Array.isArray(contents)) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'contents array is required' })
        };
    }
    if (!String(model || '').startsWith('gemini-')) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({
                error: `Model "${model}" is not supported in this deployment. Only Vertex Gemini models are allowed.`
            })
        };
    }

    const geminiPayload: any = {
        contents,
        generationConfig: generationConfig || { temperature: 0.7, topP: 0.95 }
    };
    if (systemInstruction) {
        geminiPayload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (tools) {
        geminiPayload.tools = tools;
    }

    const errors: string[] = [];

    // ═══════════ TIER 1: Vertex AI ═══════════
    const saKey = await getServiceAccountKey();
    if (saKey) {
        try {
            console.info(`[AI Proxy] TIER 1: Vertex AI — model: ${model}`);
            const accessToken = await getAccessToken();

            const vertexUrl = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${model}:generateContent`;

            const response = await fetch(vertexUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(geminiPayload)
            });

            if (response.ok) {
                const data = await response.json();
                console.info('[AI Proxy] ✅ Vertex AI succeeded');
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ source: 'vertex', ...data as any })
                };
            }

            const errText = await response.text();
            console.warn(`[AI Proxy] ❌ Vertex AI failed (${response.status}):`, errText.substring(0, 300));
            errors.push(`Vertex: ${response.status}`);
        } catch (vertexErr: any) {
            console.error('[AI Proxy] ❌ Vertex AI error:', vertexErr.message);
            errors.push(`Vertex: ${vertexErr.message}`);
        }
    } else {
        console.info('[AI Proxy] Skipping Vertex AI — no valid service account key');
        errors.push('Vertex: no key');
    }

    // ═══════════ VERTEX FAILED ═══════════
    return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
            error: 'Vertex AI request failed',
            details: errors
        })
    };
}
