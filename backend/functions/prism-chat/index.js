/**
 * RamN AI — Prism Chat Lambda
 *
 * The Prism runtime of RamN AI.
 * Handles three modes: ask, route, create.
 */

import { callAI, callAIStream } from '../../shared/vertex-ai.js';
import {
    saveMessage,
    getConversation,
    listTools,
    listModels,
    getUserMap,
    searchRelevantMemories
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { checkAndRecordUsage } from '../../shared/rate-limit.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import {
    SUPPORTED_VERTEX_MODELS
} from '../../shared/runtime-policy.js';
import { getRelevantDocumentContext } from '../../shared/document-context.js';
import { buildConversationContext } from '../../shared/conversation-context.js';
import { toVertexUserParts } from '../../shared/chat-attachments.js';
import { formatUserMapTreeContext } from '../../shared/usermap-context.js';

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

function buildStreamMetadata(requestHeaders, statusCode = 200) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    };
}

async function writeSseEvent(stream, event) {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
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

function formatMemoryContext(memories) {
    if (!Array.isArray(memories) || memories.length === 0) return '';
    return memories
        .map((memory, index) => {
            const content = String(memory.content || '').replace(/\s+/g, ' ').trim();
            const createdAt = memory.createdAt ? ` [${memory.createdAt}]` : '';
            return `${index + 1}.${createdAt} ${content}`;
        })
        .join('\n');
}

function extractJSON(text) {
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
        try { return JSON.parse(codeBlockMatch[1].trim()); } catch { }
    }

    const genericBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
    if (genericBlockMatch) {
        try { return JSON.parse(genericBlockMatch[1].trim()); } catch { }
    }

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch { }
    }

    return null;
}

function httpError(statusCode, error, message = error) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.error = error;
    return err;
}

async function buildAskContext({ userId, message, conversationId, attachments = [], focusDocumentIds = [] }) {
    const convId = conversationId || crypto.randomUUID();
    let history = [];
    let conversationSummary = '';

    if (conversationId) {
        const messages = await getConversation(conversationId);
        const conversationContext = await buildConversationContext({
            messages,
            currentUserMessage: message,
            modelName: 'gemini-2.5-flash'
        });
        history = conversationContext.history;
        conversationSummary = conversationContext.summaryText;
    }

    let systemPrompt = 'You are Prism, the intelligent assistant of RamN AI. Answer the user question clearly and helpfully. If the user has asked more than 2 questions on the same topic, suggest they try Create mode to build a specialized chatbot or Route mode to find the best AI model.';
    if (conversationSummary) {
        systemPrompt = `${systemPrompt}\n\n# PRIOR CONVERSATION SUMMARY\n${conversationSummary}`;
    }

    try {
        const memories = await searchRelevantMemories(userId, message, { limit: 5 });
        const memoryContext = formatMemoryContext(memories);
        if (memoryContext) {
            systemPrompt = `${systemPrompt}\n\n# RELEVANT CROSS-CONVERSATION MEMORY\nThese facts were extracted from prior Prism or chatbot sessions. Use them when they materially help the answer.\n${memoryContext}`;
        }
    } catch (memoryErr) {
        console.warn('PRISM: ask memory retrieval failed (non-fatal):', memoryErr.message);
    }

    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            query: message,
            focusDocumentIds,
            maxFiles: 2,
            maxChars: 1100
        });
        if (documentContext.text) {
            systemPrompt = `${systemPrompt}\n\n# RETRIEVED USER DOCUMENT CONTEXT\nThese snippets were retrieved from documents already attached to the user's account. Use them as high-priority context without claiming anything not present in the snippets.\n${documentContext.text}`;
        }
    } catch (docErr) {
        console.warn('PRISM: ask document retrieval failed (non-fatal):', docErr.message);
    }

    return {
        convId,
        history,
        systemPrompt,
        userParts: toVertexUserParts(attachments)
    };
}

async function handleAsk({ userId, message, conversationId, attachments = [], focusDocumentIds = [], stream }) {
    console.log(`PRISM: mode=ask, userId=${userId}, conversationId=${conversationId}`);
    const context = await buildAskContext({ userId, message, conversationId, attachments, focusDocumentIds });

    const aiResult = stream
        ? await callAIStream({
            systemPrompt: context.systemPrompt,
            userMessage: message,
            history: context.history,
            userParts: context.userParts,
            modelName: 'gemini-2.5-flash',
            temperature: 0.3,
            onTextDelta: async (delta) => stream({ type: 'text-delta', delta })
        })
        : await callAI({
            systemPrompt: context.systemPrompt,
            userMessage: message,
            history: context.history,
            userParts: context.userParts,
            modelName: 'gemini-2.5-flash',
            temperature: 0.3
        });

    await saveMessage({ conversationId: context.convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({ conversationId: context.convId, role: 'assistant', content: aiResult.text, agentId: null, userId });

    const allMessages = await getConversation(context.convId);
    const userMessageCount = allMessages.filter((item) => item.role === 'user').length;
    const suggestMode = userMessageCount > 2;

    return {
        text: aiResult.text,
        toolCall: aiResult.toolCalls?.[0] || null,
        conversationId: context.convId,
        suggestMode,
        mode: 'ask'
    };
}

async function handleRoute({ userId, message, conversationId, attachments = [], focusDocumentIds = [] }) {
    console.log(`PRISM: mode=route, userId=${userId}`);

    const convId = conversationId || crypto.randomUUID();
    let conversationSummary = '';
    if (conversationId) {
        const messages = await getConversation(conversationId);
        const conversationContext = await buildConversationContext({
            messages,
            currentUserMessage: message,
            modelName: 'gemini-2.5-flash'
        });
        conversationSummary = conversationContext.summaryText;
    }

    const models = filterVertexModels(await listModels());
    if (models.length === 0) {
        throw httpError(503, 'No Vertex models available in ModelRegistry');
    }

    const modelsJSON = JSON.stringify(models.map((model) => ({
        modelId: model.modelId,
        name: model.name,
        provider: model.provider,
        strengths: model.strengths,
        contextWindow: model.contextWindow,
        costTier: model.costTier,
        bestFor: model.bestFor,
        temperature_default: model.temperature_default
    })), null, 2);

    let systemPrompt = `You are Prism in Route mode. Analyze the user objective and recommend the best AI model from the available models. Consider: task complexity, context needs, speed requirements, cost.

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

    if (conversationSummary) {
        systemPrompt = `${systemPrompt}\n\n# PRIOR CONVERSATION SUMMARY\n${conversationSummary}`;
    }

    try {
        const memories = await searchRelevantMemories(userId, message, { limit: 5 });
        const memoryContext = formatMemoryContext(memories);
        if (memoryContext) {
            systemPrompt = `${systemPrompt}\n\n# RELEVANT USER MEMORY\nUse these preferences and prior facts if they influence the model recommendation.\n${memoryContext}`;
        }
    } catch (memoryErr) {
        console.warn('PRISM: route memory retrieval failed (non-fatal):', memoryErr.message);
    }

    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            query: message,
            focusDocumentIds,
            maxFiles: 2,
            maxChars: 1000
        });
        if (documentContext.text) {
            systemPrompt = `${systemPrompt}\n\n# RETRIEVED DOCUMENT CONTEXT\n${documentContext.text}`;
        }
    } catch (docErr) {
        console.warn('PRISM: route document retrieval failed (non-fatal):', docErr.message);
    }

    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        userParts: toVertexUserParts(attachments),
        modelName: 'gemini-2.5-flash',
        temperature: 0.3
    });

    const recommendation = extractJSON(aiResult.text);

    await saveMessage({ conversationId: convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({ conversationId: convId, role: 'assistant', content: aiResult.text, agentId: null, userId });

    return {
        text: aiResult.text,
        toolCall: aiResult.toolCalls?.[0] || null,
        recommendation: recommendation || { error: 'Could not parse model recommendation' },
        conversationId: convId,
        mode: 'route'
    };
}

async function handleCreate({ userId, message, conversationId, attachments = [], focusDocumentIds = [] }) {
    console.log(`PRISM: mode=create, userId=${userId}, conversationId=${conversationId}`);

    const convId = conversationId || crypto.randomUUID();
    let history = [];
    let conversationContext = '';
    if (conversationId) {
        const messages = await getConversation(conversationId);
        const builtContext = await buildConversationContext({
            messages,
            currentUserMessage: message,
            modelName: 'gemini-2.5-flash'
        });
        history = builtContext.history;
        conversationContext = builtContext.summaryText
            ? `SUMMARY OF PRIOR CREATE CONVERSATION:\n${builtContext.summaryText}`
            : builtContext.history.map((item) => `${item.role.toUpperCase()}: ${item.content}`).join('\n\n');
    }

    const userMap = await getUserMap(userId);
    const treeContext = formatUserMapTreeContext(userMap.tree, { maxItems: 16 });
    const legacyUserContext = JSON.stringify({
        preferences: userMap.preferences || {},
        agentHistory: userMap.agentHistory || [],
        orgContext: userMap.orgContext || {}
    }, null, 2);
    const userContext = treeContext || legacyUserContext;

    let memoryContextBlock = '';
    try {
        const memories = await searchRelevantMemories(userId, message, { limit: 6 });
        const memoryContext = formatMemoryContext(memories);
        if (memoryContext) {
            memoryContextBlock = `\nRELEVANT CROSS-CONVERSATION MEMORY:\n${memoryContext}\n`;
        }
    } catch (memoryErr) {
        console.warn('PRISM: create memory retrieval failed (non-fatal):', memoryErr.message);
    }

    let documentContextBlock = '';
    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            query: message,
            focusDocumentIds,
            maxFiles: 2,
            maxChars: 1100
        });
        if (documentContext.text) {
            documentContextBlock = `\nUSER DOCUMENT CONTEXT (retrieved from uploaded files):\n${documentContext.text}\n`;
        }
    } catch (docErr) {
        console.warn('PRISM: create document retrieval failed (non-fatal):', docErr.message);
    }

    const tools = filterCreateTools(await listTools());
    if (tools.length === 0) {
        throw httpError(503, 'No allowed tools available in ToolRegistry for Create mode');
    }
    const toolsJSON = JSON.stringify(tools.map((tool) => ({
        toolId: tool.toolId,
        name: tool.name,
        type: tool.type,
        category: tool.category,
        description: tool.description,
        capabilities: tool.capabilities
    })), null, 2);

    const models = filterVertexModels(await listModels());
    if (models.length === 0) {
        throw httpError(503, 'No Vertex models available in ModelRegistry');
    }
    const modelsJSON = JSON.stringify(models.map((model) => ({
        modelId: model.modelId,
        name: model.name,
        strengths: model.strengths,
        costTier: model.costTier,
        bestFor: model.bestFor,
        temperature_default: model.temperature_default
    })), null, 2);

    const systemPrompt = `You are Prism, the Meta Architect of RamN AI platform.
You are an expert AI architect, prompt engineer, and tool strategist.

Your job: Understand the user objective and design either an AI ChatBot Blueprint or a Group Blueprint.

AVAILABLE TOOLS (select ONLY from these):
${toolsJSON}

AVAILABLE MODELS (select ONLY from these):
${modelsJSON}

USER CONTEXT (from their history):
${userContext}
${memoryContextBlock}
${documentContextBlock}

${conversationContext ? `CONVERSATION SO FAR:\n${conversationContext}` : ''}

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

When generating a GROUP blueprint, respond with this JSON shape:
{
  "blueprintReady": true,
  "blueprintType": "team",
  "teamName": "short descriptive group name",
  "objective": "what this group must achieve",
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
  "explanation": "2-3 SHORT sentences: why this group architecture fits."
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
- The only user-selectable capabilities in this deployment are web-search and thinking
- The systemPrompt MUST follow the structured format above — no exceptions
- Choose the cheapest model that can handle the task
- Always include all sections: ROLE, GOAL, BACKSTORY, TOOLS, RULES, OUTPUT FORMAT, SAFETY
- Keep explanations SHORT (2-3 sentences max) — be concise, not verbose
- If the user explicitly asks for a group/team/squad, return blueprintType: "team"
- If the user asks for one specialist, return blueprintType: "agent"
- Return ONLY a raw JSON object. Do NOT use markdown, code fences, or surrounding commentary.`;

    const aiResult = await callAI({
        systemPrompt,
        userMessage: message,
        history,
        userParts: toVertexUserParts(attachments),
        modelName: 'gemini-2.5-pro',
        temperature: 0.3
    });

    const parsed = extractJSON(aiResult.text);

    let conversationalText = 'I need a bit more detail before I can build this blueprint.';
    if (parsed) {
        if (parsed.blueprintReady === false && parsed.message) {
            conversationalText = parsed.message;
        } else if (parsed.blueprintReady === true) {
            conversationalText = parsed.explanation || `Blueprint ready: ${parsed.agentName || parsed.teamName || 'New chatbot'} is ready to deploy.`;
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
                .filter((spec) => spec && (spec.name || spec.role))
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

    await saveMessage({ conversationId: convId, role: 'user', content: message, agentId: null, userId });
    await saveMessage({ conversationId: convId, role: 'assistant', content: conversationalText, agentId: null, userId });

    return {
        text: conversationalText,
        toolCall: derivedToolCall || aiResult.toolCalls?.[0] || null,
        conversationId: convId,
        mode: 'create'
    };
}

async function executeMode({ userId, mode, message, conversationId, attachments = [], focusDocumentIds = [], stream }) {
    switch (mode) {
        case 'ask':
            return handleAsk({ userId, message, conversationId, attachments, focusDocumentIds, stream });
        case 'route':
            return handleRoute({ userId, message, conversationId, attachments, focusDocumentIds });
        case 'create':
            return handleCreate({ userId, message, conversationId, attachments, focusDocumentIds });
        default:
            throw httpError(400, `Invalid mode: "${mode}". Must be: ask, route, or create`);
    }
}

async function parseAuthorizedRequest(event) {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const auth = await validateToken(authHeader);
    const userId = auth.userId;

    const body = JSON.parse(event.body || '{}');
    const { message, mode, conversationId } = body;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const focusDocumentIds = Array.isArray(body.focusDocumentIds) ? body.focusDocumentIds : [];

    if (!message) throw httpError(400, 'Missing message');
    if (!mode) throw httpError(400, 'Missing mode. Must be: ask, route, or create');

    const usage = await checkAndRecordUsage(userId, 'prism');
    if (!usage.allowed) {
        throw httpError(429, 'Rate limit exceeded', `Hourly limit reached (${usage.limit}/hour).`);
    }

    return {
        userId,
        message,
        mode,
        conversationId,
        attachments,
        focusDocumentIds
    };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return respond(200, {}, event.headers);
    }

    try {
        const request = await parseAuthorizedRequest(event);
        const payload = await executeMode(request);
        return respond(200, payload, event.headers);
    } catch (error) {
        console.error('PRISM: ❌ Fatal error:', error);
        const statusCode = error.statusCode || (error.message && error.message.startsWith('Unauthorized') ? 401 : 500);
        const errorCode = error.error || (statusCode === 401 ? 'Unauthorized' : 'Internal server error');
        return respond(statusCode, {
            error: errorCode,
            message: error.message || 'Unknown error'
        }, event.headers);
    }
};

export const streamHandler = awslambda.streamifyResponse(async (event, responseStream) => {
    let stream = null;
    try {
        const request = await parseAuthorizedRequest(event);
        stream = awslambda.HttpResponseStream.from(responseStream, buildStreamMetadata(event.headers, 200));
        await writeSseEvent(stream, { type: 'status', phase: 'accepted' });

        const payload = await executeMode({
            ...request,
            stream: request.mode === 'ask'
                ? async (streamEvent) => writeSseEvent(stream, streamEvent)
                : null
        });

        await writeSseEvent(stream, { type: 'final', payload });
        await writeSseEvent(stream, { type: 'done' });
        stream.end();
    } catch (error) {
        console.error('PRISM: ❌ Stream fatal error:', error);
        const statusCode = error.statusCode || (error.message && error.message.startsWith('Unauthorized') ? 401 : 500);
        const metadata = buildStreamMetadata(event.headers, statusCode);
        stream = stream || awslambda.HttpResponseStream.from(responseStream, metadata);
        await writeSseEvent(stream, {
            type: 'error',
            error: error.error || (statusCode === 401 ? 'Unauthorized' : 'Internal server error'),
            message: error.message || 'Unknown error'
        });
        await writeSseEvent(stream, { type: 'done' });
        stream.end();
    }
});
