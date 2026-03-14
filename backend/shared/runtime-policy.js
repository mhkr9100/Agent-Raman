/**
 * Shared runtime policy for RamN AI backend.
 * Keeps model and capability allowlists consistent across lambdas.
 */

export const DEFAULT_VERTEX_MODEL_ID = 'gemini-2.5-flash';
export const DEFAULT_REASONING_MODEL_ID = 'gemini-2.5-pro';
export const DEFAULT_LIGHTWEIGHT_MODEL_ID = 'gemini-2.5-flash-lite';

export const SUPPORTED_VERTEX_MODELS = new Set([
    DEFAULT_VERTEX_MODEL_ID,
    DEFAULT_REASONING_MODEL_ID,
    DEFAULT_LIGHTWEIGHT_MODEL_ID
]);

export const SUPPORTED_TOOL_IDS = new Set([
    'web-search',
    'thinking',
    'doc-reader'
]);

export const PUBLIC_TOOL_IDS = new Set([
    'web-search',
    'thinking'
]);

const LEGACY_MODEL_FALLBACKS = {
    'anthropic.claude-3-5-sonnet-20240620-v1:0': DEFAULT_REASONING_MODEL_ID,
    'meta.llama3-1-405b-instruct-v1:0': DEFAULT_REASONING_MODEL_ID,
    'meta.llama3-1-70b-instruct-v1:0': DEFAULT_REASONING_MODEL_ID,
    'meta.llama3-1-8b-instruct-v1:0': DEFAULT_VERTEX_MODEL_ID,
    'gpt-4o': DEFAULT_REASONING_MODEL_ID,
    'gpt-4o-mini': DEFAULT_VERTEX_MODEL_ID,
    'gemini-1.5-pro': DEFAULT_REASONING_MODEL_ID,
    'gemini-1.5-flash': DEFAULT_VERTEX_MODEL_ID
};

function inferVertexFallback(modelId) {
    const normalized = String(modelId || '').trim().toLowerCase();
    if (!normalized) return DEFAULT_VERTEX_MODEL_ID;
    if (normalized.includes('lite')) return DEFAULT_LIGHTWEIGHT_MODEL_ID;
    if (normalized.includes('flash')) return DEFAULT_VERTEX_MODEL_ID;
    return DEFAULT_REASONING_MODEL_ID;
}

export function isSupportedVertexModel(modelId) {
    return SUPPORTED_VERTEX_MODELS.has(String(modelId || '').trim());
}

export function resolveSupportedVertexModelId(requestedModelId) {
    const requested = String(requestedModelId || '').trim();
    if (isSupportedVertexModel(requested)) {
        return {
            requestedModelId: requested,
            runtimeModelId: requested,
            migrated: false
        };
    }

    const explicitFallback = LEGACY_MODEL_FALLBACKS[requested];
    const runtimeModelId = explicitFallback || inferVertexFallback(requested);

    return {
        requestedModelId: requested,
        runtimeModelId,
        migrated: true,
        reason: requested
            ? `Model "${requested}" is not enabled for this deployment. Migrated to "${runtimeModelId}".`
            : `Missing modelId. Defaulted to "${runtimeModelId}".`
    };
}
