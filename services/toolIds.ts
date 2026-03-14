export const LEGACY_TO_CANONICAL_TOOL_ID: Record<string, string> = {
    googleSearch: 'web-search',
    webSearch: 'web-search',
    web_search: 'web-search',
    googleMaps: 'web-search',
    thinking: 'thinking',
    fileManipulation: 'doc-reader',
    docReader: 'doc-reader',
    doc_reader: 'doc-reader'
};

export function toCanonicalToolId(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return LEGACY_TO_CANONICAL_TOOL_ID[raw] || raw;
}

export function normalizeToolIds(values: any[]): string[] {
    const list = Array.isArray(values) ? values : [];
    const normalized = list
        .map(v => typeof v === 'string' ? v : v?.toolId)
        .filter(Boolean)
        .map(toCanonicalToolId)
        .filter(Boolean);
    return Array.from(new Set(normalized));
}
