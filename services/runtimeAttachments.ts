import { validateDocumentFile, MAX_DOCUMENT_BYTES } from './documentParser';

export interface RuntimeAttachment {
    kind: 'image';
    fileName: string;
    mimeType: string;
    size: number;
    dataBase64: string;
}

const SUPPORTED_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif'
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

function getExtension(fileName: string): string {
    return String(fileName || '').split('.').pop()?.toLowerCase() || '';
}

export function isImageAttachment(file: File): boolean {
    return SUPPORTED_IMAGE_TYPES.has(String(file.type || '').toLowerCase()) || IMAGE_EXTENSIONS.has(getExtension(file.name));
}

export function isDocumentAttachment(file: File): boolean {
    try {
        validateDocumentFile(file);
        return true;
    } catch {
        return false;
    }
}

export function validateChatAttachment(file: File) {
    if (isImageAttachment(file)) {
        if (file.size > MAX_IMAGE_BYTES) {
            throw new Error(`"${file.name}" exceeds ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB image limit.`);
        }
        return;
    }

    validateDocumentFile(file, MAX_DOCUMENT_BYTES);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const slice = bytes.subarray(index, index + chunkSize);
        binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
}

export async function serializeRuntimeImageAttachment(file: File): Promise<RuntimeAttachment> {
    validateChatAttachment(file);
    if (!isImageAttachment(file)) {
        throw new Error(`"${file.name}" is not a supported inline image.`);
    }

    const buffer = await file.arrayBuffer();
    return {
        kind: 'image',
        fileName: file.name,
        mimeType: file.type || `image/${getExtension(file.name) || 'png'}`,
        size: file.size,
        dataBase64: arrayBufferToBase64(buffer)
    };
}
