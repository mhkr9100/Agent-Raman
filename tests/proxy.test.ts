import { describe, it, expect } from 'vitest';

/**
 * Integration Tests for Server Proxy Logic
 * Tests provider detection, message format translation, and error handling.
 * 
 * Note: These test the LOGIC extracted from server.ts, not the live HTTP endpoints.
 * For live testing, run the dev server and use real API keys.
 */

// ==========================================
// Provider Detection Logic (extracted from server.ts)
// ==========================================
function detectProvider(model: string): string {
    if (model.includes('gemini') || model.includes('learnlm')) return 'google';
    if (model.includes('gpt') || model.includes('o1') || model.includes('o3')) return 'openai';
    if (model.includes('claude')) return 'anthropic';
    return 'openrouter';
}

describe('Provider Detection', () => {
    it('detects Google Gemini models', () => {
        expect(detectProvider('gemini-3.0-flash')).toBe('google');
        expect(detectProvider('gemini-3-pro')).toBe('google');
        expect(detectProvider('gemini-3.0-flash-8b')).toBe('google');
        expect(detectProvider('learnlm-1.5-pro-experimental')).toBe('google');
    });

    it('detects OpenAI models', () => {
        expect(detectProvider('gpt-4o')).toBe('openai');
        expect(detectProvider('gpt-4-turbo')).toBe('openai');
        expect(detectProvider('o1-preview')).toBe('openai');
        expect(detectProvider('o3-mini')).toBe('openai');
    });

    it('detects Anthropic models', () => {
        expect(detectProvider('claude-3-opus-20240229')).toBe('anthropic');
        expect(detectProvider('claude-3.5-sonnet-20241022')).toBe('anthropic');
        expect(detectProvider('claude-3-haiku-20240307')).toBe('anthropic');
    });

    it('falls back to OpenRouter for unknown models', () => {
        expect(detectProvider('mistral-large-latest')).toBe('openrouter');
        expect(detectProvider('llama-3.1-405b')).toBe('openrouter');
        expect(detectProvider('some-unknown-model')).toBe('openrouter');
    });
});

// ==========================================
// Message Format Translation (Gemini → OpenAI format)
// ==========================================
function translateGeminiToOpenAI(contents: any[], systemInstruction?: string): any[] {
    const messages: any[] = [];
    if (systemInstruction) {
        messages.push({ role: 'system', content: systemInstruction });
    }

    for (const c of (contents || [])) {
        if (c.role === 'user' && c.parts?.[0]?.functionResponse) {
            messages.push({
                role: 'tool',
                tool_call_id: c.parts[0].functionResponse.name,
                content: JSON.stringify(c.parts[0].functionResponse.response)
            });
        } else if (c.role === 'model' && c.parts?.[0]?.functionCall) {
            messages.push({
                role: 'assistant',
                tool_calls: [{
                    id: c.parts[0].functionCall.name,
                    type: 'function',
                    function: {
                        name: c.parts[0].functionCall.name,
                        arguments: JSON.stringify(c.parts[0].functionCall.args)
                    }
                }]
            });
        } else {
            messages.push({
                role: c.role === 'model' ? 'assistant' : 'user',
                content: c.parts[0]?.text || ""
            });
        }
    }
    return messages;
}

describe('Message Format Translation (Gemini → OpenAI)', () => {
    it('converts simple user/model messages', () => {
        const contents = [
            { role: 'user', parts: [{ text: 'Hello' }] },
            { role: 'model', parts: [{ text: 'Hi there!' }] }
        ];
        const result = translateGeminiToOpenAI(contents);
        expect(result).toEqual([
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' }
        ]);
    });

    it('prepends system instruction', () => {
        const contents = [{ role: 'user', parts: [{ text: 'Test' }] }];
        const result = translateGeminiToOpenAI(contents, 'You are a helpful assistant.');
        expect(result[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' });
        expect(result[1]).toEqual({ role: 'user', content: 'Test' });
    });

    it('translates function calls from model to assistant tool_calls', () => {
        const contents = [{
            role: 'model',
            parts: [{ functionCall: { name: 'executeSearch', args: { query: 'test' } } }]
        }];
        const result = translateGeminiToOpenAI(contents);
        expect(result[0].role).toBe('assistant');
        expect(result[0].tool_calls[0].function.name).toBe('executeSearch');
        expect(JSON.parse(result[0].tool_calls[0].function.arguments)).toEqual({ query: 'test' });
    });

    it('translates function responses from user to tool messages', () => {
        const contents = [{
            role: 'user',
            parts: [{ functionResponse: { name: 'executeSearch', response: { result: 'Search results...' } } }]
        }];
        const result = translateGeminiToOpenAI(contents);
        expect(result[0].role).toBe('tool');
        expect(result[0].tool_call_id).toBe('executeSearch');
    });

    it('handles empty parts gracefully', () => {
        const contents = [{ role: 'user', parts: [{}] }];
        const result = translateGeminiToOpenAI(contents);
        expect(result[0].content).toBe('');
    });
});

// ==========================================
// Message Format Translation (Gemini → Anthropic format)
// ==========================================
function translateGeminiToAnthropic(contents: any[]): any[] {
    const messages: any[] = [];
    for (const c of (contents || [])) {
        if (c.role === 'user' && c.parts?.[0]?.functionResponse) {
            messages.push({
                role: 'user',
                content: [{
                    type: 'tool_result',
                    tool_use_id: c.parts[0].functionResponse.name,
                    content: JSON.stringify(c.parts[0].functionResponse.response)
                }]
            });
        } else if (c.role === 'model' && c.parts?.[0]?.functionCall) {
            messages.push({
                role: 'assistant',
                content: [{
                    type: 'tool_use',
                    id: c.parts[0].functionCall.name,
                    name: c.parts[0].functionCall.name,
                    input: c.parts[0].functionCall.args
                }]
            });
        } else {
            messages.push({
                role: c.role === 'model' ? 'assistant' : 'user',
                content: c.parts[0]?.text || ""
            });
        }
    }
    return messages;
}

describe('Message Format Translation (Gemini → Anthropic)', () => {
    it('maps model role to assistant', () => {
        const contents = [{ role: 'model', parts: [{ text: 'Response' }] }];
        const result = translateGeminiToAnthropic(contents);
        expect(result[0].role).toBe('assistant');
    });

    it('translates tool_use blocks correctly', () => {
        const contents = [{
            role: 'model',
            parts: [{ functionCall: { name: 'fabricateAgent', args: { name: 'TestBot' } } }]
        }];
        const result = translateGeminiToAnthropic(contents);
        expect(result[0].content[0].type).toBe('tool_use');
        expect(result[0].content[0].input).toEqual({ name: 'TestBot' });
    });

    it('translates tool_result blocks correctly', () => {
        const contents = [{
            role: 'user',
            parts: [{ functionResponse: { name: 'fabricateAgent', response: { success: true } } }]
        }];
        const result = translateGeminiToAnthropic(contents);
        expect(result[0].content[0].type).toBe('tool_result');
        expect(result[0].content[0].tool_use_id).toBe('fabricateAgent');
    });
});

// ==========================================
// Tool Declaration Translation
// ==========================================
function translateToolsToOpenAI(geminiTools: any[]): any[] {
    if (!geminiTools?.[0]?.functionDeclarations) return [];
    return geminiTools[0].functionDeclarations.map((t: any) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
    }));
}

function translateToolsToAnthropic(geminiTools: any[]): any[] {
    if (!geminiTools?.[0]?.functionDeclarations) return [];
    return geminiTools[0].functionDeclarations.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
    }));
}

describe('Tool Declaration Translation', () => {
    const geminiTools = [{
        functionDeclarations: [{
            name: 'executeSearch',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
        }]
    }];

    it('translates to OpenAI tool format', () => {
        const result = translateToolsToOpenAI(geminiTools);
        expect(result[0].type).toBe('function');
        expect(result[0].function.name).toBe('executeSearch');
    });

    it('translates to Anthropic tool format', () => {
        const result = translateToolsToAnthropic(geminiTools);
        expect(result[0].name).toBe('executeSearch');
        expect(result[0].input_schema).toBeDefined();
    });

    it('returns empty array for no tools', () => {
        expect(translateToolsToOpenAI([])).toEqual([]);
        expect(translateToolsToAnthropic([])).toEqual([]);
    });
});
