/**
 * RamN AI — Shared CORS Utility
 *
 * Dynamic origin resolver for all Lambda functions.
 * Mirrors the logic in backend/src/security.ts for the JS Lambda layer.
 */

const DEFAULT_ALLOWED_ORIGINS = 'https://www.ramnai.com,http://localhost:3000,http://localhost:5173';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.CORS_ALLOW_ORIGIN || DEFAULT_ALLOWED_ORIGINS)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
const fallbackOrigin = allowedOrigins[0] || 'https://www.ramnai.com';

/**
 * Resolve the correct Access-Control-Allow-Origin for the request.
 * @param {Record<string, string>} headers - Event headers object
 * @returns {string} The allowed origin
 */
export function resolveOrigin(headers) {
    const origin = headers?.origin || headers?.Origin;
    if (origin && allowedOrigins.includes(origin)) {
        return origin;
    }
    return fallbackOrigin;
}

/**
 * Build CORS headers dynamically based on the request origin.
 * @param {Record<string, string>} headers - Event headers object
 * @param {string} methods - Allowed HTTP methods (e.g., 'OPTIONS,POST,GET')
 * @returns {Record<string, string>}
 */
export function buildCorsHeaders(headers, methods) {
    return {
        'Access-Control-Allow-Origin': resolveOrigin(headers),
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': methods,
        'Content-Type': 'application/json',
        'Vary': 'Origin'
    };
}
