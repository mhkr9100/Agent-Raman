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
import {
    getAgent,
    saveMessage,
    getConversation,
    getToolById,
    getUserMap
} from '../../shared/dynamo.js';
import { validateToken } from '../../shared/auth.js';

// ─── Constants ───────────────────────────────────────────────────

const MAX_REACT_ITERATIONS = 5;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Content-Type': 'application/json'
};

function respond(statusCode, body) {
    return { statusCode, headers: CORS, body: JSON.stringify(body) };
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
        // Safe math evaluation (basic arithmetic only)
        const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '');
        const result = Function('"use strict"; return (' + sanitized + ')')();
        return `Result: ${result}`;
    } catch (err) {
        return `Calculator error: Could not evaluate "${expression}". ${err.message}`;
    }
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

// Tool executor registry — maps toolId to function
const TOOL_EXECUTORS = {
    'googleSearch': executeGoogleSearch,
    'google_search': executeGoogleSearch,
    'webSearch': executeGoogleSearch,
    'web_search': executeGoogleSearch,
    'calculator': executeCalculator,
    'math': executeCalculator,
    'getCurrentTime': executeGetCurrentTime,
    'get_current_time': executeGetCurrentTime,
    'datetime': executeGetCurrentTime,
};

async function executeTool(toolName, args) {
    const executor = TOOL_EXECUTORS[toolName];
    if (executor) {
        return await executor(args);
    }
    return `[Tool "${toolName}" has no executor configured yet] The agent requested this tool but it is not yet implemented. Please answer using your training data.`;
}

// ─── Convert ToolRegistry records to Gemini functionDeclarations ─

function toolToFunctionDeclaration(tool) {
    // Map RamN_ToolRegistry shape → Gemini functionDeclaration shape
    const decl = {
        name: tool.toolId,
        description: tool.description || `Tool: ${tool.name}`
    };

    // Build parameters schema based on tool type
    if (tool.toolId === 'googleSearch' || tool.toolId === 'webSearch' || tool.toolId === 'web_search') {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                query: { type: 'STRING', description: 'The search query to look up' }
            },
            required: ['query']
        };
    } else if (tool.toolId === 'calculator' || tool.toolId === 'math') {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                expression: { type: 'STRING', description: 'The mathematical expression to evaluate (e.g., "2 + 2", "15 * 3.14")' }
            },
            required: ['expression']
        };
    } else if (tool.toolId === 'getCurrentTime' || tool.toolId === 'datetime') {
        decl.parameters = {
            type: 'OBJECT',
            properties: {
                timezone: { type: 'STRING', description: 'IANA timezone string (e.g., "America/New_York", "UTC")' }
            },
            required: []
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
        return respond(200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { agentId, message, conversationId } = body;

        if (!agentId) return respond(400, { error: 'Missing agentId' });
        if (!message) return respond(400, { error: 'Missing message' });

        console.log(`AGENT-RUN: agentId=${agentId}, userId=${userId}, conversationId=${conversationId || 'new'}`);

        // 1. Load agent from DynamoDB
        const agent = await getAgent(agentId, userId);

        if (!agent) {
            console.warn(`AGENT-RUN: Agent not found: ${agentId}`);
            return respond(404, { error: 'Agent not found' });
        }

        if (agent.userId !== userId) {
            console.warn(`AGENT-RUN: Forbidden — agent belongs to ${agent.userId}, not ${userId}`);
            return respond(403, { error: 'You do not have access to this agent' });
        }

        console.log(`AGENT-RUN: Loaded agent "${agent.name}" (status: ${agent.status})`);

        if (agent.status !== 'active') {
            return respond(400, { error: `Agent is ${agent.status}. Only active agents can be run.` });
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
        const modelId = blueprint.model?.modelId || 'gemini-2.0-flash';
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

        console.log(`AGENT-RUN: Using model=${modelId}, temperature=${temperature}`);
        console.log(`AGENT-RUN: System prompt length: ${systemPrompt.length} chars`);

        // 4. Resolve tools from ToolRegistry → Gemini functionDeclarations
        const blueprintToolIds = blueprint.tools || [];
        let functionDeclarations = [];

        if (blueprintToolIds.length > 0) {
            console.log(`AGENT-RUN: Resolving ${blueprintToolIds.length} tools: [${blueprintToolIds.join(', ')}]`);
            const toolPromises = blueprintToolIds.map(tid => getToolById(tid));
            const toolRecords = await Promise.all(toolPromises);
            functionDeclarations = toolRecords
                .filter(t => t !== null)
                .map(toolToFunctionDeclaration);
            console.log(`AGENT-RUN: Resolved ${functionDeclarations.length} function declarations`);
        }

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

                    const observation = await executeTool(tc.name, tc.args);
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
        return respond(200, {
            response: finalText,
            conversationId: convId,
            agentId,
            agentName: agent.name,
            toolsUsed: allToolCalls.map(tc => tc.name),
            iterations: iteration
        });

    } catch (error) {
        console.error('AGENT-RUN: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(401, { error: 'Unauthorized', message: error.message });
        }

        return respond(500, {
            error: 'Failed to run agent',
            message: error.message || 'Unknown error'
        });
    }
};
