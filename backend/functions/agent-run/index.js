/**
 * RamN AI — Agent Run Lambda (Agent Runtime)
 * 
 * Executes a created agent by loading its blueprint from DynamoDB
 * and calling Vertex AI with the saved system prompt and model config.
 * 
 * The system prompt comes from the SAVED BLUEPRINT — not from frontend,
 * not hardcoded. This is what makes it a REAL agent.
 * 
 * POST /api/agents/{agentId}/chat
 * Body: { agentId, userId, message, conversationId }
 */

import { callAI } from '../../shared/vertex-ai.js';
import {
    getAgent,
    saveMessage,
    getConversation
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
        const { agentId, message, conversationId } = body;

        // Validate input
        if (!agentId) return respond(400, { error: 'Missing agentId' });
        if (!message) return respond(400, { error: 'Missing message' });

        console.log(`AGENT-RUN: agentId=${agentId}, userId=${userId}, conversationId=${conversationId || 'new'}`);

        // 1. Load agent from DynamoDB
        const agent = await getAgent(agentId, userId);

        // 2. Agent not found
        if (!agent) {
            console.warn(`AGENT-RUN: Agent not found: ${agentId}`);
            return respond(404, { error: 'Agent not found' });
        }

        // 3. Ownership check
        if (agent.userId !== userId) {
            console.warn(`AGENT-RUN: Forbidden — agent belongs to ${agent.userId}, not ${userId}`);
            return respond(403, { error: 'You do not have access to this agent' });
        }

        console.log(`AGENT-RUN: Loaded agent "${agent.name}" (status: ${agent.status})`);

        // Check if agent is active
        if (agent.status !== 'active') {
            return respond(400, { error: `Agent is ${agent.status}. Only active agents can be run.` });
        }

        // 4. Load conversation history
        const convId = conversationId || crypto.randomUUID();
        let history = [];
        if (conversationId) {
            const messages = await getConversation(conversationId);
            history = messages.map(m => ({
                role: m.role === 'assistant' ? 'model' : m.role,
                content: m.content
            }));
            console.log(`AGENT-RUN: Loaded ${history.length} history messages`);
        }

        // 5. Extract blueprint config
        const blueprint = agent.blueprint;
        const systemPrompt = blueprint.systemPrompt;
        const modelId = blueprint.model?.modelId || 'gemini-2.0-flash';
        const temperature = blueprint.model?.temperature ?? 0.3;

        console.log(`AGENT-RUN: Using model=${modelId}, temperature=${temperature}`);
        console.log(`AGENT-RUN: System prompt length: ${systemPrompt.length} chars`);

        // 6. Call Vertex AI with blueprint configuration
        const aiResult = await callAI({
            systemPrompt,
            userMessage: message,
            history,
            modelName: modelId,
            temperature
        });

        console.log(`AGENT-RUN: AI response — ${aiResult.text.length} chars`);

        // 7-9. Save messages to conversation
        await saveMessage({
            conversationId: convId,
            role: 'user',
            content: message,
            agentId,
            userId
        });

        await saveMessage({
            conversationId: convId,
            role: 'assistant',
            content: aiResult.text,
            agentId,
            userId
        });

        console.log(`AGENT-RUN: ✅ Response saved to conversation ${convId}`);

        // 10. Return
        return respond(200, {
            response: aiResult.text,
            conversationId: convId,
            agentId,
            agentName: agent.name
        });

    } catch (error) {
        console.error('AGENT-RUN: ❌ Error:', error);
        return respond(500, {
            error: 'Failed to run agent',
            message: error.message || 'Unknown error'
        });
    }
};
