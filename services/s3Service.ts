import { v4 as uuidv4 } from 'uuid';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

interface PresignResponse {
    uploadUrl: string;
    key: string;
    publicUrl: string;
    expiresIn: number;
}

function getAuthToken(): string | null {
    return sessionStorage.getItem('auth_token')
        || localStorage.getItem('id_token')
        || localStorage.getItem('auth_token');
}

async function getPresignedUploadUrl(file: File, agentId: string): Promise<PresignResponse> {
    const token = getAuthToken();
    if (!token) {
        throw new Error('Not authenticated. Please log in again.');
    }

    const response = await fetch(`${BACKEND_URL}/api/uploads/presign`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            agentId
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Presign request failed (${response.status})`);
    }

    return response.json();
}

export const s3Service = {
    /**
     * Uploads to S3 via a backend-generated presigned URL.
     * No long-lived AWS credentials are ever exposed to the browser.
     */
    async uploadKnowledgeDocument(file: File, agentId: string): Promise<{ url: string; key: string }> {
        if (!BACKEND_URL) {
            // Local fallback only when backend URL is not configured.
            return {
                url: URL.createObjectURL(file),
                key: `mock-key-${uuidv4()}`
            };
        }

        const { uploadUrl, key, publicUrl } = await getPresignedUploadUrl(file, agentId);

        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': file.type || 'application/octet-stream'
            },
            body: file
        });

        if (!uploadRes.ok) {
            throw new Error(`S3 upload failed (${uploadRes.status})`);
        }

        return { url: publicUrl, key };
    }
};
