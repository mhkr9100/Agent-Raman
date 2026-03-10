/**
 * Canonical tool IDs used across RamN backend and frontend payloads.
 */

const LEGACY_TO_CANONICAL = {
    googleSearch: 'web-search',
    webSearch: 'web-search',
    web_search: 'web-search',
    googleMaps: 'web-search',
    thinking: 'thinking',
    imageGeneration: 'image-generation',
    imageEditing: 'image-generation',
    fileManipulation: 'doc-reader',
    docReader: 'doc-reader',
    doc_reader: 'doc-reader'
};

export function toCanonicalToolId(input) {
    if (!input) return '';
    const raw = String(input).trim();
    if (!raw) return '';
    return LEGACY_TO_CANONICAL[raw] || raw;
}

export function normalizeToolIds(values) {
    const ids = Array.isArray(values) ? values : [];
    const canonical = ids
        .map(v => toCanonicalToolId(v))
        .filter(Boolean);
    return Array.from(new Set(canonical));
}

export function deriveToolIdsFromBlueprint(blueprint) {
    if (!blueprint) return [];

    const directToolIds = normalizeToolIds(blueprint.toolIds || blueprint.tools || []);
    if (directToolIds.length > 0) return directToolIds;

    const resolvedTools = Array.isArray(blueprint.tools) ? blueprint.tools : [];
    const fromResolved = resolvedTools
        .map(t => (typeof t === 'string' ? t : t?.toolId))
        .filter(Boolean);
    return normalizeToolIds(fromResolved);
}

export default {
    toCanonicalToolId,
    normalizeToolIds,
    deriveToolIdsFromBlueprint
};
