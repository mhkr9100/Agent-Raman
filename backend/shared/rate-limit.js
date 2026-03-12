/**
 * RamN AI — Server-Side Rate Limiter
 *
 * Stores per-user hourly counters in RamN_Usage.
 * Key format: usageKey = "<userId>#<scope>#<YYYY-MM-DDTHH>"
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand
} from '@aws-sdk/lib-dynamodb';

const HOURLY_LIMIT = parseInt(process.env.HOURLY_REQUEST_LIMIT || '10', 10);
const RETENTION_HOURS = Number(process.env.HOURLY_USAGE_RETENTION || 48);
const TABLE_PREFIX = process.env.TABLE_PREFIX || '';
const USAGE_TABLE = process.env.USAGE_TABLE_NAME || `${TABLE_PREFIX}Usage`;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true }
});

function toHourKey(date = new Date()) {
    return date.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function hourResetIso(hourKey) {
    return new Date(new Date(`${hourKey}:00:00.000Z`).getTime() + 60 * 60 * 1000).toISOString();
}

function usageKeyFor(userId, scope, hourKey) {
    return `${userId}#${scope}#${hourKey}`;
}

async function getCurrentCount(usageKey) {
    const result = await ddb.send(new GetCommand({
        TableName: USAGE_TABLE,
        Key: { usageKey }
    }));
    return Number(result.Item?.requestCount || 0);
}

export async function checkAndRecordUsage(userId, scope = 'ai') {
    const now = new Date();
    const hourKey = toHourKey(now);
    const usageKey = usageKeyFor(userId, scope, hourKey);
    const expiresAt = Math.floor(
        (new Date(`${hourKey}:00:00.000Z`).getTime() + RETENTION_HOURS * 60 * 60 * 1000) / 1000
    );

    try {
        const updateResult = await ddb.send(new UpdateCommand({
            TableName: USAGE_TABLE,
            Key: { usageKey },
            ConditionExpression: 'attribute_not_exists(#requestCount) OR #requestCount < :limit',
            UpdateExpression: 'SET #requestCount = if_not_exists(#requestCount, :zero) + :inc, #userId = :userId, #scope = :scope, #hourKey = :hourKey, #updatedAt = :updatedAt, #expiresAt = :expiresAt',
            ExpressionAttributeNames: {
                '#requestCount': 'requestCount',
                '#userId': 'userId',
                '#scope': 'scope',
                '#hourKey': 'hourKey',
                '#updatedAt': 'updatedAt',
                '#expiresAt': 'expiresAt'
            },
            ExpressionAttributeValues: {
                ':limit': HOURLY_LIMIT,
                ':zero': 0,
                ':inc': 1,
                ':userId': userId,
                ':scope': scope,
                ':hourKey': hourKey,
                ':updatedAt': now.toISOString(),
                ':expiresAt': expiresAt
            },
            ReturnValues: 'UPDATED_NEW'
        }));

        const used = Number(updateResult.Attributes?.requestCount || 1);
        return {
            allowed: true,
            limit: HOURLY_LIMIT,
            used,
            remaining: Math.max(0, HOURLY_LIMIT - used),
            resetAt: hourResetIso(hourKey)
        };
    } catch (error) {
        if (error?.name === 'ConditionalCheckFailedException') {
            const used = await getCurrentCount(usageKey);
            return {
                allowed: false,
                limit: HOURLY_LIMIT,
                used,
                remaining: 0,
                resetAt: hourResetIso(hourKey)
            };
        }

        if (error?.name === 'ResourceNotFoundException') {
            throw new Error(`Rate limit table not found: ${USAGE_TABLE}`);
        }

        throw error;
    }
}
