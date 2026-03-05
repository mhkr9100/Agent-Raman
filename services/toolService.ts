/**
 * Tool Service — Frontend client for the RamN AI Backend
 * Handles tool catalog fetching and tool execution via Lambda.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

export interface ToolEndpoint {
  name: string;
  method: string;
  path: string;
  params: { name: string; type: string; required: boolean; desc: string }[];
}

export interface ToolEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  provider: string;
  authType: string;
  baseUrl: string;
  cors: boolean;
  endpoints: ToolEndpoint[];
}

let cachedCatalog: ToolEntry[] | null = null;

/**
 * Fetch the tool catalog from backend (cached after first call)
 */
export async function getToolCatalog(category?: string): Promise<ToolEntry[]> {
  // If no backend URL, use embedded catalog
  if (!BACKEND_URL) {
    return getEmbeddedCatalog(category);
  }

  if (cachedCatalog && !category) return cachedCatalog;

  try {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    const res = await fetch(`${BACKEND_URL}/api/v2/tools${params.toString() ? '?' + params.toString() : ''}`);
    if (!res.ok) throw new Error('Failed to fetch tool catalog');
    const data = await res.json();
    if (!category) cachedCatalog = data.tools;
    return data.tools;
  } catch {
    return getEmbeddedCatalog(category);
  }
}

/**
 * Execute a tool call via the backend proxy
 */
export async function executeTool(toolId: string, endpoint: string, params: Record<string, any>, headers?: Record<string, string>): Promise<any> {
  if (BACKEND_URL) {
    const res = await fetch(`${BACKEND_URL}/api/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolId, endpoint, params, headers })
    });
    if (!res.ok) throw new Error(`Tool execution failed: ${res.status}`);
    return (await res.json()).data;
  }

  // Client-side fallback for CORS-friendly tools
  return executeToolDirect(toolId, endpoint, params, headers);
}

/**
 * Direct client-side tool execution (for CORS-friendly APIs)
 */
async function executeToolDirect(toolId: string, endpointName: string, params: Record<string, any>, headers?: Record<string, string>): Promise<any> {
  const catalog = await getEmbeddedCatalog();
  const tool = catalog.find(t => t.id === toolId);
  if (!tool) throw new Error(`Tool not found: ${toolId}`);

  const ep = tool.endpoints.find(e => e.name === endpointName);
  if (!ep) throw new Error(`Endpoint not found: ${endpointName}`);

  let url = `${tool.baseUrl}${ep.path}`;
  // Replace path params like {id}
  for (const [key, value] of Object.entries(params)) {
    url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  if (ep.method === 'GET') {
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (!ep.path.includes(`{${key}}`)) {
        queryParams.append(key, String(value));
      }
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
  return response.json();
}

/**
 * Embedded catalog summary (for Prism context injection — lightweight)
 */
export function getToolCatalogSummary(catalog: ToolEntry[]): string {
  const byCategory: Record<string, ToolEntry[]> = {};
  for (const tool of catalog) {
    if (!byCategory[tool.category]) byCategory[tool.category] = [];
    byCategory[tool.category].push(tool);
  }

  let summary = '[AVAILABLE TOOLS CATALOG]\n';
  for (const [category, tools] of Object.entries(byCategory)) {
    summary += `\n## ${category}\n`;
    for (const tool of tools) {
      const endpoints = tool.endpoints.map(e => e.name).join(', ');
      summary += `- ${tool.id}: ${tool.name} — ${tool.description} [Endpoints: ${endpoints}]\n`;
    }
  }
  return summary;
}

// Embedded catalog — loaded from public/toolCatalog.json
let embeddedCatalogCache: ToolEntry[] | null = null;

async function getEmbeddedCatalog(category?: string): Promise<ToolEntry[]> {
  if (!embeddedCatalogCache) {
    try {
      const res = await fetch('/toolCatalog.json');
      if (res.ok) {
        embeddedCatalogCache = await res.json();
      } else {
        embeddedCatalogCache = [];
      }
    } catch {
      embeddedCatalogCache = [];
    }
  }
  if (category) {
    return (embeddedCatalogCache || []).filter(t => t.category.toLowerCase() === category.toLowerCase());
  }
  return embeddedCatalogCache || [];
}
