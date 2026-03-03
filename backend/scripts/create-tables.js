/**
 * RamN AI — Create DynamoDB Tables
 * 
 * Creates all 6 tables required by the RamN backend.
 * Skips tables that already exist.
 * 
 * Run: node backend/scripts/create-tables.js
 * 
 * Uses AWS region from AWS_REGION env var or defaults to us-east-1
 */

import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand
} from '@aws-sdk/client-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({ region: REGION });

// ─── Table Definitions ───────────────────────────────────────────

const TABLE_DEFINITIONS = [
    {
        TableName: 'RamN_Agents',
        KeySchema: [
            { AttributeName: 'agentId', KeyType: 'HASH' },
            { AttributeName: 'userId', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'agentId', AttributeType: 'S' },
            { AttributeName: 'userId', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'userId-index',
                KeySchema: [
                    { AttributeName: 'userId', KeyType: 'HASH' }
                ],
                Projection: { ProjectionType: 'ALL' }
            }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    },
    {
        TableName: 'RamN_Conversations',
        KeySchema: [
            { AttributeName: 'conversationId', KeyType: 'HASH' },
            { AttributeName: 'timestamp', KeyType: 'RANGE' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'conversationId', AttributeType: 'S' },
            { AttributeName: 'timestamp', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    },
    {
        TableName: 'RamN_ToolRegistry',
        KeySchema: [
            { AttributeName: 'toolId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'toolId', AttributeType: 'S' },
            { AttributeName: 'category', AttributeType: 'S' }
        ],
        GlobalSecondaryIndexes: [
            {
                IndexName: 'category-index',
                KeySchema: [
                    { AttributeName: 'category', KeyType: 'HASH' }
                ],
                Projection: { ProjectionType: 'ALL' }
            }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    },
    {
        TableName: 'RamN_SpecialAgents',
        KeySchema: [
            { AttributeName: 'templateId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'templateId', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    },
    {
        TableName: 'RamN_UserMap',
        KeySchema: [
            { AttributeName: 'userId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'userId', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    },
    {
        TableName: 'RamN_ModelRegistry',
        KeySchema: [
            { AttributeName: 'modelId', KeyType: 'HASH' }
        ],
        AttributeDefinitions: [
            { AttributeName: 'modelId', AttributeType: 'S' }
        ],
        BillingMode: 'PAY_PER_REQUEST'
    }
];

// ─── Check if table exists ───────────────────────────────────────

async function tableExists(tableName) {
    try {
        await client.send(new DescribeTableCommand({ TableName: tableName }));
        return true;
    } catch (error) {
        if (error.name === 'ResourceNotFoundException') return false;
        throw error;
    }
}

// ─── Create a single table ───────────────────────────────────────

async function createTable(definition) {
    const { TableName } = definition;

    if (await tableExists(TableName)) {
        console.log(`  ⏭️  ${TableName} — already exists, skipping`);
        return 'skipped';
    }

    try {
        await client.send(new CreateTableCommand(definition));
        console.log(`  ✅ ${TableName} — created successfully`);
        return 'created';
    } catch (error) {
        console.error(`  ❌ ${TableName} — FAILED: ${error.message}`);
        return 'failed';
    }
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — DynamoDB Table Creation');
    console.log(`  Region: ${REGION}`);
    console.log('═══════════════════════════════════════════\n');

    const results = { created: 0, skipped: 0, failed: 0 };

    for (const def of TABLE_DEFINITIONS) {
        const status = await createTable(def);
        results[status]++;
    }

    console.log('\n───────────────────────────────────────────');
    console.log(`  Created: ${results.created}  |  Skipped: ${results.skipped}  |  Failed: ${results.failed}`);
    console.log('═══════════════════════════════════════════\n');

    if (results.failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
