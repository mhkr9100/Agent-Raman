const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yaml', 'yml'];
const DOC_EXTENSIONS = ['pdf', 'docx', 'doc'];
const ALL_EXTENSIONS = [...TEXT_EXTENSIONS, ...DOC_EXTENSIONS];

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_TEXT_CHARS = 50000;

export function isSupportedDocument(fileName: string): boolean {
    const ext = String(fileName || '').split('.').pop()?.toLowerCase() || '';
    return ALL_EXTENSIONS.includes(ext);
}

export function validateDocumentFile(file: File, maxBytes: number = MAX_DOCUMENT_BYTES) {
    if (!isSupportedDocument(file.name)) {
        throw new Error(`"${file.name}" is not supported. Use TXT/MD/CSV/JSON/YAML/PDF/DOCX files.`);
    }
    if (file.size > maxBytes) {
        throw new Error(`"${file.name}" exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit.`);
    }
}

function clampText(text: string, maxChars: number = MAX_TEXT_CHARS): string {
    const normalized = String(text || '').replace(/\u0000/g, '').trim();
    if (normalized.length <= maxChars) return normalized;
    return `${normalized.slice(0, maxChars)}\n\n[Truncated at ${maxChars} characters]`;
}

async function extractPdfText(file: File): Promise<string> {
    const data = new Uint8Array(await file.arrayBuffer());
    const [{ getDocument, GlobalWorkerOptions }, workerModule] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs'),
        import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')
    ]);
    GlobalWorkerOptions.workerSrc = workerModule.default;
    const task = getDocument({ data });
    const doc = await task.promise;

    const pages: string[] = [];
    const maxPages = Math.min(doc.numPages, 50);
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const lines = (content.items || [])
            .map((item: any) => (item?.str || '').trim())
            .filter(Boolean);
        if (lines.length > 0) pages.push(lines.join(' '));
    }

    return clampText(pages.join('\n\n'));
}

async function extractDocxText(file: File): Promise<string> {
    let mammoth: any;
    try {
        mammoth = await import('mammoth/mammoth.browser');
    } catch {
        mammoth = await import('mammoth');
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return clampText(result?.value || '');
}

export async function parseDocumentText(file: File): Promise<string> {
    validateDocumentFile(file);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (TEXT_EXTENSIONS.includes(ext)) {
        return clampText(await file.text());
    }
    if (ext === 'pdf') {
        return extractPdfText(file);
    }
    if (ext === 'docx') {
        return extractDocxText(file);
    }
    if (ext === 'doc') {
        throw new Error(`"${file.name}" is a legacy .doc file. Please convert it to .docx.`);
    }
    throw new Error(`"${file.name}" is not a supported document format.`);
}

