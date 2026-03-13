/**
 * RamN AI — Agent Run Lambda (Agent Runtime)
 * 
 * Executes a created agent by loading its blueprint from DynamoDB
 * and calling Vertex AI with the saved system prompt and model config.
 * 
 * Tier 2 Upgrade: ReAct Loop (Reason + Act)
 * The agent can now use tools autonomously. If the LLM requests a tool call,
 * the Lambda executes it, feeds the result back, and loops until a final
 * text answer is produced — just like CrewAI, LangGraph, and Agno agents.
 * 
 * POST /api/agents/{agentId}/chat
 * Body: { agentId, userId, message, conversationId }
 */

import { callAI, callAIWithTools } from '../../shared/vertex-ai.js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
    getAgent,
    saveMessage,
    getConversation,
    getToolById,
    getUserMap,
    saveDocument,
    updateAgent
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

// ─── Constants ───────────────────────────────────────────────────

const MAX_REACT_ITERATIONS = 5;
const s3Client = new S3Client({ region: process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2' });

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

// ─── Built-in Tool Executors ─────────────────────────────────────
// Each tool maps to a real function. Add new tool executors here.

async function executeGoogleSearch(args) {
    const query = args.query || args.search_query || '';
    console.log(`TOOL-EXEC: googleSearch — query="${query}"`);

    // Use Google Custom Search API or fallback to a summary
    const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
    const cseId = process.env.GOOGLE_CSE_ID;

    if (apiKey && cseId) {
        try {
            const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.items && data.items.length > 0) {
                return data.items.map((item, i) => `${i + 1}. **${item.title}**\n   ${item.snippet}\n   URL: ${item.link}`).join('\n\n');
            }
            return `Search returned no results for: "${query}"`;
        } catch (err) {
            return `Search failed: ${err.message}. Please answer based on your training data.`;
        }
    }

    return `[Google Search API not configured] The agent attempted to search for "${query}" but no API key is set. Answering based on training data instead.`;
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
    let i = 0;
    while (i < sanitized.length) {
        const ch = sanitized[i];
        if (/[0-9.]/.test(ch)) {
            let num = ch;
            i++;
            while (i < sanitized.length && /[0-9.]/.test(sanitized[i])) {
                num += sanitized[i];
                i++;
            }
            if ((num.match(/\./g) || []).length > 1) {
                throw new Error(`Invalid number: ${num}`);
            }
            tokens.push({ type: 'num', value: Number(num) });
            continue;
        }
        tokens.push({ type: 'op', value: ch });
        i++;
    }

    const values = [];
    const ops = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2 };

    const applyOp = () => {
        const op = ops.pop();
        const b = values.pop();
        const a = values.pop();
        if (typeof a !== 'number' || typeof b !== 'number') {
            throw new Error('Malformed expression');
        }
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

        while (
            ops.length &&
            ops[ops.length - 1] !== '(' &&
            precedence[ops[ops.length - 1]] >= precedence[op]
        ) {
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
    if (documentContext.error) {
        return documentContext.error;
    }
    if (!documentContext.text) {
        return 'No registered documents found for this session.';
    }
    return `Document Reader Results${query ? ` for "${query}"` : ''}:\n\n${documentContext.text}`;
}

async function executeCanvas(args, context = {}) {
    const { userId, agentId } = context;
    if (!userId) {
        return 'Canvas requires a valid user context.';
    }

    const bucket = process.env.S3_BUCKET_NAME || '';
    if (!bucket) {
        return 'Canvas is unavailable because S3 bucket configuration is missing.';
    }

    const content = String(args?.content || args?.markdown || args?.input || '').trim();
    if (!content) {
        return 'Canvas requires non-empty content.';
    }

    const title = String(args?.title || 'Canvas Note').trim() || 'Canvas Note';
    const safeTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'canvas-note';

    const ownerType = agentId ? 'agent' : 'user';
    const ownerId = agentId || userId;
    const docId = crypto.randomUUID();
    const key = `knowledge-base/${ownerId}/canvas/${Date.now()}-${safeTitle}.md`;
    const payload = `# ${title}\n\n${content}\n`;

    await s3Client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: payload,
        ContentType: 'text/markdown; charset=utf-8'
    }));

    await saveDocument({
        docId,
        userId,
        ownerType,
        ownerId,
        fileName: `${title}.md`,
        fileKey: key,
        textKey: key,
        contentType: 'text/markdown',
        size: Buffer.byteLength(payload, 'utf-8')
    });

    return `Canvas saved successfully as "${title}.md" in the ${ownerType === 'agent' ? 'chatbot' : 'user'} knowledge space.`;
}

// Tool executor registry — maps toolId to function
const TOOL_EXECUTORS = {
    // Search Tool Aliases
    'web-search': executeGoogleSearch,
    googleSearch: executeGoogleSearch,
    google_search: executeGoogleSearch,
    webSearch: executeGoogleSearch,
    web_search: executeGoogleSearch,

    // Calculator Aliases
    'calculator': executeCalculator,
    'math': executeCalculator,

    // Time Tool Aliases
    'getCurrentTime': executeGetCurrentTime,
    'get_current_time': executeGetCurrentTime,
    'datetime': executeGetCurrentTime,

    // Document Reader
    'doc-reader': executeDocReader,
    'doc_reader': executeDocReader,
    'docReader': executeDocReader,

    // Canvas
    canvas: executeCanvas
};

const LEGACY_TOOL_CANDIDATES = {
    'web-search': ['webSearch', 'googleSearch', 'web_search'],
    'image-generation': ['imageGeneration', 'imageEditing'],
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
    if (executor) {
        return await executor(args, context);
    }
    return `[Tool "${toolName}" has no executor configured yet] The agent requested this tool but it is not yet implemented. Please answer using your training data.`;
}

// ─── Convert ToolRegistry records to Gemini functionDeclarations ─

function toolToFunctionDeclaration(tool) {
    // Map RamN_ToolRegistry shape → Gemini functionDeclaration shape
    const canonicalId = toCanonicalToolId(tool.toolId);
    const decl = {
        name: canonicalId,
        description: tool.description || `Tool: ${tool.name}`
    };

    // Build parameters schema based on tool type
    if (['googleSearch', 'webSearch', 'web_search', 'web-search'].includes(canonicalId)) {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'The search query to look up' }
            },
            required: ['query']
        };
    } else if (['calculator', 'math'].includes(canonicalId)) {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                expression: { type: 'STRING', description: 'The mathematical expression to evaluate (e.g., "2 + 2", "15 * 3.14")' }
            },
            required: ['expression']
        };
    } else if (['getCurrentTime', 'datetime', 'get_current_time'].includes(canonicalId)) {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                timezone: { type: 'STRING', description: 'IANA timezone string (e.g., "America/New_York", "UTC")' }
            },
            required: []
        };
    } else if (['doc-reader', 'doc_reader', 'docReader'].includes(canonicalId)) {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'Question or query to retrieve relevant document snippets' }
            },
            required: []
        };
    } else if (canonicalId === 'canvas') {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                title: { type: 'STRING', description: 'Short title for the canvas artifact' },
                content: { type: 'STRING', description: 'Markdown content to persist to the canvas' }
            },
            required: ['title', 'content']
        };
    } else {
        // Generic fallback — single input string
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                input: { type: 'STRING', description: `Input for the ${tool.name} tool` }
            },
            required: ['input']
        };
    }

    return decl;
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return respond(event, 200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { agentId, message, conversationId } = body;

        if (!agentId) return respond(event, 400, { error: 'Missing agentId' });
        if (!message) return respond(event, 400, { error: 'Missing message' });

        const usage = await checkAndRecordUsage(userId, 'agent');
        if (!usage.allowed) {
            return respond(event, 429, {
                error: 'Rate limit exceeded',
                message: `Hourly limit reached (${usage.limit}/hour).`,
                usage
            });
        }

        console.log(`AGENT-RUN: chatbotId=${agentId}, userId=${userId}, conversationId=${conversationId || 'new'}`);

        // 1. Load chatbot from DynamoDB
        const agent = await getAgent(agentId, userId);

        if (!agent) {
            console.warn(`AGENT-RUN: ChatBot not found: ${agentId}`);
            return respond(event, 404, { error: 'ChatBot not found' });
        }

        if (agent.userId !== userId) {
            console.warn(`AGENT-RUN: Forbidden — agent belongs to ${agent.userId}, not ${userId}`);
            return respond(event, 403, { error: 'You do not have access to this agent' });
        }

        console.log(`AGENT-RUN: Loaded chatbot "${agent.name}" (status: ${agent.status})`);

        if (agent.status !== 'active') {
            return respond(event, 400, { error: `ChatBot is ${agent.status}. Only active chatbots can be run.` });
        }

        // 2. Load conversation history
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

        // 3. Extract blueprint config & dynamic User Context (UserMap)
        const blueprint = agent.blueprint;
        const baseSystemPrompt = blueprint.systemPrompt;

        // Resolve selected model to a runtime-supported model.
        const requestedModelId = blueprint.model?.modelId || DEFAULT_VERTEX_MODEL_ID;
        const modelResolution = resolveRuntimeModel(requestedModelId);
        if (!modelResolution.ok) {
            return respond(event, 400, { error: modelResolution.error });
        }
        const modelId = modelResolution.runtimeModelId;
        const modelFallbackApplied = !!modelResolution.migrated;

        if (modelFallbackApplied) {
            console.warn(`AGENT-RUN: Repairing legacy model "${requestedModelId}" -> "${modelId}" for ${agentId}`);
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

        const temperature = blueprint.model?.temperature ?? 0.3;

        // Fetch LATEST user context (UserMap) — FAIL-SAFE: if this fails, agent still works
        let systemPrompt = baseSystemPrompt;
        try {
            const userMap = await getUserMap(userId);
            if (userMap && (userMap.preferences || userMap.orgContext || userMap.agentHistory)) {
                const contextSnippet = JSON.stringify({
                    preferences: userMap.preferences || {},
                    orgContext: userMap.orgContext || {},
                    agentHistory: userMap.agentHistory || []
                }, null, 2);
                systemPrompt = `${baseSystemPrompt}\n\n# UPDATED USER CONTEXT (UserMap)\nThe following is the current, up-to-date context about the user you are assisting. Use this to personalize your response:\n${contextSnippet}`;
            }
        } catch (mapErr) {
            console.warn('AGENT-RUN: ⚠️ UserMap fetch failed (non-fatal, using blueprint prompt only):', mapErr.message);
        }

        const blueprintToolIds = deriveToolIdsFromBlueprint(blueprint);

        try {
            const documentContext = await getRelevantDocumentContext({
                userId,
                agentId,
                query: message,
                maxFiles: 2,
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

        console.log(`AGENT-RUN: Using model=${modelId}, temperature=${temperature}`);
        console.log(`AGENT-RUN: System prompt length: ${systemPrompt.length} chars`);

        // 4. Resolve tools from ToolRegistry → Gemini functionDeclarations
        // Support legacy + canonical tool IDs.
        const blueprintTools = Array.isArray(blueprint.tools) ? blueprint.tools : [];
        let functionDeclarations = [];

        console.log(`AGENT-RUN: Resolving tools...`);

        if (blueprintTools.length > 0 && typeof blueprintTools[0] === 'object') {
            // Case 1: Tools are already resolved objects in the blueprint
            console.log(`AGENT-RUN: Using ${blueprintTools.length} pre-resolved tool objects from blueprint`);
            functionDeclarations = blueprintTools.map(toolToFunctionDeclaration);
        } else {
            // Case 2: We have IDs, need to fetch from DB
            const idsToResolve = blueprintToolIds.length > 0 ? blueprintToolIds : (Array.isArray(blueprintTools) ? blueprintTools.map(toCanonicalToolId) : []);
            if (idsToResolve.length > 0 && typeof idsToResolve[0] === 'string') {
                console.log(`AGENT-RUN: Fetching ${idsToResolve.length} tools from registry by ID: [${idsToResolve.join(', ')}]`);
                const toolPromises = idsToResolve.map(tid => getToolRecordWithFallback(tid));
                const toolRecords = await Promise.all(toolPromises);
                functionDeclarations = toolRecords
                    .filter(t => t !== null)
                    .map(toolToFunctionDeclaration);
            }
        }

        // Deduplicate function declarations by name after canonicalization.
        functionDeclarations = Array.from(
            new Map(functionDeclarations.map(d => [d.name, d])).values()
        );

        console.log(`AGENT-RUN: Resolved ${functionDeclarations.length} function declarations`);

        const hasTools = functionDeclarations.length > 0;

        // 5. Save user message to conversation
        await saveMessage({
            conversationId: convId,
            role: 'user',
            content: message,
            agentId,
            userId
        });

        // ═══════════════════════════════════════════════════════════
        //  Agent Execution
        // ═══════════════════════════════════════════════════════════

        let finalText = '';
        let allToolCalls = [];
        let iteration = 0;

        if (!hasTools) {
            // ─── Simple Path: No tools, single AI call (no ReAct loop needed) ───
            console.log('AGENT-RUN: No tools — single AI call (no ReAct loop)');
            const aiResult = await callAI({
                systemPrompt,
                userMessage: message,
                history,
                modelName: modelId,
                temperature
            });
            finalText = aiResult.text;
            iteration = 1;
            console.log(`AGENT-RUN: ✅ Response — ${finalText.length} chars`);
        } else {
            // ─── ReAct Loop: Thought → Action → Observation → repeat ───
            //     (CrewAI / LangGraph / Agno pattern)
            while (iteration < MAX_REACT_ITERATIONS) {
                iteration++;
                console.log(`AGENT-RUN: ═══ ReAct iteration ${iteration}/${MAX_REACT_ITERATIONS} ═══`);

                const aiResult = await callAIWithTools({
                    systemPrompt,
                    userMessage: iteration === 1 ? message : null,
                    history,
                    tools: functionDeclarations,
                    modelName: modelId,
                    temperature
                });

                const toolCalls = aiResult.toolCalls || [];
                console.log(`AGENT-RUN: AI response — ${aiResult.text.length} chars, ${toolCalls.length} tool calls`);

                // If no tool calls → this is the final answer
                if (toolCalls.length === 0) {
                    finalText = aiResult.text;
                    console.log(`AGENT-RUN: ✅ Final answer received at iteration ${iteration}`);
                    break;
                }

                // Tool calls detected → execute each one
                for (const tc of toolCalls) {
                    console.log(`AGENT-RUN: 🔧 Tool call: ${tc.name}(${JSON.stringify(tc.args)})`);
                    allToolCalls.push(tc);

                    const observation = await executeTool(tc.name, tc.args, { userId, agentId });
                    console.log(`AGENT-RUN: 📋 Observation: ${observation.substring(0, 200)}...`);

                    // Append the model's response (with tool call) to history
                    history.push({
                        role: 'model',
                        content: aiResult.text || `[Calling tool: ${tc.name}]`
                    });

                    // Append tool result as "user" message (Observation)
                    history.push({
                        role: 'user',
                        content: `[Tool Result for ${tc.name}]: ${observation}`
                    });

                    // Save tool observation to conversation for audit trail
                    await saveMessage({
                        conversationId: convId,
                        role: 'user',
                        content: `[Tool: ${tc.name}] ${observation}`,
                        agentId,
                        userId
                    });
                }

                // If we also got text alongside tool calls, accumulate it
                if (aiResult.text) {
                    finalText += aiResult.text + '\n';
                }
            }

            // Safety: if we ran out of iterations, use whatever text we have
            if (iteration >= MAX_REACT_ITERATIONS && !finalText) {
                finalText = `I attempted to use my tools but reached the maximum reasoning depth (${MAX_REACT_ITERATIONS} steps). Here is what I gathered so far:\n\n` +
                    allToolCalls.map(tc => `- Called **${tc.name}** with ${JSON.stringify(tc.args)}`).join('\n');
            }
        }

        // 6. Save final assistant response
        await saveMessage({
            conversationId: convId,
            role: 'assistant',
            content: finalText,
            agentId,
            userId
        });

        console.log(`AGENT-RUN: ✅ Response saved to conversation ${convId} (${iteration} iterations, ${allToolCalls.length} tool calls)`);

        // 7. Return
        return respond(event, 200, {
            response: finalText,
            conversationId: convId,
            agentId,
            agentName: agent.name,
            requestedModelId,
            runtimeModelId: modelId,
            modelFallbackApplied,
            toolsUsed: allToolCalls.map(tc => tc.name),
            iterations: iteration
        });

    } catch (error) {
        console.error('AGENT-RUN: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, {
            error: 'Failed to run chatbot',
            message: error.message || 'Unknown error'
        });
    }
};
