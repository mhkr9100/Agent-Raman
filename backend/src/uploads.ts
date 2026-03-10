import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { buildCorsHeaders, requireAuth } from './security.js';

const REGION = process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';
const BUCKET = process.env.S3_BUCKET_NAME || '';

const s3 = new S3Client({ region: REGION });

function respond(
    event: APIGatewayProxyEvent,
    statusCode: number,
    body: Record<string, any>
): APIGatewayProxyResult {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event.headers, 'OPTIONS,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

function sanitizeFilename(fileName: string): string {
    return fileName
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 180);
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: buildCorsHeaders(event.headers, 'OPTIONS,POST'),
            body: ''
        };
    }

    try {
        const auth = await requireAuth(event.headers);
        const body = JSON.parse(event.body || '{}');
        const fileName = String(body.fileName || '').trim();
        const contentType = String(body.contentType || 'application/octet-stream').trim();
        const agentId = String(body.agentId || 'general').trim();

        if (!BUCKET) {
            return respond(event, 500, { error: 'S3 bucket is not configured' });
        }

        if (!fileName) {
            return respond(event, 400, { error: 'fileName is required' });
        }

        const safeFileName = sanitizeFilename(fileName);
        const safeAgentId = sanitizeFilename(agentId || 'general');
        const key = `knowledge-base/${auth.userId}/${safeAgentId}/${Date.now()}-${safeFileName}`;

        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            ContentType: contentType
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
        const publicUrl = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;

        return respond(event, 200, {
            uploadUrl,
            key,
            publicUrl,
            expiresIn: 300
        });
    } catch (error: any) {
        console.error('Upload presign error:', error);
        const status = (error.message || '').startsWith('Unauthorized') ? 401 : 500;
        return respond(event, status, { error: error.message || 'Failed to generate upload URL' });
    }
};
