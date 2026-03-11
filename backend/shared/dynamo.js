/**
 * RamN AI — DynamoDB Helpers Module
 * 
 * Structured CRUD operations for all RamN tables.
 * Uses the same AWS region as the existing db.ts.
 * 
 * Tables (prefix: RamN_):
 *   RamN_Agents          - Agent blueprints (PK: agentId, SK: userId)
 *   RamN_Conversations   - Chat history (PK: conversationId, SK: timestamp)
 *   RamN_ToolRegistry    - Available tools (PK: toolId)
 *   RamN_SpecialAgents   - Special agent templates (PK: templateId)
 *   RamN_UserMap          - User context/preferences (PK: userId)
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
    CONVERSATIONS: `${PREFIX}Conversations`,
    TOOL_REGISTRY: `${PREFIX}ToolRegistry`,
    SPECIAL_AGENTS: `${PREFIX}SpecialAgents`,
    USER_MAP: `${PREFIX}UserMap`,
    MODEL_REGISTRY: `${PREFIX}ModelRegistry`,
    DOCUMENTS: `${PREFIX}Documents`
};

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
    console.log(`[dynamo] saveAgent: ${agentId}`);
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
    console.log('[dynamo] listAgentsByUser');
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
//  SPECIAL AGENTS — RamN_SpecialAgents (PK: templateId)
// ══════════════════════════════════════════════════════════════════

/**
 * List all special agent templates.
 * @returns {Array}
 */
export async function listSpecialAgents() {
    console.log('[dynamo] listSpecialAgents');
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.SPECIAL_AGENTS
        }));
        console.log(`[dynamo] ✅ Found ${result.Items?.length || 0} special agent templates`);
        return result.Items || [];
    } catch (error) {
        wrapError(TABLES.SPECIAL_AGENTS, 'listSpecialAgents', error);
    }
}

/**
 * Get a single special agent template.
 * @returns {Object|null}
 */
export async function getSpecialAgent(templateId) {
    console.log(`[dynamo] getSpecialAgent: ${templateId}`);
    try {
        const result = await docClient.send(new GetCommand({
            TableName: TABLES.SPECIAL_AGENTS,
            Key: { templateId }
        }));
        return result.Item || null;
    } catch (error) {
        wrapError(TABLES.SPECIAL_AGENTS, 'getSpecialAgent', error);
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
    console.log('[dynamo] getUserMap');
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
    console.log('[dynamo] updateUserMap', Object.keys(updates));
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
        console.log(`[dynamo] updateUserMap ✅ UserMap updated`);
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
    size
}) {
    console.log(`[dynamo] saveDocument: ${docId} (${ownerType}:${ownerId})`);
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
            createdAt: now,
            updatedAt: now
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
    console.log(`[dynamo] getDocument: ${docId}`);
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
    console.log(`[dynamo] listDocumentsByOwner: ${ownerType}:${ownerId}`);
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
    console.log(`[dynamo] deleteDocument: ${docId}`);
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

// ─── Export table names for scripts that need them ────────────────

export { TABLES };

// ══════════════════════════════════════════════════════════════════
//  GDPR — Cascade Delete All User Data
// ══════════════════════════════════════════════════════════════════

/**
 * Delete ALL data belonging to a user across all tables.
 * Used for GDPR Article 17 (Right to Erasure) compliance.
 * @param {string} userId - The Cognito sub (user ID)
 */
export async function deleteAllUserData(userId) {
    console.log('[dynamo] deleteAllUserData: cascading delete initiated');
    const errors = [];

    // 1. Delete all agents
    try {
        const agents = await listAgentsByUser(userId);
        for (const agent of agents) {
            await deleteAgent(agent.agentId, userId);
        }
        console.log(`[dynamo] ✅ Deleted ${agents.length} agents`);
    } catch (e) {
        console.error('[dynamo] ❌ Failed to delete agents:', e.message);
        errors.push(`agents: ${e.message}`);
    }

    // 2. Delete UserMap
    try {
        await docClient.send(new DeleteCommand({
            TableName: TABLES.USER_MAP,
            Key: { userId }
        }));
        console.log('[dynamo] ✅ Deleted UserMap');
    } catch (e) {
        console.error('[dynamo] ❌ Failed to delete UserMap:', e.message);
        errors.push(`userMap: ${e.message}`);
    }

    // 3. Delete all documents owned by user
    try {
        const result = await docClient.send(new ScanCommand({
            TableName: TABLES.DOCUMENTS,
            FilterExpression: 'userId = :uid',
            ExpressionAttributeValues: { ':uid': userId }
        }));
        const docs = result.Items || [];
        for (const doc of docs) {
            await deleteDocument(doc.docId, userId);
        }
        console.log(`[dynamo] ✅ Deleted ${docs.length} documents`);
    } catch (e) {
        console.error('[dynamo] ❌ Failed to delete documents:', e.message);
        errors.push(`documents: ${e.message}`);
    }

    if (errors.length > 0) {
        console.warn(`[dynamo] deleteAllUserData completed with ${errors.length} errors:`, errors);
    }

    return { deletedFor: 'user', errors };
}

export default {
    // Agents
    saveAgent, getAgent, listAgentsByUser, updateAgent, deleteAgent,
    // Conversations
    saveMessage, getConversation,
    // Tool Registry
    listTools, getToolsByCategory, getToolById,
    // Special Agents
    listSpecialAgents, getSpecialAgent,
    // UserMap
    getUserMap, updateUserMap,
    // Model Registry
    listModels, getModelById,
    // Documents
    saveDocument, getDocument, listDocumentsByOwner, deleteDocument,
    // GDPR
    deleteAllUserData,
    // Constants
    TABLES
};
