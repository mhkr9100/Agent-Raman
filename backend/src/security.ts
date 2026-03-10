import { CognitoJwtVerifier } from 'aws-jwt-verify';

type HeaderMap = Record<string, string | undefined> | null | undefined;

const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_R2j2oAqLJ';
const CLIENT_ID = process.env.CLIENT_ID || '77205lmtu8fg6t1s3sgcidf7p9';
const DEFAULT_ALLOWED_ORIGINS = 'https://www.ramnai.com,http://localhost:3000,http://localhost:5173';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
const fallbackOrigin = allowedOrigins[0] || 'https://www.ramnai.com';

const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    tokenUse: 'id',
    clientId: CLIENT_ID
});

function readHeader(headers: HeaderMap, key: string): string | undefined {
    if (!headers) return undefined;
    const lower = key.toLowerCase();
    const foundKey = Object.keys(headers).find(k => k.toLowerCase() === lower);
    return foundKey ? headers[foundKey] : undefined;
}

export function resolveOrigin(headers: HeaderMap): string {
    const requestOrigin = readHeader(headers, 'origin');
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        return requestOrigin;
    }
    return fallbackOrigin;
}

export function buildCorsHeaders(headers: HeaderMap, methods: string): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': resolveOrigin(headers),
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
        'Access-Control-Allow-Methods': methods,
        'Vary': 'Origin'
    };
}

export async function requireAuth(headers: HeaderMap): Promise<{ userId: string; email?: string }> {
    const authHeader = readHeader(headers, 'authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('Unauthorized: Missing token');
    }

    const token = authHeader.slice(7);
    const payload = await verifier.verify(token);
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    return {
        userId: payload.sub,
        email
    };
}
