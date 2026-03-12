/**
 * Shared CORS helper for backend/functions (Node.js Lambdas).
 * Mirrors backend/src/security.ts behavior so all handlers resolve origin
 * dynamically and return consistent headers on success/error paths.
 */

const DEFAULT_ALLOWED_ORIGINS = 'https://www.ramnai.com,http://localhost:3000,http://localhost:5173';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const fallbackOrigin = allowedOrigins[0] || 'https://www.ramnai.com';

function readHeader(headers, key) {
    if (!headers || typeof headers !== 'object') return undefined;
    const lower = String(key || '').toLowerCase();
    const foundKey = Object.keys(headers).find((k) => k.toLowerCase() === lower);
    return foundKey ? headers[foundKey] : undefined;
}

export function resolveOrigin(headers) {
    const requestOrigin = readHeader(headers, 'origin');
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
        return requestOrigin;
    }
    return fallbackOrigin;
}

export function buildCorsHeaders(headers, methods) {
    return {
        'Access-Control-Allow-Origin': resolveOrigin(headers),
        'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Requested-With',
        'Access-Control-Allow-Methods': methods,
        'Vary': 'Origin'
    };
}
