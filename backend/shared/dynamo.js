/**
 * RamN AI — DynamoDB Helpers Module
 * 
 * Structured CRUD operations for all RamN tables.
 * Uses the same AWS region as the existing db.ts.
 * 
 * Tables (prefix: RamN_):
 *   RamN_Agents          - Agent blueprints (PK: agentId, SK: userId)
 *   RamN_Teams           - Team blueprints (PK: teamId, SK: userId)
 *   RamN_Conversations   - Chat history (PK: conversationId, SK: timestamp)
 *   RamN_ToolRegistry    - Available tools (PK: toolId)
 *   RamN_UserMap          - User context/preferences (PK: userId)
 *   RamN_Usage           - Per-user hourly usage counters (PK: usageKey)
 *   RamN_ModelRegistry   - Available AI models (PK: modelId)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    DeleteCommand,
    QueryCommand,
    ScanCommand,
    UpdateCommand
} from '@aws-sdk/lib-dynamodb';

// ─── Client Setup ────────────────────────────────────────────────

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

// ─── Table Names ─────────────────────────────────────────────────

const PREFIX = process.env.TABLE_PREFIX || '';

const TABLES = {
    AGENTS: `${PREFIX}Agents`,
    TEAMS: `${PREFIX}Teams`,
    CONVERSATIONS: `${PREFIX}Conversations`,
    TOOL_REGISTRY: `${PREFIX}ToolRegistry`,
    USER_MAP: `${PREFIX}UserMap`,
    USAGE: `${PREFIX}Usage`,
    MODEL_REGISTRY: `${PREFIX}ModelRegistry`,
    DOCUMENTS: `${PREFIX}Documents`,
    DOCUMENT_CHUNKS: `${PREFIX}DocumentChunks`
};
const ENTITY_TABLE_NAME = process.env.TABLE_NAME || 'RamN-Entities';

// ─── Error Wrapper ───────────────────────────────────────────────

function wrapError(table, operation, error) {
    if (error.name === 'ResourceNotFoundException') {
        throw new Error(`Table ${table} does not exist. Run seed script first.`);
    }
    console.error(`[dynamo] ❌ ${operation} on ${table} failed:`, error.message);
    throw error;
}

// ══════════════════════════════════════════════════════════════════
//  AGENTS — RamN_Agents (PK: agentId, SK: userId)
// ══════════════════════════════════════════════════════════════════

/**
 * Save a new agent blueprint.
 * @param {Object} agent - { agentId, userId, name, description, blueprint, status }
 */
export async function saveAgent({ agentId, userId, name, description, blueprint, status = 'active' }) {
    console.log(`[dynamo] saveAgent: ${agentId} for user ${userId.substring(0, 8)}***`);
    try {
        const now = new Date().toISOString();
        await docClient.send(new PutCommand({
            TableName: TABLES.AGENTS,
            Item: {
                agentId,
                userId,
                name,
                description,
                blueprint,
                status,
                createdAt: now,
                updatedAt: now
            }
        }));
        console.log(`[dynamo] ✅ Agent saved: ${name} (${agentId})`);
        return { agentId, status: 'created' };
    } catch (error) {
        wrapError(TABLES.AGENTS, 'saveAgent', error);
    }
}

/**
 * Get a single agent by agentId and userId.
 * @returns {Object|null} Agent record or null
 */
export async function getAgent(agentId, userId) {
    console.log(`[dynamo] getAgent: ${agentId}`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.AGENTS,
            Key: { agentId, userId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.AGENTS, 'getAgent', error);
    }
}

/**
 * List all agents for a user.
 * Uses GSI: userId-index (GSI with PK=userId)
 * @returns {Array} List of agent records
 */
export async function listAgentsByUser(userId) {
    console.log(`[dynamo] listAgentsByUser: ${userId.substring(0, 8)}***`);
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.AGENTS,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId }
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} agents for user`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.AGENTS, 'listAgentsByUser', error);
    }
}

/**
 * Partial update an agent. Auto-updates updatedAt.
 * @param {string} agentId
 * @param {string} userId
 * @param {Object} updates - Key-value pairs to update
 */
export async function updateAgent(agentId, userId, updates) {
    console.log(`[dynamo] updateAgent: ${agentId}`, Object.keys(updates));
    try {
        // Build update expression dynamically
        const expressionParts = [];
        const expressionValues = {};
        const expressionNames = {};

        // Always update updatedAt
        updates.updatedAt = new Date().toISOString();

        for (const [key, value] of Object.entries(updates)) {
            const attrName = `#${key}`;
            const attrValue = `:${key}`;
            expressionParts.push(`${attrName} = ${attrValue}`);
            expressionNames[attrName] = key;
            expressionValues[attrValue] = value;
        }

        await docClient.send(new UpdateCommand({
            TableName: TABLES.AGENTS,
            Key: { agentId, userId },
            UpdateExpression: `SET ${expressionParts.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues
        }));
        console.log(`[dynamo] ✅ Agent updated: ${agentId}`);
    } catch (error) {
        wrapError(TABLES.AGENTS, 'updateAgent', error);
    }
}

/**
 * Delete an agent.
 */
export async function deleteAgent(agentId, userId) {
    console.log(`[dynamo] deleteAgent: ${agentId}`);
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLES.AGENTS,
            Key: { agentId, userId }
        }));
        console.log(`[dynamo] ✅ Agent deleted: ${agentId}`);
    } catch (error) {
        wrapError(TABLES.AGENTS, 'deleteAgent', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  TEAMS — RamN_Teams (PK: teamId, SK: userId)
// ══════════════════════════════════════════════════════════════════

export async function saveTeam({ teamId, userId, name, description, agentIds = [], status = 'active' }) {
    console.log(`[dynamo] saveTeam: ${teamId} for user ${userId.substring(0, 8)}***`);
    try {
        const now = new Date().toISOString();
        const existing = await getTeam(teamId, userId);
        await docClient.send(new PutCommand({
            TableName: TABLES.TEAMS,
            Item: {
                teamId,
                userId,
                name,
                description: description || '',
                agentIds: Array.isArray(agentIds) ? agentIds : [],
                status,
                createdAt: existing?.createdAt || now,
                updatedAt: now
            }
        }));
        console.log(`[dynamo] ✅ Team saved: ${name} (${teamId})`);
        return { teamId, status: existing ? 'updated' : 'created' };
    } catch (error) {
        wrapError(TABLES.TEAMS, 'saveTeam', error);
    }
}

export async function getTeam(teamId, userId) {
    console.log(`[dynamo] getTeam: ${teamId}`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.TEAMS,
            Key: { teamId, userId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.TEAMS, 'getTeam', error);
    }
}

export async function listTeamsByUser(userId) {
    console.log(`[dynamo] listTeamsByUser: ${userId.substring(0, 8)}***`);
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.TEAMS,
            IndexName: 'userId-index',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId }
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} teams for user`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.TEAMS, 'listTeamsByUser', error);
    }
}

export async function deleteTeam(teamId, userId) {
    console.log(`[dynamo] deleteTeam: ${teamId}`);
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLES.TEAMS,
            Key: { teamId, userId }
        }));
        console.log(`[dynamo] ✅ Team deleted: ${teamId}`);
    } catch (error) {
        wrapError(TABLES.TEAMS, 'deleteTeam', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  CONVERSATIONS — RamN_Conversations (PK: conversationId, SK: timestamp)
// ══════════════════════════════════════════════════════════════════

/**
 * Save a message to a conversation.
 * @param {Object} msg - { conversationId, role, content, agentId, userId }
 */
export async function saveMessage({ conversationId, role, content, agentId, userId }) {
    const timestamp = new Date().toISOString();
    console.log(`[dynamo] saveMessage: ${conversationId} [${role}]`);
    try {
        await docClient.send(new PutCommand({
            TableName: TABLES.CONVERSATIONS,
            Item: {
                conversationId,
                timestamp,
                role,
                content,
                agentId: agentId || null,
                userId
            }
        }));
        console.log(`[dynamo] ✅ Message saved to conversation ${conversationId}`);
    } catch (error) {
        wrapError(TABLES.CONVERSATIONS, 'saveMessage', error);
    }
}

/**
 * Get all messages in a conversation, sorted by timestamp.
 * @returns {Array} List of messages in chronological order
 */
export async function getConversation(conversationId) {
    console.log(`[dynamo] getConversation: ${conversationId}`);
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.CONVERSATIONS,
            KeyConditionExpression: 'conversationId = :cid',
            ExpressionAttributeValues: { ':cid': conversationId },
            ScanIndexForward: true // ascending order (oldest first)
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} messages`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.CONVERSATIONS, 'getConversation', error);
    }
}

function tokenizeQuery(input) {
    return String(input || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .filter(Boolean)
        .filter((token) => token.length > 2)
        .slice(0, 20);
}

function scoreMemory(memory, queryTokens, agentId) {
    const content = String(memory?.content || '').toLowerCase();
    if (!content) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (agentId && memory?.agentId === agentId) score += 4;
    if (queryTokens.length === 0) score += 1;

    for (const token of queryTokens) {
        if (content.includes(token)) score += 3;
    }

    const createdAt = Date.parse(memory?.createdAt || '');
    if (Number.isFinite(createdAt)) {
        const ageHours = Math.max(0, (Date.now() - createdAt) / (1000 * 60 * 60));
        score += Math.max(0, 2 - (ageHours / 72));
    }

    return score;
}

/**
 * Search user memories already extracted from prior conversations.
 * These are stored in the shared Entities table under USER#{userId} / memories#*.
 */
export async function searchRelevantMemories(userId, query, { agentId, limit = 5, scanLimit = 250 } = {}) {
    console.log(`[dynamo] searchRelevantMemories: ${userId.substring(0, 8)}***`);
    try {
        const pk = `USER#${userId}`;
        const result = await docClient.send(new QueryCommand({
            TableName: ENTITY_TABLE_NAME,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
            ExpressionAttributeValues: {
                ':pk': pk,
                ':skPrefix': 'memories#'
            },
            ScanIndexForward: false,
            Limit: scanLimit
        }));

        const memories = (result.Items || [])
            .map((item) => item.data)
            .filter(Boolean);

        if (memories.length === 0) return [];

        const queryTokens = tokenizeQuery(query);
        return memories
            .map((memory) => ({
                ...memory,
                _score: scoreMemory(memory, queryTokens, agentId)
            }))
            .filter((memory) => Number.isFinite(memory._score))
            .sort((a, b) => {
                if (b._score !== a._score) return b._score - a._score;
                return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
            })
            .slice(0, limit)
            .map(({ _score, ...memory }) => memory);
    } catch (error) {
        wrapError(ENTITY_TABLE_NAME, 'searchRelevantMemories', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  TOOL REGISTRY — RamN_ToolRegistry (PK: toolId)
// ══════════════════════════════════════════════════════════════════

/**
 * List all available tools.
 * @returns {Array}
 */
export async function listTools() {
    console.log('[dynamo] listTools');
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.TOOL_REGISTRY
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} tools`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.TOOL_REGISTRY, 'listTools', error);
    }
}

/**
 * Get tools filtered by category.
 * @param {string} category
 * @returns {Array}
 */
export async function getToolsByCategory(category) {
    console.log(`[dynamo] getToolsByCategory: ${category}`);
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.TOOL_REGISTRY,
            FilterExpression: 'category = :cat',
            ExpressionAttributeValues: { ':cat': category }
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} tools in category "${category}"`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.TOOL_REGISTRY, 'getToolsByCategory', error);
    }
}

/**
 * Get a single tool by ID.
 * @returns {Object|null}
 */
export async function getToolById(toolId) {
    console.log(`[dynamo] getToolById: ${toolId}`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.TOOL_REGISTRY,
            Key: { toolId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.TOOL_REGISTRY, 'getToolById', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  USER MAP — RamN_UserMap (PK: userId)
// ══════════════════════════════════════════════════════════════════

/**
 * Get user context/preferences. Returns empty default if not found.
 * @returns {Object}
 */
export async function getUserMap(userId) {
    console.log(`[dynamo] getUserMap: ${userId.substring(0, 8)}***`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.USER_MAP,
            Key: { userId }
        }));
        return result.Item || {
            userId,
            preferences: {},
            agentHistory: [],
            orgContext: {},
            conversationSummaries: []
        };
    } catch (error) {
        wrapError(TABLES.USER_MAP, 'getUserMap', error);
    }
}

/**
 * Partial update of user context. Auto-updates updatedAt.
 * @param {string} userId
 * @param {Object} updates - Key-value pairs to update
 */
export async function updateUserMap(userId, updates) {
    console.log(`[dynamo] updateUserMap: ${userId.substring(0, 8)}***`, Object.keys(updates));
    try {
        updates.updatedAt = new Date().toISOString();

        const expressionParts = [];
        const expressionValues = {};
        const expressionNames = {};

        for (const [key, value] of Object.entries(updates)) {
            const attrName = `#${key}`;
            const attrValue = `:${key}`;
            expressionParts.push(`${attrName} = ${attrValue}`);
            expressionNames[attrName] = key;
            expressionValues[attrValue] = value;
        }

        await docClient.send(new UpdateCommand({
            TableName: TABLES.USER_MAP,
            Key: { userId },
            UpdateExpression: `SET ${expressionParts.join(', ')}`,
            ExpressionAttributeNames: expressionNames,
            ExpressionAttributeValues: expressionValues
        }));
        console.log(`[dynamo] ✅ UserMap updated for ${userId}`);
    } catch (error) {
        wrapError(TABLES.USER_MAP, 'updateUserMap', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  MODEL REGISTRY — RamN_ModelRegistry (PK: modelId)
// ══════════════════════════════════════════════════════════════════

/**
 * List all available AI models.
 * @returns {Array}
 */
export async function listModels() {
    console.log('[dynamo] listModels');
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.MODEL_REGISTRY
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} models`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.MODEL_REGISTRY, 'listModels', error);
    }
}

/**
 * Get a single model by ID.
 * @returns {Object|null}
 */
export async function getModelById(modelId) {
    console.log(`[dynamo] getModelById: ${modelId}`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.MODEL_REGISTRY,
            Key: { modelId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.MODEL_REGISTRY, 'getModelById', error);
    }
}

// ══════════════════════════════════════════════════════════════════
//  DOCUMENTS — RamN_Documents (PK: docId, SK: userId)
// ══════════════════════════════════════════════════════════════════

export async function saveDocument({
    docId,
    userId,
    ownerType,
    ownerId,
    fileName,
    fileKey,
    fileUrl,
    textKey,
    textUrl,
    contentType,
    size,
    createdAt,
    updatedAt
}) {
    console.log(`[dynamo] saveDocument: ${docId} for user ${userId.substring(0, 8)}*** (${ownerType}:${ownerId})`);
    try {
        const now = new Date().toISOString();
        const ownerKey = `${userId}#${ownerType}#${ownerId}`;
        const item = {
            docId,
            userId,
            ownerType,
            ownerId,
            ownerKey,
            fileName,
            fileKey,
            fileUrl: fileUrl || null,
            textKey: textKey || null,
            textUrl: textUrl || null,
            contentType: contentType || 'application/octet-stream',
            size: Number(size) || 0,
            createdAt: createdAt || now,
            updatedAt: updatedAt || now
        };

        await docClient.send(new PutCommand({
            TableName: TABLES.DOCUMENTS,
            Item: item
        }));

        return item;
    } catch (error) {
        wrapError(TABLES.DOCUMENTS, 'saveDocument', error);
    }
}

export async function getDocument(docId, userId) {
    console.log(`[dynamo] getDocument: ${docId} for user ${userId.substring(0, 8)}***`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.DOCUMENTS,
            Key: { docId, userId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.DOCUMENTS, 'getDocument', error);
    }
}

export async function listDocumentsByOwner(userId, ownerType, ownerId) {
    console.log(`[dynamo] listDocumentsByOwner: ${userId.substring(0, 8)}*** ${ownerType}:${ownerId}`);
    try {
        const ownerKey = `${userId}#${ownerType}#${ownerId}`;
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.DOCUMENTS,
            IndexName: 'ownerKey-createdAt-index',
            KeyConditionExpression: 'ownerKey = :ownerKey',
            ExpressionAttributeValues: {
                ':ownerKey': ownerKey
            },
            ScanIndexForward: false
        }));
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.DOCUMENTS, 'listDocumentsByOwner', error);
    }
}

export async function deleteDocument(docId, userId) {
    console.log(`[dynamo] deleteDocument: ${docId} for user ${userId.substring(0, 8)}***`);
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLES.DOCUMENTS,
            Key: { docId, userId }
        }));
        return { success: true, docId };
    } catch (error) {
        wrapError(TABLES.DOCUMENTS, 'deleteDocument', error);
    }
}

export async function saveDocumentChunks(chunks = []) {
    if (!Array.isArray(chunks) || chunks.length === 0) return [];
    console.log(`[dynamo] saveDocumentChunks: ${chunks.length} chunk(s)`);
    try {
        for (const chunk of chunks) {
            await docClient.send(new PutCommand({
                TableName: TABLES.DOCUMENT_CHUNKS,
                Item: {
                    ...chunk,
                    ownerKey: `${chunk.userId}#${chunk.ownerType}#${chunk.ownerId}`,
                    updatedAt: new Date().toISOString()
                }
            }));
        }
        return chunks;
    } catch (error) {
        wrapError(TABLES.DOCUMENT_CHUNKS, 'saveDocumentChunks', error);
    }
}

export async function listDocumentChunksByOwnerKey(ownerKey, { limit = 120 } = {}) {
    console.log(`[dynamo] listDocumentChunksByOwnerKey: ${ownerKey}`);
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.DOCUMENT_CHUNKS,
            IndexName: 'ownerKey-createdAt-index',
            KeyConditionExpression: 'ownerKey = :ownerKey',
            ExpressionAttributeValues: {
                ':ownerKey': ownerKey
            },
            ScanIndexForward: false,
            Limit: limit
        }));
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.DOCUMENT_CHUNKS, 'listDocumentChunksByOwnerKey', error);
    }
}

export async function listDocumentChunksByDocId(docId, { limit = 64 } = {}) {
    console.log(`[dynamo] listDocumentChunksByDocId: ${docId}`);
    try {
        const result = await docClient.send(new QueryCommand({
            TableName: TABLES.DOCUMENT_CHUNKS,
            IndexName: 'docId-createdAt-index',
            KeyConditionExpression: 'docId = :docId',
            ExpressionAttributeValues: {
                ':docId': docId
            },
            ScanIndexForward: true,
            Limit: limit
        }));
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.DOCUMENT_CHUNKS, 'listDocumentChunksByDocId', error);
    }
}

export async function deleteDocumentChunksByDocId(docId) {
    console.log(`[dynamo] deleteDocumentChunksByDocId: ${docId}`);
    try {
        const chunks = await listDocumentChunksByDocId(docId, { limit: 256 });
        for (const chunk of chunks || []) {
            await docClient.send(new DeleteCommand({
                TableName: TABLES.DOCUMENT_CHUNKS,
                Key: { chunkId: chunk.chunkId }
            }));
        }
        return { success: true, count: chunks?.length || 0 };
    } catch (error) {
        wrapError(TABLES.DOCUMENT_CHUNKS, 'deleteDocumentChunksByDocId', error);
    }
}

// ─── Export table names for scripts that need them ────────────────

export { TABLES };

// ══════════════════════════════════════════════════════════════════
//  GDPR — Cascading User Data Deletion
// ══════════════════════════════════════════════════════════════════

/**
 * Delete all data associated with a user (GDPR cascading delete).
 * Removes agents, UserMap entry, and documents for the given userId.
 * Note: Conversation cleanup is omitted (no userId index on conversations table).
 * @param {string} userId
 * @returns {{ deleted: boolean, errors: string[] }}
 */
export async function deleteAllUserData(userId) {
    console.log(`[dynamo] deleteAllUserData: ${userId.substring(0, 8)}***`);
    const errors = [];

    // 1. Delete all agents
    try {
        const agents = await listAgentsByUser(userId);
        for (const agent of agents) {
            await deleteAgent(agent.agentId, userId);
        }
        console.log(`[dynamo] ✅ Deleted ${agents.length} agents for user`);
    } catch (error) {
        console.error('[dynamo] ❌ Failed to delete agents:', error.message);
        errors.push(`agents: ${error.message}`);
    }

    // 1b. Delete all teams
    try {
        const teams = await listTeamsByUser(userId);
        for (const team of teams) {
            await deleteTeam(team.teamId, userId);
        }
        console.log(`[dynamo] ✅ Deleted ${teams.length} teams for user`);
    } catch (error) {
        console.error('[dynamo] ❌ Failed to delete teams:', error.message);
        errors.push(`teams: ${error.message}`);
    }

    // 2. Delete UserMap entry
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLES.USER_MAP,
            Key: { userId }
        }));
        console.log('[dynamo] ✅ Deleted UserMap for user');
    } catch (error) {
        console.error('[dynamo] ❌ Failed to delete UserMap:', error.message);
        errors.push(`usermap: ${error.message}`);
    }

    // 3. Delete all documents (scan by userId filter)
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.DOCUMENTS,
            FilterExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId }
        }));
        const docs = result.Items || [];
        for (const doc of docs) {
            await deleteDocumentChunksByDocId(doc.docId);
            await deleteDocument(doc.docId, userId);
        }
        console.log(`[dynamo] ✅ Deleted ${docs.length} documents for user`);
    } catch (error) {
        console.error('[dynamo] ❌ Failed to delete documents:', error.message);
        errors.push(`documents: ${error.message}`);
    }

    if (errors.length > 0) {
        console.error('[dynamo] deleteAllUserData completed with errors:', errors);
    }

    return { deleted: true, errors };
}

export default {
    // Agents
    saveAgent, getAgent, listAgentsByUser, updateAgent, deleteAgent,
    // Teams
    saveTeam, getTeam, listTeamsByUser, deleteTeam,
    // Conversations
    saveMessage, getConversation,
    // Memories
    searchRelevantMemories,
    // Tool Registry
    listTools, getToolsByCategory, getToolById,
    // UserMap
    getUserMap, updateUserMap,
    // Model Registry
    listModels, getModelById,
    // Documents
    saveDocument, getDocument, listDocumentsByOwner, deleteDocument,
    saveDocumentChunks, listDocumentChunksByOwnerKey, listDocumentChunksByDocId, deleteDocumentChunksByDocId,
    // GDPR
    deleteAllUserData,
    // Constants
    TABLES
};
