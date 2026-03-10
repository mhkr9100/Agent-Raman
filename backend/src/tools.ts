import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const corsHeaders = {
    'Access-Control-Allow-Origin': process.env.CORS_ALLOW_ORIGIN || 'https://www.ramnai.com',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json'
};

// Load tool catalog
let catalog: any[] = [];
try {
    const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'toolCatalog.json');
    catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
} catch {
    console.warn('Could not load toolCatalog.json');
}

/**
 * GET /api/tools — Return the full tool catalog
 * Optional query: ?category=Finance&q=crypto
 */
export const listHandler: APIGatewayProxyHandlerV2 = async (event) => {
    const params = event.queryStringParameters || {};
    let filtered = [...catalog];

    if (params.category) {
        filtered = filtered.filter(t => t.category.toLowerCase() === params.category!.toLowerCase());
    }
    if (params.q) {
        const q = params.q.toLowerCase();
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.category.toLowerCase().includes(q)
        );
    }

    return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ total: filtered.length, tools: filtered })
    };
};

/**
 * POST /api/tools/execute — Execute a tool call on behalf of an agent
 * Body: { toolId, endpoint, params, headers? }
 */
export const executeHandler: APIGatewayProxyHandlerV2 = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { toolId, endpoint, params = {}, headers = {} } = body;

        // Find the tool
        const tool = catalog.find(t => t.id === toolId);
        if (!tool) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: `Tool not found: ${toolId}` }) };
        }

        // Find the endpoint
        const ep = tool.endpoints.find((e: any) => e.name === endpoint);
        if (!ep) {
            return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: `Endpoint not found: ${endpoint}` }) };
        }

        // Build URL
        let url = `${tool.baseUrl}${ep.path}`;
        const queryParams = new URLSearchParams();
        if (ep.method === 'GET') {
            for (const [key, value] of Object.entries(params)) {
                queryParams.append(key, String(value));
            }
            if (queryParams.toString()) url += `?${queryParams.toString()}`;
        }

        const fetchOptions: RequestInit = {
            method: ep.method,
            headers: { 'Content-Type': 'application/json', ...headers }
        };
        if (ep.method !== 'GET' && Object.keys(params).length > 0) {
            fetchOptions.body = JSON.stringify(params);
        }

        const response = await fetch(url, fetchOptions);
        const responseText = await response.text();

        let data: any;
        try { data = JSON.parse(responseText); } catch { data = { text: responseText }; }

        return {
            statusCode: response.status,
            headers: corsHeaders,
            body: JSON.stringify({ toolId, endpoint, status: response.status, data })
        };

    } catch (error: any) {
        return {
            statusCode: 500,
            headers: corsHeaders,
            body: JSON.stringify({ error: error.message || 'Tool execution failed' })
        };
    }
};
