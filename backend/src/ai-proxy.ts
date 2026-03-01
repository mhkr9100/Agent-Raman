import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as crypto from 'crypto';

/**
 * AI Proxy Lambda — Server-Side AI Provider Gateway
 * 
 * 3-Tier Fallback:
 * 1. Google Vertex AI (service account OAuth2)
 * 2. Google AI Studio (API key)
 * 3. AWS Bedrock Claude (IAM credentials from Lambda execution role)
 */

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'ramn-ai';
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1';
const GCP_SERVICE_ACCOUNT_KEY_B64 = process.env.GCP_SERVICE_ACCOUNT_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const AWS_BEDROCK_REGION = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
    'Content-Type': 'application/json',
};

// ─── Decode Service Account Key ───

function getServiceAccountKey(): any | null {
    if (!GCP_SERVICE_ACCOUNT_KEY_B64) return null;

    // Try direct JSON parse first
    try {
        const parsed = JSON.parse(GCP_SERVICE_ACCOUNT_KEY_B64);
        if (parsed.private_key && parsed.client_email) return parsed;
    } catch { /* not raw JSON */ }

    // Try Base64 decode
    try {
        const decoded = Buffer.from(GCP_SERVICE_ACCOUNT_KEY_B64, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded);
        if (parsed.private_key && parsed.client_email) return parsed;
    } catch { /* not valid base64 JSON either */ }

    console.error('[AI Proxy] GCP_SERVICE_ACCOUNT_KEY could not be parsed as JSON or Base64-encoded JSON');
    return null;
}

// ─── JWT / OAuth2 Token Generation ───

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
        return cachedToken.token;
    }

    const sa = getServiceAccountKey();
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

// ─── AWS Bedrock (Server-Side — no CORS issues) ───

async function callBedrock(contents: any[], systemInstruction?: string): Promise<any> {
    // Use AWS SDK v3 — dynamically import to keep cold starts fast when not needed
    const { BedrockRuntimeClient, InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');

    const client = new BedrockRuntimeClient({ region: AWS_BEDROCK_REGION });

    const messages = contents.map((c: any) => ({
        role: c.role === 'model' ? 'assistant' : 'user',
        content: c.parts?.[0]?.text || ''
    }));

    const bedrockPayload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages,
        system: systemInstruction || undefined,
        temperature: 0.7,
        top_p: 0.95
    };

    const command = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
        body: JSON.stringify(bedrockPayload),
        contentType: 'application/json',
        accept: 'application/json'
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const text = result.content?.[0]?.text || '';

    // Return in Gemini-compatible format so the frontend doesn't need to change
    return {
        candidates: [{
            content: {
                parts: [{ text }],
                role: 'model'
            }
        }]
    };
}

// ─── Main Handler ───

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: corsHeaders, body: '' };
    }

    try {
        const reqContext = event.requestContext as any;
        const path = reqContext?.http?.path || event.path || '';

        if (event.httpMethod === 'POST' && path.endsWith('/generate')) return await handleGenerate(event);
        if (path.endsWith('/health')) return await handleHealth();

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

async function handleHealth(): Promise<APIGatewayProxyResult> {
    const saKey = getServiceAccountKey();
    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
            status: 'operational',
            providers: {
                vertexAI: !!saKey,
                geminiStudio: !!GEMINI_API_KEY,
                bedrock: true, // Always available via Lambda IAM role
                projectId: GCP_PROJECT_ID,
                location: GCP_LOCATION
            }
        })
    };
}

/**
 * POST /api/ai/generate
 * 
 * 3-Tier Strategy:
 * 1. Vertex AI (service account) — highest quota, enterprise
 * 2. AI Studio (API key) — free tier  
 * 3. AWS Bedrock (Claude 3.5) — pay-per-use, always available
 */
async function handleGenerate(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const {
        model = 'gemini-2.0-flash',
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
    const saKey = getServiceAccountKey();
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

    // ═══════════ TIER 2: AI Studio ═══════════
    if (GEMINI_API_KEY) {
        try {
            console.info(`[AI Proxy] TIER 2: AI Studio — model: ${model}`);
            const studioUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            const response = await fetch(studioUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(geminiPayload)
            });

            if (response.ok) {
                const data = await response.json();
                console.info('[AI Proxy] ✅ AI Studio succeeded');
                return {
                    statusCode: 200,
                    headers: corsHeaders,
                    body: JSON.stringify({ source: 'studio', ...data as any })
                };
            }

            const errText = await response.text();
            console.warn(`[AI Proxy] ❌ AI Studio failed (${response.status}):`, errText.substring(0, 300));
            errors.push(`Studio: ${response.status}`);
        } catch (studioErr: any) {
            console.error('[AI Proxy] ❌ AI Studio error:', studioErr.message);
            errors.push(`Studio: ${studioErr.message}`);
        }
    } else {
        errors.push('Studio: no key');
    }

    // ═══════════ TIER 3: AWS Bedrock (Claude 3.5) ═══════════
    try {
        console.info('[AI Proxy] TIER 3: AWS Bedrock (Claude 3.5 Sonnet)');
        const bedrockData = await callBedrock(contents, systemInstruction);
        console.info('[AI Proxy] ✅ Bedrock succeeded');
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ source: 'bedrock', ...bedrockData })
        };
    } catch (bedrockErr: any) {
        console.error('[AI Proxy] ❌ Bedrock error:', bedrockErr.message);
        errors.push(`Bedrock: ${bedrockErr.message}`);
    }

    // ═══════════ ALL FAILED ═══════════
    return {
        statusCode: 503,
        headers: corsHeaders,
        body: JSON.stringify({
            error: 'All AI providers failed',
            details: errors
        })
    };
}
