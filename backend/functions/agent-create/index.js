/**
 * RamN AI — Agent Create Lambda
 * 
 * Called when a user APPROVES a blueprint designed by Prism.
 * Validates, resolves tools/model from DB, saves to RamN_Agents,
 * and updates user's agent history.
 * 
 * POST /api/agents/create
 * Body: { userId, blueprint }
 */

import {
    saveAgent,
    getUserMap,
    updateUserMap,
    getToolById,
    getModelById
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { normalizeToolIds } from '../../shared/tool-ids.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import {
    SUPPORTED_TOOL_IDS,
    SUPPORTED_VERTEX_MODELS
} from '../../shared/runtime-policy.js';

// ─── CORS Headers ────────────────────────────────────────────────

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

// ─── Validation ──────────────────────────────────────────────────

function validateBlueprint(blueprint) {
    const required = ['agentName', 'agentDescription', 'role', 'systemPrompt', 'model'];
    const missing = required.filter(field => !blueprint[field]);

    if (missing.length > 0) {
        return `Missing blueprint fields: ${missing.join(', ')}`;
    }

    const toolIds = normalizeToolIds(blueprint.toolIds || blueprint.tools || []);
    if (!Array.isArray(toolIds) || toolIds.length === 0) {
        return 'blueprint.toolIds (or tools) must contain at least one tool ID';
    }

    if (!blueprint.model.modelId) {
        return 'blueprint.model.modelId is required';
    }

    if (blueprint.model.temperature === undefined || blueprint.model.temperature === null) {
        return 'blueprint.model.temperature is required';
    }

    return null; // valid
}

const LEGACY_TOOL_CANDIDATES = {
    'web-search': ['webSearch', 'googleSearch', 'web_search'],
    'image-generation': ['imageGeneration', 'imageEditing'],
    'doc-reader': ['docReader', 'doc_reader', 'fileManipulation'],
    thinking: ['thinking']
};

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(event, 200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { blueprint } = body;

        // Validate input
        if (!blueprint) return respond(event, 400, { error: 'Missing blueprint' });

        const validationError = validateBlueprint(blueprint);
        if (validationError) return respond(event, 400, { error: validationError });

        const requestedToolIds = normalizeToolIds(blueprint.toolIds || blueprint.tools || [])
            .filter((toolId) => SUPPORTED_TOOL_IDS.has(toolId));
        const requestedDocumentIds = Array.isArray(blueprint.documentIds)
            ? blueprint.documentIds.filter(Boolean)
            : [];

        console.log(`AGENT-CREATE: userId=${userId}, agentName="${blueprint.agentName}", toolIds=[${requestedToolIds.join(', ')}]`);

        // 1. Generate agent ID
        const agentId = crypto.randomUUID();

        // 2. Resolve tools from RamN_ToolRegistry
        console.log(`AGENT-CREATE: Resolving ${requestedToolIds.length} tools...`);
        const resolvedTools = [];
        for (const toolId of requestedToolIds) {
            let tool = await getToolById(toolId);
            if (!tool) {
                const legacyCandidates = LEGACY_TOOL_CANDIDATES[toolId] || [];
                for (const legacyId of legacyCandidates) {
                    tool = await getToolById(legacyId);
                    if (tool) break;
                }
            }
            if (tool) {
                resolvedTools.push(tool);
                console.log(`  ✅ Tool resolved: ${toolId} → ${tool.name}`);
            } else {
                console.warn(`  ⚠️ Tool not found: ${toolId} — skipping`);
            }
        }
        if (resolvedTools.length === 0) {
            return respond(event, 400, {
                error: `No allowed tools were resolved from toolIds. Allowed: ${Array.from(SUPPORTED_TOOL_IDS).join(', ')}`
            });
        }

        // 3. Resolve model from RamN_ModelRegistry
        console.log(`AGENT-CREATE: Resolving model: ${blueprint.model.modelId}`);
        const resolvedModel = await getModelById(blueprint.model.modelId);
        if (!resolvedModel) {
            return respond(event, 400, { error: `Model not found: ${blueprint.model.modelId}` });
        }
        if (!String(resolvedModel.modelId || blueprint.model.modelId).startsWith('gemini-')) {
            return respond(event, 400, {
                error: `Model "${blueprint.model.modelId}" is not supported in this deployment. Only Vertex Gemini models are allowed.`
            });
        }
        if (!SUPPORTED_VERTEX_MODELS.has(String(resolvedModel.modelId || blueprint.model.modelId))) {
            return respond(event, 400, {
                error: `Model "${blueprint.model.modelId}" is not enabled in this deployment. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`
            });
        }
        console.log(`  ✅ Model resolved: ${resolvedModel.name}`);

        // 4. Build full blueprint with resolved data
        const fullBlueprint = {
            agentName: blueprint.agentName,
            agentDescription: blueprint.agentDescription,
            role: blueprint.role,
            systemPrompt: blueprint.systemPrompt,
            icon: blueprint.icon || '🤖',
            tools: resolvedTools,
            toolIds: requestedToolIds,
            documentIds: requestedDocumentIds,
            model: {
                ...resolvedModel,
                temperature: blueprint.model.temperature
            }
        };

        // 5. Save to RamN_Agents
        await saveAgent({
            agentId,
            userId,
            name: blueprint.agentName,
            description: blueprint.agentDescription,
            blueprint: fullBlueprint,
            status: 'active'
        });

        // 6. Update UserMap — add agent to history
        console.log('AGENT-CREATE: Updating user agent history...');
        const userMap = await getUserMap(userId);
        const agentHistory = userMap.agentHistory || [];
        agentHistory.push({
            agentId,
            name: blueprint.agentName,
            createdAt: new Date().toISOString()
        });
        await updateUserMap(userId, { agentHistory });

        console.log(`AGENT-CREATE: ✅ Agent created: ${blueprint.agentName} (${agentId})`);

        // 7. Return success
        return respond(event, 200, {
            agentId,
            name: blueprint.agentName,
            status: 'created',
            message: 'ChatBot created successfully'
        });

    } catch (error) {
        console.error('AGENT-CREATE: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, {
            error: 'Failed to create chatbot',
            message: error.message || 'Unknown error'
        });
    }
};
