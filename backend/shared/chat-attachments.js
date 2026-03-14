const SUPPORTED_INLINE_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif'
]);

export function normalizeRuntimeAttachments(rawAttachments = []) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments
        .map((attachment) => {
            const kind = String(attachment?.kind || '').trim();
            const fileName = String(attachment?.fileName || '').trim();
            const mimeType = String(attachment?.mimeType || '').trim().toLowerCase();
            const size = Number(attachment?.size || 0);
            const dataBase64 = String(attachment?.dataBase64 || '').trim();

            if (kind !== 'image') return null;
            if (!fileName || !mimeType || !dataBase64) return null;
            if (!SUPPORTED_INLINE_IMAGE_TYPES.has(mimeType)) {
                throw new Error(`Unsupported image attachment type: ${mimeType}`);
            }

            return {
                kind,
                fileName,
                mimeType,
                size,
                dataBase64
            };
        })
        .filter(Boolean);
}

export function toVertexUserParts(attachments = []) {
    return normalizeRuntimeAttachments(attachments).map((attachment) => ({
        inlineData: {
            mimeType: attachment.mimeType,
            data: attachment.dataBase64
        }
    }));
}

export function summarizeAttachmentNames(attachments = []) {
    const normalized = normalizeRuntimeAttachments(attachments);
    if (normalized.length === 0) return '';
    return normalized.map((attachment) => attachment.fileName).join(', ');
}
