/**
 * RamN AI — Agent Run Lambda (ChatBot Runtime)
 */

import crypto from 'crypto';
import {
    callAI,
    callAIStream,
    callAIWithTools,
    callAIWithToolsStream
} from '../../shared/vertex-ai.js';
import {
    getAgent,
    saveMessage,
    getConversation,
    getToolById,
    getUserMap,
    updateAgent,
    searchRelevantMemories
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';
import { checkAndRecordUsage } from '../../shared/rate-limit.js';
import { deriveToolIdsFromBlueprint, toCanonicalToolId } from '../../shared/tool-ids.js';
import { buildCorsHeaders } from '../../shared/cors.js';
import {
    DEFAULT_VERTEX_MODEL_ID,
    SUPPORTED_VERTEX_MODELS,
    resolveSupportedVertexModelId
} from '../../shared/runtime-policy.js';
import { getRelevantDocumentContext } from '../../shared/document-context.js';
import { buildConversationContext } from '../../shared/conversation-context.js';
import { summarizeAttachmentNames, toVertexUserParts } from '../../shared/chat-attachments.js';

const MAX_REACT_ITERATIONS = 5;

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

function httpError(statusCode, error, message = error) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.error = error;
    return err;
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

const GREETING_ONLY_MESSAGES = new Set([
    'hi',
    'hello',
    'hey',
    'hey there',
    'hi there',
    'good morning',
    'good afternoon',
    'good evening',
    'yo',
    'sup'
]);

function normalizeRequestedCapability(capability) {
    const normalized = toCanonicalToolId(String(capability || '').trim());
    if (!normalized || normalized === 'auto') return null;
    return ['web-search', 'thinking'].includes(normalized) ? normalized : null;
}

function isGreetingOnlyMessage(message) {
    const normalized = String(message || '')
        .trim()
        .toLowerCase()
        .replace(/[.!?,]+/g, '');
    return GREETING_ONLY_MESSAGES.has(normalized);
}

function buildGreetingResponse(agentName) {
    return `Hello! I'm ${agentName}. What would you like me to help you with today?`;
}

async function executeGoogleSearch(args) {
    const query = args.query || args.search_query || '';
    console.log(`TOOL-EXEC: googleSearch — query="${query}"`);

    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;

    if (apiKey && cseId) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                return data.items.map((item, index) => `${index + 1}. **${item.title}**\n   ${item.snippet}\n   URL: ${item.link}`).join('\n\n');
            }
            return `Search returned no results for: "${query}"`;
        } catch (err) {
            return `Search failed: ${err.message}. Please answer based on verified information already available.`;
        }
    }

    return `[Google Search API not configured] The chatbot attempted to search for "${query}" but no API key is set.`;
}

async function executeCalculator(args) {
    const expression = args.expression || args.input || '';
    console.log(`TOOL-EXEC: calculator — expression="${expression}"`);
    try {
        const result = evaluateArithmeticExpression(expression);
        return `Result: ${result}`;
    } catch (err) {
        return `Calculator error: Could not evaluate "${expression}". ${err.message}`;
    }
}

function evaluateArithmeticExpression(input) {
    const sanitized = String(input || '').replace(/\s+/g, '');
    if (!sanitized || /[^0-9+\-*/().%]/.test(sanitized)) {
        throw new Error('Only numbers and + - * / % ( ) are allowed');
    }

    const tokens = [];
    let index = 0;
    while (index < sanitized.length) {
        const ch = sanitized[index];
        if (/[0-9.]/.test(ch)) {
            let num = ch;
            index++;
            while (index < sanitized.length && /[0-9.]/.test(sanitized[index])) {
                num += sanitized[index];
                index++;
            }
            if ((num.match(/\./g) || []).length > 1) throw new Error(`Invalid number: ${num}`);
            tokens.push({ type: 'num', value: Number(num) });
            continue;
        }
        tokens.push({ type: 'op', value: ch });
        index++;
    }

    const values = [];
    const ops = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };

    const applyOp = () => {
        const op = ops.pop();
        const b = values.pop();
        const a = values.pop();
        if (typeof a !== 'number' || typeof b !== 'number') throw new Error('Malformed expression');
        if (op === '/' && b === 0) throw new Error('Division by zero');
        switch (op) {
            case '+': values.push(a + b); break;
            case '-': values.push(a - b); break;
            case '*': values.push(a * b); break;
            case '/': values.push(a / b); break;
            case '%': values.push(a % b); break;
            default: throw new Error(`Unsupported operator: ${op}`);
        }
    };

    let prevType = 'start';
    for (const token of tokens) {
        if (token.type === 'num') {
            values.push(token.value);
            prevType = 'num';
            continue;
        }

        const op = token.value;
        if (op === '(') {
            ops.push(op);
            prevType = 'op';
            continue;
        }
        if (op === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') applyOp();
            if (!ops.length || ops.pop() !== '(') throw new Error('Mismatched parentheses');
            prevType = 'num';
            continue;
        }

        if (op === '-' && (prevType === 'start' || prevType === 'op')) {
            values.push(0);
        }

        while (ops.length && ops[ops.length - 1] !== '(' && precedence[ops[ops.length - 1]] >= precedence[op]) {
            applyOp();
        }
        ops.push(op);
        prevType = 'op';
    }

    while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(' || top === ')') throw new Error('Mismatched parentheses');
        applyOp();
    }

    if (values.length !== 1 || Number.isNaN(values[0]) || !Number.isFinite(values[0])) {
        throw new Error('Malformed expression');
    }

    return values[0];
}

async function executeGetCurrentTime(args) {
    const timezone = args.timezone || 'UTC';
    console.log(`TOOL-EXEC: getCurrentTime — timezone="${timezone}"`);
    try {
        const now = new Date().toLocaleString('en-US', { timeZone: timezone });
        return `Current time (${timezone}): ${now}`;
    } catch {
        return `Current time (UTC): ${new Date().toISOString()}`;
    }
}

async function executeDocReader(args, context = {}) {
    const query = String(args?.query || args?.question || args?.input || '').trim();
    const { userId, agentId } = context;
    const documentContext = await getRelevantDocumentContext({ userId, agentId, query });
    if (documentContext.error) return documentContext.error;
    if (!documentContext.text) return 'No registered documents found for this session.';
    return `Document Reader Results${query ? ` for "${query}"` : ''}:\n\n${documentContext.text}`;
}

const TOOL_EXECUTORS = {
    'web-search': executeGoogleSearch,
    googleSearch: executeGoogleSearch,
    google_search: executeGoogleSearch,
    webSearch: executeGoogleSearch,
    web_search: executeGoogleSearch,
    calculator: executeCalculator,
    math: executeCalculator,
    getCurrentTime: executeGetCurrentTime,
    get_current_time: executeGetCurrentTime,
    datetime: executeGetCurrentTime,
    'doc-reader': executeDocReader,
    doc_reader: executeDocReader,
    docReader: executeDocReader
};

const LEGACY_TOOL_CANDIDATES = {
    'web-search': ['webSearch', 'googleSearch', 'web_search'],
    'doc-reader': ['docReader', 'doc_reader', 'fileManipulation'],
    thinking: ['thinking']
};

async function getToolRecordWithFallback(toolId) {
    const canonical = toCanonicalToolId(toolId);
    let record = await getToolById(canonical);
    if (record) return record;

    const candidates = LEGACY_TOOL_CANDIDATES[canonical] || [];
    for (const legacyId of candidates) {
        record = await getToolById(legacyId);
        if (record) return record;
    }
    return null;
}

function resolveRuntimeModel(requestedModelId) {
    const resolution = resolveSupportedVertexModelId(requestedModelId);
    if (!SUPPORTED_VERTEX_MODELS.has(resolution.runtimeModelId)) {
        return {
            ok: false,
            error: `Model "${requestedModelId}" is not enabled in this deployment. Supported models: ${Array.from(SUPPORTED_VERTEX_MODELS).join(', ')}`
        };
    }
    return {
        ok: true,
        runtimeModelId: resolution.runtimeModelId,
        migrated: resolution.migrated,
        reason: resolution.reason
    };
}

async function executeTool(toolName, args, context = {}) {
    const canonical = toCanonicalToolId(toolName);
    const executor = TOOL_EXECUTORS[canonical] || TOOL_EXECUTORS[toolName];
    if (executor) return executor(args, context);
    return `[Tool "${toolName}" has no executor configured yet] The chatbot requested this tool but it is not yet implemented.`;
}

function toolToFunctionDeclaration(tool) {
    const canonicalId = toCanonicalToolId(tool.toolId);
    if (canonicalId === 'web-search' || canonicalId === 'thinking') {
        return null;
    }

    const declaration = {
        name: canonicalId,
        description: tool.description || `Tool: ${tool.name}`
    };

    if (['googleSearch', 'webSearch', 'web_search', 'web-search'].includes(canonicalId)) {
        declaration.parameters = {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'The search query to look up' }
            },
            required: ['query']
        };
    } else if (['calculator', 'math'].includes(canonicalId)) {
        declaration.parameters = {
            type: 'OBJECT',
            properties: {
                expression: { type: 'STRING', description: 'The mathematical expression to evaluate' }
            },
            required: ['expression']
        };
    } else if (['getCurrentTime', 'datetime', 'get_current_time'].includes(canonicalId)) {
        declaration.parameters = {
            type: 'OBJECT',
            properties: {
                timezone: { type: 'STRING', description: 'IANA timezone string' }
            },
            required: []
        };
    } else if (['doc-reader', 'doc_reader', 'docReader'].includes(canonicalId)) {
        declaration.parameters = {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'Question or query to retrieve relevant document snippets' }
            },
            required: []
        };
    } else {
        declaration.parameters = {
            type: 'OBJECT',
            properties: {
                input: { type: 'STRING', description: `Input for the ${tool.name} tool` }
            },
            required: ['input']
        };
    }

    return declaration;
}

function buildToolRuntimeConfig(toolRecords, requestedCapability) {
    const availableCapabilities = new Set(
        (toolRecords || [])
            .map((tool) => toCanonicalToolId(tool?.toolId))
            .filter(Boolean)
    );

    const functionDeclarations = [];
    let hasWebSearch = false;
    let hasThinking = false;

    for (const tool of toolRecords || []) {
        const canonicalId = toCanonicalToolId(tool?.toolId);
        if (!canonicalId) continue;

        if (canonicalId === 'web-search') {
            hasWebSearch = true;
            continue;
        }

        if (canonicalId === 'thinking') {
            hasThinking = true;
            continue;
        }

        const declaration = toolToFunctionDeclaration(tool);
        if (declaration) {
            functionDeclarations.push(declaration);
        }
    }

    const uniqueFunctionDeclarations = Array.from(
        new Map(functionDeclarations.map((tool) => [tool.name, tool])).values()
    );

    const requested = normalizeRequestedCapability(requestedCapability);
    if (requested) {
        if (requested === 'thinking') {
            return {
                hasThinking: true,
                vertexTools: [],
                functionDeclarations: [],
                availableCapabilities
            };
        }

        if (!availableCapabilities.has(requested)) {
            throw httpError(400, 'Capability unavailable', `This chatbot does not have the "${requested}" capability enabled.`);
        }

        if (requested === 'web-search') {
            return {
                hasThinking,
                vertexTools: [{ googleSearch: {} }],
                functionDeclarations: [],
                availableCapabilities
            };
        }

        return {
            hasThinking,
            vertexTools: uniqueFunctionDeclarations.length > 0
                ? [{ functionDeclarations: uniqueFunctionDeclarations.filter((tool) => tool.name === requested) }]
                : [],
            functionDeclarations: uniqueFunctionDeclarations.filter((tool) => tool.name === requested),
            availableCapabilities
        };
    }

    const vertexTools = [];
    if (uniqueFunctionDeclarations.length > 0) {
        vertexTools.push({ functionDeclarations: uniqueFunctionDeclarations });
    }
    if (hasWebSearch) {
        vertexTools.push({ googleSearch: {} });
    }

    return {
        hasThinking,
        vertexTools,
        functionDeclarations: uniqueFunctionDeclarations,
        availableCapabilities
    };
}

async function buildRuntimeContext({ userId, agentId, message, conversationId, attachments = [], focusDocumentIds = [], requestedCapability = null }) {
    const convId = conversationId || crypto.randomUUID();
    let history = [];
    let conversationSummary = '';

    const agent = await getAgent(agentId, userId);
    if (!agent) throw httpError(404, 'ChatBot not found');
    if (agent.userId !== userId) throw httpError(403, 'You do not have access to this agent');
    if (agent.status !== 'active') throw httpError(400, `ChatBot is ${agent.status}. Only active chatbots can be run.`);

    const blueprint = agent.blueprint;
    const requestedModelId = blueprint.model?.modelId || DEFAULT_VERTEX_MODEL_ID;
    const modelResolution = resolveRuntimeModel(requestedModelId);
    if (!modelResolution.ok) throw httpError(400, modelResolution.error);
    const modelId = modelResolution.runtimeModelId;

    if (modelResolution.migrated) {
        try {
            await updateAgent(agentId, userId, {
                blueprint: {
                    ...blueprint,
                    model: {
                        ...(blueprint.model || {}),
                        modelId
                    }
                }
            });
        } catch (repairError) {
            console.warn('AGENT-RUN: Failed to persist repaired model mapping:', repairError.message);
        }
    }

    if (conversationId) {
        const messages = await getConversation(conversationId);
        const conversationContext = await buildConversationContext({
            messages,
            currentUserMessage: message,
            modelName: modelId
        });
        history = conversationContext.history;
        conversationSummary = conversationContext.summaryText;
    }

    let systemPrompt = blueprint.systemPrompt;
    if (conversationSummary) {
        systemPrompt = `${systemPrompt}\n\n# PRIOR CONVERSATION SUMMARY\n${conversationSummary}`;
    }

    try {
        const userMap = await getUserMap(userId);
        if (userMap && (userMap.preferences || userMap.orgContext || userMap.agentHistory)) {
            const contextSnippet = JSON.stringify({
                preferences: userMap.preferences || {},
                orgContext: userMap.orgContext || {},
                agentHistory: userMap.agentHistory || []
            }, null, 2);
            systemPrompt = `${systemPrompt}\n\n# UPDATED USER CONTEXT (UserMap)\nThe following is the current, up-to-date context about the user you are assisting. Use this to personalize your response:\n${contextSnippet}`;
        }
    } catch (mapErr) {
        console.warn('AGENT-RUN: UserMap fetch failed (non-fatal):', mapErr.message);
    }

    try {
        const memories = await searchRelevantMemories(userId, message, { agentId, limit: 6 });
        const memoryContext = formatMemoryContext(memories);
        if (memoryContext) {
            systemPrompt = `${systemPrompt}\n\n# RELEVANT CROSS-CONVERSATION MEMORY\nThese facts were extracted from prior conversations with Prism and other chatbots. Use them only when they directly help the answer.\n${memoryContext}`;
        }
    } catch (memoryErr) {
        console.warn('AGENT-RUN: Memory retrieval failed (non-fatal):', memoryErr.message);
    }

    try {
        const documentContext = await getRelevantDocumentContext({
            userId,
            agentId,
            query: message,
            focusDocumentIds,
            maxFiles: 3,
            maxChars: 1200
        });
        if (documentContext.text) {
            systemPrompt = `${systemPrompt}\n\n# RETRIEVED DOCUMENT CONTEXT\nThese snippets were retrieved from documents already attached to this chatbot or user account. Treat them as high-priority evidence and cite the document names when useful.\n${documentContext.text}`;
        } else if (documentContext.error) {
            systemPrompt = `${systemPrompt}\n\n# DOCUMENT RETRIEVAL STATUS\nDocument retrieval returned: ${documentContext.error}`;
        }
    } catch (docErr) {
        console.warn('AGENT-RUN: Failed to retrieve document context:', docErr.message);
    }

    const blueprintToolIds = deriveToolIdsFromBlueprint(blueprint);
    const blueprintTools = Array.isArray(blueprint.tools) ? blueprint.tools : [];
    let toolRecords = [];

    if (blueprintTools.length > 0 && typeof blueprintTools[0] === 'object') {
        toolRecords = blueprintTools.filter(Boolean);
    } else {
        const idsToResolve = blueprintToolIds.length > 0
            ? blueprintToolIds
            : (Array.isArray(blueprintTools) ? blueprintTools.map(toCanonicalToolId) : []);
        if (idsToResolve.length > 0 && typeof idsToResolve[0] === 'string') {
            const resolved = await Promise.all(idsToResolve.map((toolId) => getToolRecordWithFallback(toolId)));
            toolRecords = resolved.filter(Boolean);
        }
    }

    const runtimeTools = buildToolRuntimeConfig(toolRecords, requestedCapability);
    if (runtimeTools.hasThinking) {
        systemPrompt = `${systemPrompt}\n\n# REASONING MODE\nUse deliberate step-by-step reasoning internally before answering.`;
    }
    if (runtimeTools.availableCapabilities.has('web-search')) {
        systemPrompt = `${systemPrompt}\n\n# LIVE WEB ACCESS\nYou have access to Google Search grounding through Vertex AI. Use it whenever the user needs current web information instead of guessing.`;
    }
    const attachmentSummary = summarizeAttachmentNames(attachments);
    const persistedUserMessage = attachmentSummary
        ? `${message}\n\n[Image attachments included: ${attachmentSummary}]`
        : message;

    return {
        convId,
        agent,
        blueprint,
        modelId,
        requestedModelId,
        modelFallbackApplied: !!modelResolution.migrated,
        temperature: blueprint.model?.temperature ?? 0.3,
        history,
        systemPrompt,
        hasTools: runtimeTools.vertexTools.length > 0,
        functionDeclarations: runtimeTools.functionDeclarations,
        vertexTools: runtimeTools.vertexTools,
        userParts: toVertexUserParts(attachments),
        persistedUserMessage
    };
}

async function runAgentChat({ userId, agentId, message, conversationId, attachments = [], focusDocumentIds = [], requestedCapability = null, stream }) {
    const greetingOnly = isGreetingOnlyMessage(message) && attachments.length === 0 && focusDocumentIds.length === 0;
    if (greetingOnly) {
        const agent = await getAgent(agentId, userId);
        if (!agent) throw httpError(404, 'ChatBot not found');
        if (agent.userId !== userId) throw httpError(403, 'You do not have access to this agent');
        if (agent.status !== 'active') throw httpError(400, `ChatBot is ${agent.status}. Only active chatbots can be run.`);

        const convId = conversationId || crypto.randomUUID();
        const greetingText = buildGreetingResponse(agent.name);
        await saveMessage({ conversationId: convId, role: 'user', content: message, agentId, userId });
        await saveMessage({ conversationId: convId, role: 'assistant', content: greetingText, agentId, userId });
        return {
            response: greetingText,
            conversationId: convId,
            agentId,
            agentName: agent.name,
            requestedModelId: agent.blueprint?.model?.modelId || DEFAULT_VERTEX_MODEL_ID,
            runtimeModelId: agent.blueprint?.model?.modelId || DEFAULT_VERTEX_MODEL_ID,
            modelFallbackApplied: false,
            toolsUsed: [],
            iterations: 0
        };
    }

    const runtime = await buildRuntimeContext({ userId, agentId, message, conversationId, attachments, focusDocumentIds, requestedCapability });

    await saveMessage({
        conversationId: runtime.convId,
        role: 'user',
        content: runtime.persistedUserMessage,
        agentId,
        userId
    });

    let finalText = '';
    let allToolCalls = [];
    let iteration = 0;

    if (!runtime.hasTools) {
        const aiResult = stream
            ? await callAIStream({
                systemPrompt: runtime.systemPrompt,
                userMessage: message,
                history: runtime.history,
                userParts: runtime.userParts,
                modelName: runtime.modelId,
                temperature: runtime.temperature,
                onTextDelta: async (delta) => stream({ type: 'text-delta', delta })
            })
            : await callAI({
                systemPrompt: runtime.systemPrompt,
                userMessage: message,
                history: runtime.history,
                userParts: runtime.userParts,
                modelName: runtime.modelId,
                temperature: runtime.temperature
            });
        finalText = aiResult.text;
        iteration = 1;
    } else {
        while (iteration < MAX_REACT_ITERATIONS) {
            iteration++;
            if (stream) {
                await stream({ type: 'status', phase: `reasoning-${iteration}` });
            }

            const aiResult = stream
                ? await callAIWithToolsStream({
                    systemPrompt: runtime.systemPrompt,
                    userMessage: iteration === 1 ? message : null,
                    history: runtime.history,
                    userParts: iteration === 1 ? runtime.userParts : [],
                    tools: runtime.vertexTools,
                    modelName: runtime.modelId,
                    temperature: runtime.temperature,
                    onTextDelta: async (delta) => stream({ type: 'text-delta', delta }),
                    onToolCall: async (toolCall) => stream({ type: 'tool-call', tool: { name: toolCall.name, args: toolCall.args } })
                })
                : await callAIWithTools({
                    systemPrompt: runtime.systemPrompt,
                    userMessage: iteration === 1 ? message : null,
                    history: runtime.history,
                    userParts: iteration === 1 ? runtime.userParts : [],
                    tools: runtime.vertexTools,
                    modelName: runtime.modelId,
                    temperature: runtime.temperature
                });

            const toolCalls = aiResult.toolCalls || [];
            if (toolCalls.length === 0) {
                finalText = aiResult.text;
                break;
            }

            allToolCalls.push(...toolCalls);
            for (const toolCall of toolCalls) {
                const observation = await executeTool(toolCall.name, toolCall.args, { userId, agentId });
                if (stream) {
                    await stream({
                        type: 'tool-result',
                        tool: toolCall.name,
                        preview: String(observation || '').slice(0, 240)
                    });
                }

                runtime.history.push({
                    role: 'model',
                    content: aiResult.text || `[Calling tool: ${toolCall.name}]`
                });
                runtime.history.push({
                    role: 'user',
                    content: `[Tool Result for ${toolCall.name}]: ${observation}`
                });

                await saveMessage({
                    conversationId: runtime.convId,
                    role: 'user',
                    content: `[Tool: ${toolCall.name}] ${observation}`,
                    agentId,
                    userId
                });
            }

            if (aiResult.text) {
                finalText += `${aiResult.text}\n`;
            }
        }

        if (iteration >= MAX_REACT_ITERATIONS && !finalText) {
            finalText = `I attempted to use my tools but reached the maximum reasoning depth (${MAX_REACT_ITERATIONS} steps). Here is what I gathered so far:\n\n${allToolCalls.map((toolCall) => `- Called **${toolCall.name}** with ${JSON.stringify(toolCall.args)}`).join('\n')}`;
        }
    }

    await saveMessage({
        conversationId: runtime.convId,
        role: 'assistant',
        content: finalText,
        agentId,
        userId
    });

    return {
        response: finalText,
        conversationId: runtime.convId,
        agentId,
        agentName: runtime.agent.name,
        requestedModelId: runtime.requestedModelId,
        runtimeModelId: runtime.modelId,
        modelFallbackApplied: runtime.modelFallbackApplied,
        toolsUsed: allToolCalls.map((toolCall) => toolCall.name),
        iterations: iteration
    };
}

async function parseAuthorizedRequest(event) {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    const auth = await validateToken(authHeader);
    const userId = auth.userId;

    const body = JSON.parse(event.body || '{}');
    const { agentId, message, conversationId } = body;
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const focusDocumentIds = Array.isArray(body.focusDocumentIds) ? body.focusDocumentIds : [];
    const requestedCapability = normalizeRequestedCapability(body.requestedCapability);

    if (!agentId) throw httpError(400, 'Missing agentId');
    if (!message) throw httpError(400, 'Missing message');

    const usage = await checkAndRecordUsage(userId, 'agent');
    if (!usage.allowed) {
        throw httpError(429, 'Rate limit exceeded', `Hourly limit reached (${usage.limit}/hour).`);
    }

    return {
        userId,
        agentId,
        message,
        conversationId,
        attachments,
        focusDocumentIds,
        requestedCapability
    };
}

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return respond(event, 200, {});
    }

    try {
        const request = await parseAuthorizedRequest(event);
        const payload = await runAgentChat(request);
        return respond(event, 200, payload);
    } catch (error) {
        console.error('AGENT-RUN: ❌ Error:', error);
        const statusCode = error.statusCode || (error.message && error.message.startsWith('Unauthorized') ? 401 : 500);
        const errorCode = error.error || (statusCode === 401 ? 'Unauthorized' : 'Failed to run chatbot');
        return respond(event, statusCode, {
            error: errorCode,
            message: error.message || 'Unknown error'
        });
    }
};

export const streamHandler = awslambda.streamifyResponse(async (event, responseStream) => {
    let stream = null;
    try {
        const request = await parseAuthorizedRequest(event);
        stream = awslambda.HttpResponseStream.from(responseStream, buildStreamMetadata(event.headers, 200));
        await writeSseEvent(stream, { type: 'status', phase: 'accepted' });

        const payload = await runAgentChat({
            ...request,
            stream: async (streamEvent) => writeSseEvent(stream, streamEvent)
        });

        await writeSseEvent(stream, { type: 'final', payload });
        await writeSseEvent(stream, { type: 'done' });
        stream.end();
    } catch (error) {
        console.error('AGENT-RUN: ❌ Stream error:', error);
        const statusCode = error.statusCode || (error.message && error.message.startsWith('Unauthorized') ? 401 : 500);
        stream = stream || awslambda.HttpResponseStream.from(responseStream, buildStreamMetadata(event.headers, statusCode));
        await writeSseEvent(stream, {
            type: 'error',
            error: error.error || (statusCode === 401 ? 'Unauthorized' : 'Failed to run chatbot'),
            message: error.message || 'Unknown error'
        });
        await writeSseEvent(stream, { type: 'done' });
        stream.end();
    }
});
