/**
 * RamN AI — Prism Chat Lambda
 * 
 * The Meta Agent Brain of RamN AI.
 * Handles three modes: ask, route, create
 * 
 * POST /api/prism/chat
 * Body: { userId, message, mode, conversationId }
 * 
 * ALL data from DynamoDB. ALL AI from Vertex AI. ZERO simulation.
 */

import { callAI } from '../../shared/vertex-ai.js';
import {
    saveMessage,
    getConversation,
    listTools,
    listModels,
    getUserMap
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

// ─── JSON Extraction Helper ──────────────────────────────────────

function extractJSON(text) {
    // Try 1: Extract from ```json code block
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        try { return JSON.parse(codeBlockMatch[1].trim()); } catch { }
    }

    // Try 2: Extract from generic ``` code block
    const genericBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (genericBlockMatch) {
        try { return JSON.parse(genericBlockMatch[1].trim()); } catch { }
    }

    // Try 3: Find raw JSON object in text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch { }
    }

    return null;
}

// ═══════════════════════════════════════════════════════════════════
//  MODE: ASK — Conversational Q&A with Prism
// ═══════════════════════════════════════════════════════════════════

async function handleAsk({ userId, message, conversationId }) {
    console.log(`PRISM: mode=ask, userId=${userId}, conversationId=${conversationId}`);

    // Generate or reuse conversation ID
    const convId = conversationId || crypto.randomUUID();

    // 1. Load conversation history
    let history = [];
    if (conversationId) {
        const messages = await getConversation(conversationId);
        history = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            content: m.content
        }));
    }

    // 2. Call Vertex AI
    const systemPrompt = `You are Prism, the intelligent assistant of RamN AI. Answer the user question clearly and helpfully. If the user has asked more than 2 questions on the same topic, suggest they try Create mode to build a specialized agent or Route mode to find the best AI model.`;

    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        history,
        modelName: 'gemini-2.0-flash',
        temperature: 0.3
    });

    // 3. Save messages to conversation
    await saveMessage({ conversationId: convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({ conversationId: convId, role: 'assistant', content: aiResult.text, agentId: null, userId });

    // 4. Count messages to determine suggestion flag
    const allMessages = await getConversation(convId);
    const userMessageCount = allMessages.filter(m => m.role === 'user').length;
    const suggestMode = userMessageCount > 2;

    console.log(`PRISM: ask response — ${aiResult.text.length} chars, ${userMessageCount} user messages, suggestMode=${suggestMode}`);

    // 5. Return
    return respond(200, {
        text: aiResult.text,
        toolCall: aiResult.toolCall,
        conversationId: convId,
        suggestMode,
        mode: 'ask'
    });
}

// ═══════════════════════════════════════════════════════════════════
//  MODE: ROUTE — Model Recommendation
// ═══════════════════════════════════════════════════════════════════

async function handleRoute({ userId, message, conversationId }) {
    console.log(`PRISM: mode=route, userId=${userId}`);

    const convId = conversationId || crypto.randomUUID();

    // 1. Load available models from DB
    const models = await listModels();
    const modelsJSON = JSON.stringify(models.map(m => ({
        modelId: m.modelId,
        name: m.name,
        provider: m.provider,
        strengths: m.strengths,
        contextWindow: m.contextWindow,
        costTier: m.costTier,
        bestFor: m.bestFor,
        temperature_default: m.temperature_default
    })), null, 2);

    // 2. Call Vertex AI
    const systemPrompt = `You are Prism in Route mode. Analyze the user objective and recommend the best AI model from the available models. Consider: task complexity, context needs, speed requirements, cost.

Available models:
${modelsJSON}

Respond with a JSON object:
{
  "recommendedModelId": "...",
  "recommendedModelName": "...",
  "reasoning": "why this model is best",
  "alternativeModelId": "..." 
}

Also provide a natural language explanation BEFORE the JSON block explaining your recommendation in a friendly conversational way.

Wrap JSON in \`\`\`json code block.`;

    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        modelName: 'gemini-2.0-flash',
        temperature: 0.3
    });

    // 3. Parse JSON from response
    const recommendation = extractJSON(aiResult.text);

    // 4. Save messages
    await saveMessage({ conversationId: convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({ conversationId: convId, role: 'assistant', content: aiResult.text, agentId: null, userId });

    console.log(`PRISM: route response — recommended: ${recommendation?.recommendedModelId || 'parse-failed'}`);

    // 5. Return
    return respond(200, {
        text: aiResult.text,
        toolCall: aiResult.toolCalls?.[0] || null,
        recommendation: recommendation || { error: 'Could not parse model recommendation' },
        conversationId: convId,
        mode: 'route'
    });
}

// ═══════════════════════════════════════════════════════════════════
//  MODE: CREATE — Agent Factory (Blueprint Designer)
// ═══════════════════════════════════════════════════════════════════

async function handleCreate({ userId, message, conversationId, specialAgentContext }) {
    console.log(`PRISM: mode=create, userId=${userId}, conversationId=${conversationId}`);

    const convId = conversationId || crypto.randomUUID();

    // 1. Load conversation history (if continuing)
    let history = [];
    let conversationContext = '';
    if (conversationId) {
        const messages = await getConversation(conversationId);
        history = messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            content: m.content
        }));
        conversationContext = messages
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n');
    }

    // 2. Load user context
    const userMap = await getUserMap(userId);
    const userContext = JSON.stringify({
        preferences: userMap.preferences || {},
        agentHistory: userMap.agentHistory || [],
        orgContext: userMap.orgContext || {}
    }, null, 2);

    // 3. Load available tools
    const tools = await listTools();
    const toolsJSON = JSON.stringify(tools.map(t => ({
        toolId: t.toolId,
        name: t.name,
        type: t.type,
        category: t.category,
        description: t.description,
        capabilities: t.capabilities
    })), null, 2);

    // 4. Load available models
    const models = await listModels();
    const modelsJSON = JSON.stringify(models.map(m => ({
        modelId: m.modelId,
        name: m.name,
        strengths: m.strengths,
        costTier: m.costTier,
        bestFor: m.bestFor,
        temperature_default: m.temperature_default
    })), null, 2);

    // 5. Build system prompt (Tier 1: Structured Persona — CrewAI/Agno pattern)
    // If specialAgentContext is present, inject it so Prism skips questions
    const specialAgentBlock = specialAgentContext ? `
SPECIAL AGENT TEMPLATE (PRE-BUILT BY RAMNAI):
Name: ${specialAgentContext.name}
Role: ${specialAgentContext.role}
Predefined System Prompt:
${specialAgentContext.predefinedPrompt}
Default Tools: ${(specialAgentContext.defaultTools || []).join(', ')}
Suggested Model: ${specialAgentContext.suggestedModel || 'gemini-2.0-flash'}

IMPORTANT: This is a pre-built Special Agent template. The user clicked "Add via Prism" to personalize it. You MUST:
1. Set blueprintReady: true immediately — do NOT ask clarifying questions.
2. Use the predefined prompt as the BASE, but ENRICH the BACKSTORY section with the USER CONTEXT below.
3. Keep the same tools and model from the template unless there is a strong reason to change.
4. Keep explanation to 2-3 SHORT sentences.
` : '';

    const systemPrompt = `You are Prism, the Meta Agent of RamN AI platform.
You are an expert AI architect, prompt engineer, and tool strategist.

Your job: Understand the user objective and design an AI Agent Blueprint.

AVAILABLE TOOLS (select ONLY from these):
${toolsJSON}

AVAILABLE MODELS (select ONLY from these):
${modelsJSON}

USER CONTEXT (from their history):
${userContext}

${conversationContext ? `CONVERSATION SO FAR:\n${conversationContext}` : ''}
${specialAgentBlock}

YOUR PROCESS:
A. If the objective is vague, ask 1-3 clarifying questions. Do NOT generate a blueprint yet.
   Set blueprintReady: false in your response.

B. If you have enough info, generate a blueprint.
   Set blueprintReady: true

When generating a blueprint, respond with JSON:
{
  "blueprintReady": true,
  "agentName": "short descriptive name",
  "agentDescription": "what this agent does",
  "role": "the agent role",
  "systemPrompt": "<STRUCTURED SYSTEM PROMPT — SEE FORMAT BELOW>",
  "tools": ["toolId1", "toolId2"],
  "model": {
    "modelId": "selected model",
    "temperature": number
  },
  "explanation": "2-3 SHORT sentences: what this agent does and why it fits the user. Be concise."
}

MANDATORY SYSTEM PROMPT FORMAT (the systemPrompt field MUST use this exact structure):
"""
# ROLE
You are [Agent Name], a [specific role]. You specialize in [domain].

# GOAL
Your primary objective is to [clear, measurable goal]. You exist to help the user [desired outcome].

# BACKSTORY
[2-3 sentences of rich context. IMPORTANT: Use the provided USER CONTEXT (UserMap) to personalize this backstory so the agent knows who it is working for, their history, and their preferences.]

# TOOLS
You have access to these tools and MUST use them when relevant instead of guessing:
- [tool1]: [what it does]
- [tool2]: [what it does]

# RULES OF ENGAGEMENT
MUST DO:
1. Always think step-by-step before responding.
2. Use your tools before guessing — if a tool can answer the question, call it.
3. Cite sources and data when available.
4. Stay strictly within your ROLE and GOAL boundaries.
5. [Task-specific rules]

MUST NOT:
1. Never answer questions outside your expertise — say "This is outside my scope."
2. Never fabricate data, statistics, or sources.
3. Never make assumptions when you can use a tool to verify.
4. [Task-specific restrictions]

# OUTPUT FORMAT
[Specify the default output format: markdown, JSON, bullet points, etc.]

# SAFETY & ESCALATION
- If the request involves harmful, illegal, or unethical content, refuse politely.
- If you are uncertain, ask for clarification instead of guessing.
- If the task exceeds your capabilities, recommend the user create a more specialized agent.
"""

When asking questions, respond with JSON:
{
  "blueprintReady": false,
  "message": "your clarifying questions",
  "questionsAsked": ["q1", "q2"]
}

RULES FOR DESIGNING AGENTS:
- Select MINIMAL tools (only what is needed)
- The systemPrompt MUST follow the structured format above — no exceptions
- Choose the cheapest model that can handle the task
- Always include all sections: ROLE, GOAL, BACKSTORY, TOOLS, RULES, OUTPUT FORMAT, SAFETY
- Keep explanations SHORT (2-3 sentences max) — be concise, not verbose

Wrap your entire response in \`\`\`json code block.`;

    // 6. Call Vertex AI
    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        history,
        modelName: 'gemini-2.5-pro',
        temperature: 0.3
    });

    // 7. Parse AI response JSON
    const parsed = extractJSON(aiResult.text);

    // Extract nicely formatted text to show to the user (fallback to raw if error)
    let conversationalText = aiResult.text;
    if (parsed) {
        if (parsed.blueprintReady === false && parsed.message) {
            conversationalText = parsed.message;
        } else if (parsed.blueprintReady === true && parsed.explanation) {
            conversationalText = parsed.explanation;
        }
    }

    // 8. Save messages using the extracted conversational text
    await saveMessage({ conversationId: convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({
        conversationId: convId,
        role: 'assistant',
        content: conversationalText,
        agentId: null,
        userId
    });

    console.log(`PRISM: create response — blueprintReady: ${parsed?.blueprintReady ?? 'parse-failed'}`);

    // 9. Return
    return respond(200, {
        text: conversationalText,
        toolCall: aiResult.toolCalls?.[0] || (parsed?.blueprintReady ? { name: 'fabricateAgent', args: parsed } : null),
        conversationId: convId,
        mode: 'create'
    });
}

// ═══════════════════════════════════════════════════════════════════
//  Lambda Handler
// ═══════════════════════════════════════════════════════════════════

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(200, {});
    }

    try {
        // 1. Auth check
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        // 2. Parse body
        const body = JSON.parse(event.body || '{}');
        const { message, mode, conversationId, specialAgentContext } = body;

        // Validate required fields
        if (!message) return respond(400, { error: 'Missing message' });
        if (!mode) return respond(400, { error: 'Missing mode. Must be: ask, route, or create' });

        console.log(`PRISM: ═══ Incoming request ═══ mode=${mode}, userId=${userId}, conversationId=${conversationId || 'new'}, specialAgent=${specialAgentContext?.name || 'none'}`);

        // Route to mode handler
        switch (mode) {
            case 'ask':
                return await handleAsk({ userId, message, conversationId });
            case 'route':
                return await handleRoute({ userId, message, conversationId });
            case 'create':
                return await handleCreate({ userId, message, conversationId, specialAgentContext });
            default:
                return respond(400, { error: `Invalid mode: "${mode}". Must be: ask, route, or create` });
        }

    } catch (error) {
        console.error('PRISM: ❌ Fatal error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message });
        }

        return respond(500, {
            error: 'Internal server error',
            message: error.message || 'Unknown error'
        });
    }
};
