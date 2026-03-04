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

// ─── CORS Headers ────────────────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Content-Type': 'application/json'
};

function respond(statusCode, body) {
    return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// ─── Validation ──────────────────────────────────────────────────

function validateBlueprint(blueprint) {
    const required = ['agentName', 'agentDescription', 'role', 'systemPrompt', 'tools', 'model'];
    const missing = required.filter(field => !blueprint[field]);

    if (missing.length > 0) {
        return `Missing blueprint fields: ${missing.join(', ')}`;
    }

    if (!Array.isArray(blueprint.tools)) {
        return 'blueprint.tools must be an array of toolIds';
    }

    if (!blueprint.model.modelId) {
        return 'blueprint.model.modelId is required';
    }

    if (blueprint.model.temperature === undefined || blueprint.model.temperature === null) {
        return 'blueprint.model.temperature is required';
    }

    return null; // valid
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { blueprint } = body;

        // Validate input
        if (!blueprint) return respond(400, { error: 'Missing blueprint' });

        const validationError = validateBlueprint(blueprint);
        if (validationError) return respond(400, { error: validationError });

        console.log(`AGENT-CREATE: userId=${userId}, agentName="${blueprint.agentName}"`);

        // 1. Generate agent ID
        const agentId = crypto.randomUUID();

        // 2. Resolve tools from RamN_ToolRegistry
        console.log(`AGENT-CREATE: Resolving ${blueprint.tools.length} tools...`);
        const resolvedTools = [];
        for (const toolId of blueprint.tools) {
            const tool = await getToolById(toolId);
            if (tool) {
                resolvedTools.push(tool);
                console.log(`  ✅ Tool resolved: ${toolId} → ${tool.name}`);
            } else {
                console.warn(`  ⚠️ Tool not found: ${toolId} — skipping`);
            }
        }

        // 3. Resolve model from RamN_ModelRegistry
        console.log(`AGENT-CREATE: Resolving model: ${blueprint.model.modelId}`);
        const resolvedModel = await getModelById(blueprint.model.modelId);
        if (!resolvedModel) {
            return respond(400, { error: `Model not found: ${blueprint.model.modelId}` });
        }
        console.log(`  ✅ Model resolved: ${resolvedModel.name}`);

        // 4. Build full blueprint with resolved data
        const fullBlueprint = {
            agentName: blueprint.agentName,
            agentDescription: blueprint.agentDescription,
            role: blueprint.role,
            systemPrompt: blueprint.systemPrompt,
            tools: resolvedTools,
            toolIds: blueprint.tools,
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
        return respond(200, {
            agentId,
            name: blueprint.agentName,
            status: 'created',
            message: 'Agent created successfully'
        });

    } catch (error) {
        console.error('AGENT-CREATE: ❌ Error:', error);
        return respond(500, {
            error: 'Failed to create agent',
            message: error.message || 'Unknown error'
        });
    }
};
