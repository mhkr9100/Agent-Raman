import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { buildCorsHeaders, requireAuth } from './security.js';

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env.TABLE_NAME || 'RamN-Entities';

// Return a structured API error
function apiError(event: APIGatewayProxyEvent, statusCode: number, message: string): APIGatewayProxyResult {
    return {
        statusCode,
        headers: buildCorsHeaders(event.headers, 'OPTIONS,POST,GET,PUT,DELETE'),
        body: JSON.stringify({ error: message }),
    };
}

// Return a structured API success response
function apiSuccess(event: APIGatewayProxyEvent, data: any): APIGatewayProxyResult {
    return {
        statusCode: 200,
        headers: buildCorsHeaders(event.headers, 'OPTIONS,POST,GET,PUT,DELETE'),
        body: JSON.stringify(data),
    };
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: buildCorsHeaders(event.headers, 'OPTIONS,POST,GET,PUT,DELETE'), body: '' };
    }

    try {
        const auth = await requireAuth(event.headers);
        const userId = auth.userId;

        switch (event.httpMethod) {
            case 'POST':
            case 'PUT':
                return await handlePut(event, userId);
            case 'GET':
                return await handleGet(event, userId);
            case 'DELETE':
                return await handleDelete(event, userId);
            default:
                return apiError(event, 405, 'Method Not Allowed');
        }
    } catch (error: any) {
        console.error('DB Error:', error);
        if ((error.message || '').startsWith('Unauthorized')) {
            return apiError(event, 401, error.message);
        }
        return apiError(event, 500, error.message || 'Internal Server Error');
    }
};

/**
 * Handle POST / PUT
 * Expects { store: string, item: object }
 * Constructs PK = "USER#<userId>" (if available) or "STORE#<store>"
 * Constructs SK = "<store>#<id>"
 */
async function handlePut(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
    const body = JSON.parse(event.body || '{}');
    const { store, item } = body;

    if (!store || !item || !item.id) {
        return apiError(event, 400, 'Missing store, item, or item.id');
    }

    // Always scope to authenticated user to prevent IDOR.
    const securedItem = { ...item, userId };
    const pk = `USER#${userId}`;
    const sk = `${store}#${item.id}`;

    const params = {
        TableName: TABLE_NAME,
        Item: {
            PK: pk,
            SK: sk,
            storeName: store,
            originalId: item.id,
            data: securedItem,
            updatedAt: new Date().toISOString()
        }
    };

    await docClient.send(new PutCommand(params));
    return apiSuccess(event, { success: true, PK: pk, SK: sk });
}

/**
 * Handle GET
 * Expects ?store=xyz&userId=abc (Fetch all for user)
 * Or ?store=xyz&id=123 (Fetch specific item - usually userId needs to be provided too for PK)
 */
async function handleGet(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
    const params = event.queryStringParameters || {};
    const { store, id } = params;

    if (!store) {
        return apiError(event, 400, 'Missing store query parameter');
    }

    if (id) {
        // Fetch specific item
        const pk = `USER#${userId}`;
        const sk = `${store}#${id}`;

        const response = await docClient.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { PK: pk, SK: sk }
        }));

        return apiSuccess(event, { item: response.Item ? response.Item.data : null });
    } else {
        // Fetch all items within a store for a user
        const pk = `USER#${userId}`;

        const response = await docClient.send(new QueryCommand({
            TableName: TABLE_NAME,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues: {
                ':pk': pk,
                ':skPrefix': `${store}#`
            }
        }));

        const items = response.Items ? response.Items.map(i => i.data) : [];
        return apiSuccess(event, { items });
    }
}

/**
 * Handle DELETE
 * Expects ?store=xyz&id=123&userId=abc
 */
async function handleDelete(event: APIGatewayProxyEvent, userId: string): Promise<APIGatewayProxyResult> {
    const params = event.queryStringParameters || {};
    const { store, id } = params;

    if (!store || !id) {
        return apiError(event, 400, 'Missing store or id query parameter');
    }

    const pk = `USER#${userId}`;
    const sk = `${store}#${id}`;

    await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { PK: pk, SK: sk }
    }));

    return apiSuccess(event, { success: true });
}
