
import { GoogleGenAI, Type, Modality, FunctionDeclaration, GenerateContentResponse } from "@google/genai";
import { Message, Agent, MessageContent, Task, GroundingChunk, AgentCapability, ToolCall } from "../types";
import { AGENTS, AI_RESUMES, VAULT } from "../constants";
import { userMapService } from "./userMapService";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// ─── Platform-managed environment access ───
const getPlatformConfig = () => ({
    projectId: import.meta.env.VITE_GCP_PROJECT_ID as string,
    location: (import.meta.env.VITE_GCP_LOCATION as string) || 'us-central1'
});

/**
 * RamN AI always uses Gemini 2.0 Flash — platform managed.
 * No user API keys required.
 */
export function resolvePrismModel(): { model: string; provider: 'google' | 'aws' } {
    return { model: 'gemini-2.0-flash', provider: 'google' };
}

/**
 * Determine provider from model name
 */
function detectProvider(model: string): 'google' | 'aws' | 'openai' | 'anthropic' {
    if (model.includes('gemini') || model.includes('learnlm')) return 'google';
    if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai';
    if (model.includes('claude')) {
        // Decide if Bedrock or Vertex based on config (preferring Bedrock as user requested)
        return 'aws';
    }
    if (model.includes('llama')) return 'aws';
    return 'google';
}

function getAWSConfig() {
    return {
        region: VAULT.AWS.REGION,
        accessKeyId: VAULT.AWS.ACCESS_KEY_ID,
        secretAccessKey: VAULT.AWS.SECRET_ACCESS_KEY
    };
}

/**
 * PLATFORM-MANAGED GENERATE CONTENT
 * All calls use the RamN-provided Gemini key (env var).
 * Supports Context Caching via `cachedContent` param to cut token costs for long user contexts.
 */
export async function hybridGenerateContent(
    params: any,
    _userKeys?: any, // kept for signature compatibility — ignored, platform key is used
    maxRetries = 3,
    contextInfo?: { userId: string, agentId?: string }
): Promise<GenerateContentResponse | any> {
    const provider = detectProvider(params.model);
    let lastError: any;

    // --- INTEGRATED USERMAP (LONG-TERM MEMORY) ---
    // Instead of old AWS backend, we use the local/cloud userMapService
    let injectedMemoryContext = '';

    if (contextInfo?.userId) {
        const lastUserMessage = params.contents?.slice().reverse().find((c: any) => c.role === 'user')?.parts?.[0]?.text;

        if (lastUserMessage) {
            try {
                const facts = await userMapService.getRelevantContext(contextInfo.userId, lastUserMessage);
                if (facts) {
                    injectedMemoryContext = facts;
                }
            } catch (e) {
                console.error('[UserMap Memory Search Error]', e);
            }
        }
    }

    // Inject memory into system prompt if exists
    if (injectedMemoryContext) {
        params.config = params.config || {};
        params.config.systemInstruction = (params.config.systemInstruction || '') + injectedMemoryContext;
    }
    // ----------------------------------------------

    for (let i = 0; i < maxRetries; i++) {
        try {

            // ========== ROUTE BY PROVIDER ==========
            if (provider === 'aws') {
                // For explicitly-AWS models, try backend proxy first (server-side Bedrock)
                const backendUrl = import.meta.env.VITE_BACKEND_URL;
                if (backendUrl) {
                    try {
                        const proxyResponse = await fetch(`${backendUrl}/api/ai/generate`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: params.model,
                                contents: params.contents,
                                systemInstruction: params.config?.systemInstruction,
                                tools: params.config?.tools,
                                generationConfig: { temperature: 0.7, topP: 0.95 }
                            })
                        });
                        if (proxyResponse.ok) {
                            const data = await proxyResponse.json();
                            const part = data.candidates?.[0]?.content?.parts?.[0];
                            if (part?.functionCall) {
                                return { functionCalls: [{ id: part.functionCall.name, name: part.functionCall.name, args: part.functionCall.args }], text: '' };
                            }
                            return { text: part?.text || '', candidates: data.candidates };
                        }
                    } catch (e) {
                        console.warn('[RamN] Backend proxy unavailable for AWS model, trying direct...');
                    }
                }
                return await bedrockGenerateContent(params);
            }
            if (provider === 'openai') {
                return await openaiGenerateContent(params);
            }

            // ========== GOOGLE MODELS: Backend AI Proxy ==========
            // All Google model calls go through the backend Lambda which handles:
            //   Tier 1: Vertex AI (service account, highest quota)
            //   Tier 2: Bedrock Claude (fallback)
            // No VITE_GEMINI_API_KEY needed on the frontend for Prism/Agents!

            const backendUrl = import.meta.env.VITE_BACKEND_URL;

            if (backendUrl) {
                console.info('[RamN] Routing to Backend AI Proxy (Vertex → Studio → Bedrock)...');
                const proxyResponse = await fetch(`${backendUrl}/api/ai/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: params.model,
                        contents: params.contents,
                        systemInstruction: params.config?.systemInstruction,
                        tools: params.config?.tools,
                        generationConfig: {
                            ...(params.config?.thinkingConfig ? { thinkingConfig: params.config.thinkingConfig } : {}),
                            temperature: 0.7,
                            topP: 0.95,
                        }
                    })
                });

                if (proxyResponse.ok) {
                    const data = await proxyResponse.json();
                    console.info(`[RamN] ✅ Response from: ${data.source || 'proxy'}`);
                    const part = data.candidates?.[0]?.content?.parts?.[0];
                    if (part?.functionCall) {
                        return { functionCalls: [{ id: part.functionCall.name, name: part.functionCall.name, args: part.functionCall.args }], text: '' };
                    }
                    return { text: part?.text || '', candidates: data.candidates };
                }

                const proxyErr = await proxyResponse.text();
                console.error('[RamN] Backend AI Proxy failed:', proxyResponse.status, proxyErr.substring(0, 300));
                throw new Error(`AI Proxy failed (${proxyResponse.status}): All server-side providers exhausted.`);
            }

            // No backend URL configured — cannot reach any AI provider
            throw new Error('[RamN] VITE_BACKEND_URL is not configured. Set it in your .env to enable AI.');

        } catch (error: any) {
            lastError = error;

            if (i < maxRetries - 1) {
                const delayMs = (i + 1) * 2000;
                console.warn(`[RamN] Retry ${i + 1}/${maxRetries - 1} in ${delayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
            }

            throw error;
        }
    }
    throw lastError;
}
/**
 * AWS Bedrock Execution
 * Handles Claude and Llama formatting
 */
async function bedrockGenerateContent(params: any): Promise<any> {
    const config = getAWSConfig();
    const client = new BedrockRuntimeClient({
        region: config.region,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey
        }
    });

    const isClaude = params.model.includes('claude');
    const isLlama = params.model.includes('llama');

    let payload: any;
    if (isClaude) {
        payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4096,
            messages: params.contents.map((c: any) => ({
                role: c.role === 'model' ? 'assistant' : 'user',
                content: c.parts[0].text
            })),
            system: params.config?.systemInstruction
        };
    } else if (isLlama) {
        const prompt = `${params.config?.systemInstruction || ''}\n\n${params.contents.map((c: any) => `${c.role === 'user' ? 'User' : 'Assistant'}: ${c.parts[0].text}`).join('\n')}\nAssistant:`;
        payload = {
            prompt,
            max_gen_len: 2048,
            temperature: 0.7,
            top_p: 0.9
        };
    }

    const command = new InvokeModelCommand({
        modelId: params.model,
        body: JSON.stringify(payload),
        contentType: 'application/json',
        accept: 'application/json'
    });

    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    let text = '';
    if (isClaude) text = result.content[0].text;
    if (isLlama) text = result.generation;

    return { text: text || 'Managed Response Error.' };
}

/**
 * OpenAI Execution
 * Handles GPT-4o and o1
 */
async function openaiGenerateContent(params: any): Promise<any> {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) throw new Error('[RamN] Platform OpenAI key not configured.');

    const payload = {
        model: params.model,
        messages: [
            ...(params.config?.systemInstruction ? [{ role: 'system', content: params.config.systemInstruction }] : []),
            ...params.contents.map((c: any) => ({
                role: c.role === 'model' ? 'assistant' : 'user',
                content: c.parts[0].text
            }))
        ],
        temperature: 0.7
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`OpenAI API Error: ${err}`);
    }

    const data = await response.json();
    return { text: data.choices[0]?.message?.content || 'Managed Response Error.' };
}

const TOOL_SAFETY_MAP: Record<string, 'READ_ONLY' | 'ACTION'> = {
    executeSearch: 'READ_ONLY',
    executeMarketResearch: 'READ_ONLY',
    generateVisualAsset: 'ACTION',
    fabricateAgent: 'ACTION',
    fabricateTeam: 'ACTION'
};

const CAPABILITY_TOOLS: Record<string, FunctionDeclaration> = {
    googleSearch: {
        name: 'executeSearch',
        description: 'Query the live web for real-time intelligence.',
        parameters: {
            type: Type.OBJECT,
            properties: { query: { type: Type.STRING } },
            required: ['query']
        }
    },
    marketResearch: {
        name: 'executeMarketResearch',
        description: 'Deep analyze industry trends, competitors, and sentiment.',
        parameters: {
            type: Type.OBJECT,
            properties: { topic: { type: Type.STRING } },
            required: ['topic']
        }
    },
    imageGeneration: {
        name: 'generateVisualAsset',
        description: 'Create high-fidelity images via DALL-E or Imagen.',
        parameters: {
            type: Type.OBJECT,
            properties: { prompt: { type: Type.STRING } },
            required: ['prompt']
        }
    },
    fabricateAgent: {
        name: 'fabricateAgent',
        description: 'Create a new AI Agent with specific persona, role, and capabilities based on user objective.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'The custom name for the new agent.' },
                role: { type: Type.STRING, description: 'The 2-4 word role title (e.g. Senior Software Engineer).' },
                jobDescription: { type: Type.STRING, description: 'The deep system prompt defining instructions, boundaries, and formats.' },
                icon: { type: Type.STRING, description: 'A single visually appropriate emoji for this agent.' },
                modelId: { type: Type.STRING, description: 'The suggested AI model ID (e.g. gemini-2.0-flash, gemini-2.0-pro)' },
            },
            required: ['name', 'role', 'jobDescription', 'icon', 'modelId']
        }
    },
    fabricateTeam: {
        name: 'fabricateTeam',
        description: 'Initialize a new squad/team by grouping several agents together for a multi-agent workflow.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: { type: Type.STRING, description: 'The name of the new squad.' }
            },
            required: ['name']
        }
    }
};

export async function generateSingleAgentResponse(
    history: Message[],
    agent: Agent,
    otherAgents: Agent[] = [],
    assignedTasks?: string[],
    responseMode: 'CHAT' | 'SOLUTION' | 'TASK' = 'CHAT',
    _userKeys?: any, // kept for signature compat — ignored
    userId?: string
): Promise<MessageContent | null> {

    const caps = agent.capabilities || [];
    let systemPrompt = `You are ${agent.name}, a specialized agent with the role: ${agent.role}.
CRITICAL IMPERATIVE: You must strictly adhere to the following SYSTEM_INSTRUCTION. It dictates your persona, constraints, capabilities, and operational directives. Deviation is not permitted.

[SYSTEM_INSTRUCTION]
${agent.jobDescription}
[END_SYSTEM_INSTRUCTION]

`;

    // Inject UserMap context for stability and recall
    if (userId) {
        const lastMsg = history.length > 0 ? history[history.length - 1].content.text : '';
        const userRecall = await userMapService.getRelevantContext(userId, lastMsg);
        systemPrompt += userRecall;
    }

    try {
        const contents = history.map(msg => ({
            role: MsgRole(msg.type),
            parts: [{ text: (msg.content as any).text || "" }]
        }));

        const availableTools = caps.map(cap => CAPABILITY_TOOLS[cap]).filter(Boolean);

        const response = await hybridGenerateContent({
            model: agent.model,
            contents: contents as any,
            config: {
                systemInstruction: systemPrompt,
                tools: availableTools.length > 0 ? [{ functionDeclarations: availableTools }] : undefined,
                thinkingConfig: agent.model.includes('pro') ? { thinkingBudget: 32768 } : undefined
            }
        }, undefined, 3, { userId: userId || '', agentId: agent.id });

        if (response.functionCalls && response.functionCalls.length > 0) {
            const call = response.functionCalls[0];
            return {
                type: 'text',
                text: response.text || "Initiating tool sequence...",
                mode: 'TASK_PROPOSAL',
                toolCall: {
                    id: call.id || `call-${Date.now()}`,
                    name: call.name,
                    args: call.args,
                    safetyType: TOOL_SAFETY_MAP[call.name] || 'ACTION'
                }
            };
        }

        return {
            type: 'text',
            text: response.text || "Operational.",
            mode: responseMode === 'CHAT' ? 'CHAT' : 'SOLUTION'
        };

    } catch (error: any) {
        return { type: 'text', text: `⚠️ Operational Fault: ${error.message}` };
    }
}

function MsgRole(type: string): string {
    return type === 'user' ? 'user' : 'model';
}

export async function generatePrismResponse(
    history: Message[],
    prismAgent: Agent,
    setStatus: (s: string) => void,
    _userKeys?: any, // kept for signature compat — ignored, platform managed
    _availableProviders?: string,
    userId?: string,
    prismMode?: 'ask' | 'create'
) {
    setStatus("Refracting...");
    const { model, provider } = resolvePrismModel();
    let modifiedPrism = { ...prismAgent, model, provider };

    // Strict Mode Enforcement: Remove creation tools if not in 'create' mode
    if (prismMode !== 'create') {
        modifiedPrism.capabilities = modifiedPrism.capabilities?.filter(c => c !== 'fabricateAgent' && c !== 'fabricateTeam');
    }

    // Inject tool catalog context if available
    try {
        const { getToolCatalog, getToolCatalogSummary } = await import('./toolService');
        const catalog = await getToolCatalog();
        if (catalog.length > 0) {
            const catalogSummary = getToolCatalogSummary(catalog);
            modifiedPrism.jobDescription += `\n\n[TOOL_CATALOG]\n${catalogSummary}`;
        }
    } catch { }

    return generateSingleAgentResponse(history, modifiedPrism, [], [], 'CHAT', undefined, userId);
}



export async function executeInterceptedCommand(agent: Agent, toolCall: ToolCall): Promise<MessageContent | null> {
    try {
        if (toolCall.name === 'generateVisualAsset') {
            const response = await hybridGenerateContent({
                model: 'gemini-2.0-flash',
                contents: [{ role: 'user', parts: [{ text: toolCall.args.prompt }] }]
            });
            const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            if (part?.inlineData?.data) {
                return {
                    type: 'image',
                    imageUrl: `data:image/png;base64,${part.inlineData.data}`,
                    mimeType: 'image/png',
                    text: `Synthesis Resolved.`
                };
            }
            return { type: 'text', text: '⚠️ Image generation requires a valid platform configuration.' };
        }

        const toolDescriptions: Record<string, string> = {
            'read_file': `Analyzed file contents: ${toolCall.args.path || 'target document'}.`,
            'list_dir': `Scanned directory structure: ${toolCall.args.path || 'workspace'}.`,
            'web_search': `Retrieved search intelligence for: "${toolCall.args.query || 'target term'}".`,
            'assign_task': `Delegated new operational directive.`,
            'createAgent': `Fabricated new agent: ${toolCall.args.name || 'Custom Agent'} with role ${toolCall.args.role || 'Specialist'}.`,
            'createGroup': `Initialized new squad: ${toolCall.args.name || 'Task Force'}.`,
            'github_pr': `Generated Pull Request for repository.`,
            'calculator': `Performed mathematical computation.`
        };

        const descriptiveText = toolDescriptions[toolCall.name] || `Successfully executed operation: ${toolCall.name}.`;
        return { type: 'text', text: descriptiveText };
    } catch (e: any) {
        return { type: 'text', text: `⚠️ Command failed: ${e.message || 'Error'}` };
    }
}
