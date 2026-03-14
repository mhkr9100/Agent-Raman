/**
 * RamN AI — Seed Data Script
 * 
 * Populates DynamoDB tables with initial data:
 *   - RamN_ToolRegistry    (core tool set)
 *   - RamN_ModelRegistry   (3 models)
 * 
 * Uses DynamoDB DocumentClient directly.
 * Checks if items exist before inserting (idempotent).
 * 
 * Run: node backend/scripts/seed-data.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

// ─── Helper: put if not exists ───────────────────────────────────

async function putIfNotExists(tableName, keyFields, item) {
    // Build key from keyFields
    const key = {};
    for (const field of keyFields) {
        key[field] = item[field];
    }

    // Check if already exists
    const existing = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: key
    }));

    if (existing.Item) {
        console.log(`  ⏭️  ${tableName} → ${JSON.stringify(key)} — already exists, skipping`);
        return 'skipped';
    }

    // Insert with timestamp
    await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
            ...item,
            createdAt: new Date().toISOString()
        }
    }));
    console.log(`  ✅ ${tableName} → ${item.name || item.toolId || item.modelId || item.templateId}`);
    return 'created';
}

// ══════════════════════════════════════════════════════════════════
//  SEED 1: RamN_ToolRegistry
// ══════════════════════════════════════════════════════════════════

const TOOLS = [
    {
        toolId: 'web-search',
        name: 'Google Search API',
        type: 'plugin',
        category: 'research',
        description: 'Live internet search powered by Google Custom Search API',
        capabilities: ['search', 'fetch_url'],
        status: 'active'
    },
    {
        toolId: 'thinking',
        name: 'Deep Thinking',
        type: 'plugin',
        category: 'analysis',
        description: 'Structured multi-step reasoning for complex tasks',
        capabilities: ['reasoning', 'planning'],
        status: 'active'
    },
    {
        toolId: 'doc-reader',
        name: 'Document Reader',
        type: 'plugin',
        category: 'knowledge',
        description: 'Retrieve relevant snippets from uploaded documents',
        capabilities: ['document_retrieval', 'snippet_extraction'],
        status: 'active'
    }
];

// ══════════════════════════════════════════════════════════════════
//  SEED 2: RamN_ModelRegistry
// ══════════════════════════════════════════════════════════════════

const MODELS = [
    {
        modelId: 'gemini-2.5-flash',
        provider: 'google',
        name: 'Gemini 2.5 Flash',
        strengths: 'Speed, Directness',
        contextWindow: 1000000,
        costTier: 'low',
        bestFor: ['Interactions', 'Tool Use'],
        temperature_default: 0.3
    },
    {
        modelId: 'gemini-2.5-pro',
        provider: 'google',
        name: 'Gemini 2.5 Pro',
        strengths: 'Logic, Coding, Math',
        contextWindow: 1000000,
        costTier: 'high',
        bestFor: ['Architecture', 'Logic'],
        temperature_default: 0.2
    },
    {
        modelId: 'gemini-2.5-flash-lite',
        provider: 'google',
        name: 'Gemini 2.5 Flash Lite',
        strengths: 'Ultra-fast, cost-efficient',
        contextWindow: 1000000,
        costTier: 'lowest',
        bestFor: ['High-volume utility tasks'],
        temperature_default: 0.2
    }
];

// ─── Main ────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — Seed Data');
    console.log(`  Region: ${REGION}`);
    console.log('═══════════════════════════════════════════\n');

    const results = { created: 0, skipped: 0, failed: 0 };

    // ── Seed Tools ──
    console.log('▸ Seeding RamN_ToolRegistry...');
    for (const tool of TOOLS) {
        try {
            const status = await putIfNotExists('RamN_ToolRegistry', ['toolId'], tool);
            results[status]++;
        } catch (error) {
            console.error(`  ❌ FAILED: ${tool.toolId} — ${error.message}`);
            results.failed++;
        }
    }

    // ── Seed Models ──
    console.log('\n▸ Seeding RamN_ModelRegistry...');
    for (const model of MODELS) {
        try {
            const status = await putIfNotExists('RamN_ModelRegistry', ['modelId'], model);
            results[status]++;
        } catch (error) {
            console.error(`  ❌ FAILED: ${model.modelId} — ${error.message}`);
            results.failed++;
        }
    }

    console.log('\n───────────────────────────────────────────');
    console.log(`  Created: ${results.created}  |  Skipped: ${results.skipped}  |  Failed: ${results.failed}`);
    console.log('═══════════════════════════════════════════\n');

    if (results.failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
