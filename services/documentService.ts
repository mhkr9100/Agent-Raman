import { parseDocumentText, validateDocumentFile } from './documentParser';
import { registerDocument, DocumentRecord } from './apiV2';
import { s3Service } from './s3Service';

export interface UploadAndRegisterParams {
    ownerType: 'agent' | 'user';
    ownerId: string;
    file: File;
}

export async function uploadAndRegisterDocument({
    ownerType,
    ownerId,
    file
}: UploadAndRegisterParams): Promise<DocumentRecord> {
    validateDocumentFile(file);

    const { url: fileUrl, key: fileKey } = await s3Service.uploadKnowledgeDocument(file, ownerId);
    const parsedText = await parseDocumentText(file);
    const { url: textUrl, key: textKey } = await s3Service.uploadTextDocument(parsedText, `${file.name}.parsed`, ownerId);

    const response = await registerDocument({
        ownerType,
        ownerId,
        fileName: file.name,
        fileKey,
        fileUrl,
        textKey,
        textUrl,
        contentType: file.type || 'application/octet-stream',
        size: file.size
    });

    return response.document;
}

export async function uploadAndRegisterMany(
    files: File[],
    ownerType: 'agent' | 'user',
    ownerId: string
): Promise<DocumentRecord[]> {
    const docs: DocumentRecord[] = [];
    for (const file of files) {
        docs.push(await uploadAndRegisterDocument({ file, ownerType, ownerId }));
    }
    return docs;
}

