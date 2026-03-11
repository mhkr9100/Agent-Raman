/**
 * RamN AI — Shared CORS Utility
 *
 * Dynamic origin resolver that validates the request origin against an allowlist
 * and sets the Vary: Origin header to prevent caching issues.
 */

const DEFAULT_ALLOWED_ORIGINS = 'https://www.ramnai.com,http://localhost:3000,http://localhost:5173';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOW_ORIGIN || DEFAULT_ALLOWED_ORIGINS)
    .split(',').map(v => v.trim()).filter(Boolean);

const fallbackOrigin = allowedOrigins[0] || 'https://www.ramnai.com';

export function resolveOrigin(headers) {
    const origin = headers?.origin || headers?.Origin;
    if (origin && allowedOrigins.includes(origin)) return origin;
    return fallbackOrigin;
}

export function buildCorsHeaders(headers, methods) {
    return {
        'Access-Control-Allow-Origin': resolveOrigin(headers),
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': methods,
        'Content-Type': 'application/json',
        'Vary': 'Origin'
    };
}
