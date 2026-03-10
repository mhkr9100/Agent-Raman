/**
 * One-time migration:
 * Normalize legacy agent blueprint tool IDs to canonical IDs.
 *
 * Run:
 *   node backend/scripts/migrate-agent-tool-ids.js
 *
 * Optional env:
 *   TABLE_PREFIX=RamN_
 *   AWS_REGION=us-east-1
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeToolIds, toCanonicalToolId } from '../shared/tool-ids.js';

const REGION = process.env.AWS_REGION || 'us-east-1';
const PREFIX = process.env.TABLE_PREFIX || 'RamN_';
const AGENTS_TABLE = `${PREFIX}Agents`;

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

function flattenRequestedToolIds(blueprint = {}) {
    const fromToolIds = Array.isArray(blueprint.toolIds) ? blueprint.toolIds : [];
    const fromTools = Array.isArray(blueprint.tools)
        ? blueprint.tools
            .map(tool => {
                if (!tool) return null;
                if (typeof tool === 'string') return tool;
                if (typeof tool === 'object' && tool.toolId) return tool.toolId;
                return null;
            })
            .filter(Boolean)
        : [];

    return [...fromToolIds, ...fromTools].filter(Boolean);
}

async function fetchAllAgents() {
    const items = [];
    let cursor;
    do {
        const result = await docClient.send(new ScanCommand({
            TableName: AGENTS_TABLE,
            ExclusiveStartKey: cursor
        }));
        items.push(...(result.Items || []));
        cursor = result.LastEvaluatedKey;
    } while (cursor);

    return items;
}

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — Agent Tool ID Migration');
    console.log(`  Region: ${REGION}`);
    console.log(`  Table: ${AGENTS_TABLE}`);
    console.log('═══════════════════════════════════════════\n');

    const agents = await fetchAllAgents();
    console.log(`Found ${agents.length} agents.\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const unresolved = [];

    for (const agent of agents) {
        const agentId = agent.agentId;
        const userId = agent.userId;
        const blueprint = agent.blueprint || {};

        const requestedIds = flattenRequestedToolIds(blueprint);
        const canonicalIds = normalizeToolIds(requestedIds);

        const unknownIds = requestedIds
            .filter(id => typeof id === 'string')
            .filter(id => !canonicalIds.includes(toCanonicalToolId(id)));

        const currentIds = Array.isArray(blueprint.toolIds) ? blueprint.toolIds : [];
        const alreadyCanonical =
            currentIds.length === canonicalIds.length &&
            currentIds.every((id, idx) => id === canonicalIds[idx]);

        if (canonicalIds.length === 0 || alreadyCanonical) {
            skipped += 1;
            if (unknownIds.length > 0) {
                unresolved.push({ agentId, userId, unknownIds });
            }
            continue;
        }

        try {
            await docClient.send(new UpdateCommand({
                TableName: AGENTS_TABLE,
                Key: { agentId, userId },
                UpdateExpression: 'SET #blueprint.#toolIds = :toolIds, #updatedAt = :updatedAt',
                ExpressionAttributeNames: {
                    '#blueprint': 'blueprint',
                    '#toolIds': 'toolIds',
                    '#updatedAt': 'updatedAt'
                },
                ExpressionAttributeValues: {
                    ':toolIds': canonicalIds,
                    ':updatedAt': new Date().toISOString()
                }
            }));

            updated += 1;
            console.log(`✅ ${agentId} -> [${canonicalIds.join(', ')}]`);
        } catch (error) {
            failed += 1;
            console.error(`❌ ${agentId}: ${error.message}`);
        }

        if (unknownIds.length > 0) {
            unresolved.push({ agentId, userId, unknownIds });
        }
    }

    console.log('\n───────────────────────────────────────────');
    console.log(`Updated: ${updated} | Skipped: ${skipped} | Failed: ${failed}`);

    if (unresolved.length > 0) {
        console.log('\nUnresolved tool IDs (manual review):');
        for (const row of unresolved) {
            console.log(`- ${row.agentId} (${row.userId}): ${row.unknownIds.join(', ')}`);
        }
    }

    console.log('───────────────────────────────────────────\n');
}

main().catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
});
