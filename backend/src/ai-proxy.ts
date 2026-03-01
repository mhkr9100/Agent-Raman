import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';

/**
 * AI Proxy Lambda — Server-Side AI Provider Gateway
 * 
 * Handles AI requests that can't be made directly from the browser:
 * 1. Google Vertex AI (requires OAuth2 service account auth)
 * 2. Google AI Studio (as a fallback proxy)
 * 
 * This Lambda receives inference requests from the frontend,
 * authenticates with the appropriate provider, and returns the response.
 */

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCP_SERVICE_ACCOUNT_KEY = process.env.GCP_SERVICE_ACCOUNT_KEY || ''; // Full JSON key as a string
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Content-Type': 'application/json',
};

// ─── JWT / OAuth2 Token Generation ───

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Generate a self-signed JWT and exchange it for a Google OAuth2 access token.
 * Uses the service account's private key to sign the JWT (RS256).
 */
async function getAccessToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
        return cachedToken.token;
    }

    if (!GCP_SERVICE_ACCOUNT_KEY) {
        throw new Error('GCP_SERVICE_ACCOUNT_KEY environment variable is not set');
    }

    let serviceAccount: any;
    try {
        serviceAccount = JSON.parse(GCP_SERVICE_ACCOUNT_KEY);
    } catch {
        throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON');
    }

    const { client_email, private_key } = serviceAccount;
    if (!client_email || !private_key) {
        throw new Error('Service account key missing client_email or private_key');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // 1 hour

    // Create JWT header and payload
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: client_email,
        sub: client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: exp,
        scope: 'https://www.googleapis.com/auth/cloud-platform'
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with RSA-SHA256
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(private_key, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    // Exchange JWT for access token
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
    const accessToken = tokenData.access_token;

    // Cache the token
    cachedToken = {
        token: accessToken,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000
    };

    return accessToken;
}

function base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
}

// ─── Main Handler ───

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        const reqContext = event.requestContext as any;
        const path = reqContext?.http?.path || event.path || '';

        if (event.httpMethod === 'POST') {
            if (path.endsWith('/generate')) return await handleGenerate(event);
            if (path.endsWith('/health')) return await handleHealth();
        }
        if (event.httpMethod === 'GET' && path.endsWith('/health')) {
            return await handleHealth();
        }

        return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'Not Found' }) };
    } catch (error: any) {
        console.error('[AI Proxy Error]', error);
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: error.message || 'Internal Server Error' })
        };
    }
};

/**
 * Health check — reports which providers are configured
 */
async function handleHealth(): Promise<APIGatewayProxyResult> {
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            status: 'operational',
            providers: {
                vertexAI: !!GCP_SERVICE_ACCOUNT_KEY,
                geminiStudio: !!GEMINI_API_KEY,
                projectId: GCP_PROJECT_ID,
                location: GCP_LOCATION
            }
        })
    };
}

/**
 * POST /api/ai/generate
 * 
 * Request body:
 * {
 *   model: "gemini-2.0-flash",
 *   contents: [...],
 *   systemInstruction?: string,
 *   tools?: [...],
 *   generationConfig?: {...},
 *   provider?: "vertex" | "studio"  // optional override
 * }
 * 
 * Strategy:
 * 1. Try Vertex AI first (if service account is configured)
 * 2. Fall back to AI Studio (if GEMINI_API_KEY is available)
 * 3. Return error if neither is available
 */
async function handleGenerate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const {
        model = 'gemini-2.0-flash',
        contents,
        systemInstruction,
        tools,
        generationConfig,
        provider: preferredProvider
    } = body;

    if (!contents || !Array.isArray(contents)) {
        return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'contents array is required' })
        };
    }

    // Build the Gemini-compatible payload
    const payload: any = {
        contents,
        generationConfig: generationConfig || { temperature: 0.7, topP: 0.95 }
    };

    if (systemInstruction) {
        payload.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (tools) {
        payload.tools = tools;
    }

    // === PROVIDER STRATEGY ===

    // 1. Try Vertex AI first (enterprise, higher quotas, free tier models)
    if (GCP_SERVICE_ACCOUNT_KEY && preferredProvider !== 'studio') {
        try {
            console.info(`[AI Proxy] Attempting Vertex AI — model: ${model}`);
            const accessToken = await getAccessToken();

            const vertexUrl = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${model}:generateContent`;

            const response = await fetch(vertexUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                console.info('[AI Proxy] Vertex AI response received successfully');
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ source: 'vertex', ...data as any })
                };
            }

            const errText = await response.text();
            console.warn(`[AI Proxy] Vertex AI failed (${response.status}):`, errText.substring(0, 300));

            // If it's a quota issue on Vertex too, fall through to Studio
            if (!errText.includes('RESOURCE_EXHAUSTED')) {
                return {
                    statusCode: response.status,
                    headers: corsHeaders,
                    body: JSON.stringify({ error: `Vertex AI error: ${errText.substring(0, 500)}`, source: 'vertex' })
                };
            }
        } catch (vertexErr: any) {
            console.error('[AI Proxy] Vertex AI attempt failed:', vertexErr.message);
            // Fall through to Studio
        }
    }

    // 2. Fall back to Google AI Studio
    if (GEMINI_API_KEY) {
        try {
            console.info(`[AI Proxy] Falling back to AI Studio — model: ${model}`);
            const studioUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            const response = await fetch(studioUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ source: 'studio', ...data as any })
                };
            }

            const errText = await response.text();
            console.warn(`[AI Proxy] AI Studio failed (${response.status}):`, errText.substring(0, 300));
            return {
                statusCode: response.status,
                headers: corsHeaders,
                body: JSON.stringify({ error: `AI Studio error: ${errText.substring(0, 500)}`, source: 'studio' })
            };
        } catch (studioErr: any) {
            console.error('[AI Proxy] AI Studio attempt failed:', studioErr.message);
        }
    }

    // 3. No providers available
    return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
            error: 'No AI providers available. Configure GCP_SERVICE_ACCOUNT_KEY or GEMINI_API_KEY.',
            vertexConfigured: !!GCP_SERVICE_ACCOUNT_KEY,
            studioConfigured: !!GEMINI_API_KEY
        })
    };
}
