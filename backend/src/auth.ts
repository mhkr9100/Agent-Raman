import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders, requireAuth } from './security.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME || 'RamN-Entities';

/**
 * Structured API error response. Never leaks internal details.
 */
function apiError(event: APIGatewayProxyEvent, statusCode: number, message: string): APIGatewayProxyResult {
    return {
        statusCode,
        headers: buildCorsHeaders(event.headers, 'OPTIONS,DELETE'),
        body: JSON.stringify({ error: message }),
    };
}

/**
 * Structured API success response.
 */
function apiSuccess(event: APIGatewayProxyEvent, data: any): APIGatewayProxyResult {
    return {
        statusCode: 200,
        headers: buildCorsHeaders(event.headers, 'OPTIONS,DELETE'),
        body: JSON.stringify(data),
    };
}

/**
 * Auth Handler — Cognito-Only
 *
 * Registration and login are handled entirely by AWS Cognito on the frontend.
 * This handler only supports authenticated operations (e.g., account deletion).
 *
 * Legacy /register and /login endpoints have been removed — they were a
 * parallel custom auth system that issued mock JWTs and bypassed Cognito.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: buildCorsHeaders(event.headers, 'OPTIONS,DELETE'), body: '' };
    }

    try {
        const reqContext = event.requestContext as any;
        const path = reqContext?.http?.path || event.path;

        if (event.httpMethod === 'DELETE' && path.endsWith('/delete')) {
            return await handleDeleteAccount(event);
        }

        return apiError(event, 404, 'Not Found');
    } catch (error: any) {
        console.error('Auth Error:', error);
        const status = (error.message || '').startsWith('Unauthorized') ? 401 : 500;
        // Never send raw error.message to the client in production
        const safeMessage = status === 401 ? 'Unauthorized' : 'An internal error occurred. Please try again.';
        return apiError(event, status, safeMessage);
    }
};

/**
 * DELETE /auth/delete
 * Requires a valid Cognito JWT. Deletes the user profile from DynamoDB.
 */
async function handleDeleteAccount(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const auth = await requireAuth(event.headers);
    const email = (auth.email || '').toLowerCase().trim();

    if (!email) {
        return apiError(event, 400, 'Authenticated email not found in token');
    }

    const pk = `USER#${email}`;
    const sk = `PROFILE`;

    await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk }
    }));

    return apiSuccess(event, { success: true, message: 'Account deleted' });
}
