/**
 * RamN AI — Prism Chat Lambda
 * 
 * The Prism runtime of RamN AI.
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
import { checkAndRecordUsage } from '../../shared/rate-limit.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import { toCanonicalToolId } from '../../shared/tool-ids.js';
import {
    PUBLIC_TOOL_IDS,
    SUPPORTED_VERTEX_MODELS
} from '../../shared/runtime-policy.js';
import { getRelevantDocumentContext } from '../../shared/document-context.js';

// ─── CORS Headers ────────────────────────────────────────────────

function respond(statusCode, body, requestHeaders) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(requestHeaders, 'OPTIONS,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

function respondSSE(body, requestHeaders) {
    const payload = [
        `data: ${JSON.stringify({ type: 'status', phase: 'accepted' })}`,
        `data: ${JSON.stringify({ type: 'final', payload: body })}`,
        `data: ${JSON.stringify({ type: 'done' })}`
    ].join('\n\n') + '\n\n';

    return {
        statusCode: 200,
        headers: {
            ...buildCorsHeaders(requestHeaders, 'OPTIONS,POST'),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        },
        body: payload
    };
}

function isVertexModelId(modelId) {
    return SUPPORTED_VERTEX_MODELS.has(String(modelId || ''));
}

function filterVertexModels(models) {
    return (models || []).filter((model) => isVertexModelId(model?.modelId));
}

function filterCreateTools(tools) {
    const mapped = (tools || []).map((tool) => ({
        ...tool,
        toolId: toCanonicalToolId(tool?.toolId)
    }));
    return mapped.filter((tool) => PUBLIC_TOOL_IDS.has(tool.toolId));
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

async function handleAsk({ userId, message, conversationId, requestHeaders }) {
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

    let systemPrompt = `You are Prism, the intelligent assistant of RamN AI. Answer the user question clearly and helpfully. If the user has asked more than 2 questions on the same topic, suggest they try Create mode to build a specialized chatbot or Route mode to find the best AI model.`;

    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            query: message,
            maxFiles: 2,
            maxChars: 1100
        });
        if (documentContext.text) {
            systemPrompt = `${systemPrompt}\n\n# RETRIEVED USER DOCUMENT CONTEXT\nThese snippets were retrieved from documents already attached to the user's account. Use them as high-priority context without claiming anything not present in the snippets.\n${documentContext.text}`;
        }
    } catch (docErr) {
        console.warn('PRISM: ask document retrieval failed (non-fatal):', docErr.message);
    }

    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        history,
        modelName: 'gemini-2.5-flash',
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
    }, requestHeaders);
}

// ═══════════════════════════════════════════════════════════════════
//  MODE: ROUTE — Model Recommendation
// ═══════════════════════════════════════════════════════════════════

async function handleRoute({ userId, message, conversationId, requestHeaders }) {
    console.log(`PRISM: mode=route, userId=${userId}`);

    const convId = conversationId || crypto.randomUUID();

    // 1. Load available models from DB
    const models = filterVertexModels(await listModels());
    if (models.length === 0) {
        return respond(503, {
            error: 'No Vertex models available in ModelRegistry'
        }, requestHeaders);
    }
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
        modelName: 'gemini-2.5-flash',
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
    }, requestHeaders);
}

// ═══════════════════════════════════════════════════════════════════
//  MODE: CREATE — ChatBot Factory (Blueprint Designer)
// ═══════════════════════════════════════════════════════════════════

async function handleCreate({ userId, message, conversationId, specialAgentContext, requestHeaders }) {
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

    let documentContextBlock = '';
    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            query: message,
            maxFiles: 2,
            maxChars: 1100
        });
        if (documentContext.text) {
            documentContextBlock = `\nUSER DOCUMENT CONTEXT (retrieved from uploaded files):\n${documentContext.text}\n`;
        }
    } catch (docErr) {
        console.warn('PRISM: create document retrieval failed (non-fatal):', docErr.message);
    }

    // 3. Load available tools
    const tools = filterCreateTools(await listTools());
    if (tools.length === 0) {
        return respond(503, {
            error: 'No allowed tools available in ToolRegistry for Create mode'
        }, requestHeaders);
    }
    const toolsJSON = JSON.stringify(tools.map(t => ({
        toolId: t.toolId,
        name: t.name,
        type: t.type,
        category: t.category,
        description: t.description,
        capabilities: t.capabilities
    })), null, 2);

    // 4. Load available models
    const models = filterVertexModels(await listModels());
    if (models.length === 0) {
        return respond(503, {
            error: 'No Vertex models available in ModelRegistry'
        }, requestHeaders);
    }
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
Suggested Model: ${specialAgentContext.suggestedModel || 'gemini-2.5-flash'}

IMPORTANT: This is a pre-built Special ChatBot template. The user clicked "Add via Prism" to personalize it. You MUST:
1. Set blueprintReady: true immediately — do NOT ask clarifying questions.
2. Set blueprintType: "agent" (do NOT return team blueprints for this flow).
3. Use the predefined prompt as the BASE, but ENRICH the BACKSTORY section with the USER CONTEXT below.
4. Keep the same tools and model from the template unless there is a strong reason to change.
5. Keep explanation to 2-3 SHORT sentences.
` : '';

    const systemPrompt = `You are Prism, the Meta Architect of RamN AI platform.
You are an expert AI architect, prompt engineer, and tool strategist.

Your job: Understand the user objective and design either an AI ChatBot Blueprint or a Team Blueprint.

AVAILABLE TOOLS (select ONLY from these):
${toolsJSON}

AVAILABLE MODELS (select ONLY from these):
${modelsJSON}

USER CONTEXT (from their history):
${userContext}
${documentContextBlock}

${conversationContext ? `CONVERSATION SO FAR:\n${conversationContext}` : ''}
${specialAgentBlock}

YOUR PROCESS:
A. If the objective is vague, ask 1-3 clarifying questions. Do NOT generate a blueprint yet.
   Set blueprintReady: false in your response.

B. If you have enough info, generate a blueprint.
   Set blueprintReady: true

When generating a SINGLE CHATBOT blueprint, respond with this JSON shape:
{
  "blueprintReady": true,
  "blueprintType": "agent",
  "agentName": "short descriptive name",
  "agentDescription": "what this chatbot does",
  "role": "the chatbot role",
  "systemPrompt": "<STRUCTURED SYSTEM PROMPT — SEE FORMAT BELOW>",
  "tools": ["toolId1", "toolId2"],
  "model": {
    "modelId": "selected model",
    "temperature": number
  },
  "explanation": "2-3 SHORT sentences: what this agent does and why it fits the user. Be concise."
}

When generating a TEAM blueprint, respond with this JSON shape:
{
  "blueprintReady": true,
  "blueprintType": "team",
  "teamName": "short descriptive team name",
  "objective": "what this team must achieve",
  "specialists": [
    {
      "name": "short chatbot name",
      "role": "specialist role",
      "description": "what this specialist owns",
      "jobDescription": "<STRUCTURED SYSTEM PROMPT — SEE FORMAT BELOW>",
      "icon": "single emoji",
      "capabilities": ["toolId1", "toolId2"],
      "modelId": "selected model id",
      "suggestedModel": "human-readable model name"
    }
  ],
  "explanation": "2-3 SHORT sentences: why this team architecture fits."
}

MANDATORY SYSTEM PROMPT FORMAT (systemPrompt MUST include these sections):
"""
# ROLE
You are [ChatBot Name], a [specific role]. You specialize in [domain].

# GOAL
Your primary objective is to [clear, measurable goal]. You exist to help the user [desired outcome].

# BACKSTORY
[2-3 sentences of rich context. IMPORTANT: Use the provided USER CONTEXT (UserMap) and USER DOCUMENT CONTEXT to personalize this backstory so the chatbot knows who it is working for, their history, and their preferences.]

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
- If the task exceeds your capabilities, recommend the user create a more specialized chatbot.
"""

When asking questions, respond with this JSON shape:
{
  "blueprintReady": false,
  "message": "your clarifying questions",
  "questionsAsked": ["q1", "q2"]
}

RULES FOR DESIGNING CHATBOTS:
- Select MINIMAL tools (only what is needed)
- The systemPrompt MUST follow the structured format above — no exceptions
- Choose the cheapest model that can handle the task
- Always include all sections: ROLE, GOAL, BACKSTORY, TOOLS, RULES, OUTPUT FORMAT, SAFETY
- Keep explanations SHORT (2-3 sentences max) — be concise, not verbose
- If the user explicitly asks for a team/group/squad, return blueprintType: "team"
- If the user asks for one specialist, return blueprintType: "agent"
- Return ONLY a raw JSON object. Do NOT use markdown, code fences, or surrounding commentary.`;

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

    // Never return raw JSON payloads to end users in chat.
    let conversationalText = 'I need a bit more detail before I can build this blueprint.';
    if (parsed) {
        if (parsed.blueprintReady === false && parsed.message) {
            conversationalText = parsed.message;
        } else if (parsed.blueprintReady === true) {
            conversationalText = parsed.explanation
                || `Blueprint ready: ${parsed.agentName || parsed.teamName || 'New chatbot'} is ready to deploy.`;
        }
    }

    const isTeamBlueprint = !!(
        parsed?.blueprintReady &&
        (parsed?.blueprintType === 'team' || Array.isArray(parsed?.specialists) || Array.isArray(parsed?.agents))
    );

    let derivedToolCall = null;
    if (parsed?.blueprintReady) {
        if (isTeamBlueprint) {
            const sourceSpecialists = Array.isArray(parsed.specialists)
                ? parsed.specialists
                : (Array.isArray(parsed.agents) ? parsed.agents : []);

            const fallbackIcons = ['🧠', '📊', '✍️', '⚙️', '🔍', '🚀'];
            const specialists = sourceSpecialists
                .filter(spec => spec && (spec.name || spec.role))
                .map((spec, index) => ({
                    name: spec.name || `Specialist ${index + 1}`,
                    role: spec.role || 'Specialist',
                            description: spec.description || spec.agentDescription || `Handles ${spec.role || 'specialized'} tasks.`,
                            jobDescription: spec.jobDescription || spec.systemPrompt || '',
                            icon: spec.icon || fallbackIcons[index % fallbackIcons.length],
                            capabilities: Array.from(new Set(
                                (Array.isArray(spec.capabilities) ? spec.capabilities : (Array.isArray(spec.tools) ? spec.tools : []))
                                    .map((toolId) => toCanonicalToolId(toolId))
                                    .filter((toolId) => PUBLIC_TOOL_IDS.has(toolId))
                            )),
                            modelId: spec.modelId || spec.model?.modelId || 'gemini-2.5-flash',
                            suggestedModel: spec.suggestedModel || spec.model?.name || spec.modelId || 'gemini-2.5-flash'
                }));

            if (specialists.length > 0) {
                derivedToolCall = {
                    name: 'fabricateTeam',
                    args: {
                        teamName: parsed.teamName || parsed.name || 'Task Force',
                        objective: parsed.objective || parsed.teamObjective || parsed.agentDescription || message,
                        specialists
                    }
                };
            }
        } else {
            const normalizedAgentToolIds = Array.from(new Set(
                (Array.isArray(parsed?.toolIds) ? parsed.toolIds : (Array.isArray(parsed?.tools) ? parsed.tools : []))
                    .map((toolId) => toCanonicalToolId(toolId))
                    .filter((toolId) => PUBLIC_TOOL_IDS.has(toolId))
            ));
            if (parsed.agentName && parsed.role && normalizedAgentToolIds.length > 0) {
                derivedToolCall = {
                    name: 'fabricateAgent',
                    args: {
                        ...parsed,
                        toolIds: normalizedAgentToolIds,
                        tools: normalizedAgentToolIds
                    }
                };
            }
        }
    }

    if (parsed?.blueprintReady && !derivedToolCall) {
        conversationalText = 'I designed a blueprint, but it is missing required deployment fields. Please confirm tools and model, then I will regenerate it.';
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
        toolCall: derivedToolCall || aiResult.toolCalls?.[0] || null,
        conversationId: convId,
        mode: 'create'
    }, requestHeaders);
}

// ═══════════════════════════════════════════════════════════════════
//  Lambda Handler
// ═══════════════════════════════════════════════════════════════════

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(200, {}, event.headers);
    }

    try {
        const requestPath = event.requestContext?.resourcePath || event.path || '';
        const isStreamEndpoint = requestPath.endsWith('/stream');

        // 1. Auth check
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        // 2. Parse body
        const body = JSON.parse(event.body || '{}');
        const { message, mode, conversationId, specialAgentContext } = body;

        // Validate required fields
        if (!message) return respond(400, { error: 'Missing message' }, event.headers);
        if (!mode) return respond(400, { error: 'Missing mode. Must be: ask, route, or create' }, event.headers);

        const usage = await checkAndRecordUsage(userId, 'prism');
        if (!usage.allowed) {
            return respond(429, {
                error: 'Rate limit exceeded',
                message: `Hourly limit reached (${usage.limit}/hour).`,
                usage
            }, event.headers);
        }

        console.log(`PRISM: ═══ Incoming request ═══ mode=${mode}, userId=${userId}, conversationId=${conversationId || 'new'}, specialAgent=${specialAgentContext?.name || 'none'}`);

        const runMode = async () => {
            switch (mode) {
                case 'ask':
                    return await handleAsk({ userId, message, conversationId, requestHeaders: event.headers });
                case 'route':
                    return await handleRoute({ userId, message, conversationId, requestHeaders: event.headers });
                case 'create':
                    return await handleCreate({ userId, message, conversationId, specialAgentContext, requestHeaders: event.headers });
                default:
                    return respond(400, { error: `Invalid mode: "${mode}". Must be: ask, route, or create` }, event.headers);
            }
        };

        const modeResponse = await runMode();
        if (!isStreamEndpoint) {
            return modeResponse;
        }
        if (modeResponse.statusCode !== 200) {
            return modeResponse;
        }

        const parsed = JSON.parse(modeResponse.body || '{}');
        return respondSSE(parsed, event.headers);

    } catch (error) {
        console.error('PRISM: ❌ Fatal error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message }, event.headers);
        }

        return respond(500, {
            error: 'Internal server error',
            message: error.message || 'Unknown error'
        }, event.headers);
    }
};
