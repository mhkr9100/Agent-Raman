/**
 * RamN AI — API V2 Service
 * 
 * Frontend client for the new v2 backend endpoints.
 * All agent logic lives on the backend — this file only transports data.
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL || '';

// ─── Auth Helper ─────────────────────────────────────────────

function getAuthToken(): string {
    // We need the ID token so the backend validateToken verifier can extract the user's email and details securely.
    const token = localStorage.getItem('id_token') || localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated. Please log in.');
    return token;
}

function getUserId(): string {
    const raw = localStorage.getItem('currentUser');
    if (!raw) throw new Error('No user session. Please log in.');
    const user = JSON.parse(raw);
    return user.id;
}

// ─── Request Helper ──────────────────────────────────────────

async function apiRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: object
): Promise<T> {
    const url = `${API_BASE}${path}`;
    console.log(`API: ${method} ${path}`);

    const token = getAuthToken();

    const options: RequestInit = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };

    if (body && method === 'POST') {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            console.warn('API: ⚠️ Unauthorized token detected. Forcing logout clearing state...');
            localStorage.removeItem('auth_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('currentUser');
            window.location.reload();
            return {} as T; // Return empty to prevent downstream crashes during reload
        }

        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        const message = errorData.error || errorData.message || `Request failed: ${response.status}`;
        console.error(`API: ❌ ${method} ${path} → ${response.status}: ${message}`);
        throw new Error(message);
    }

    const data = await response.json();
    console.log(`API: ✅ ${method} ${path} → 200`);
    return data as T;
}

// ═══════════════════════════════════════════════════════════════
//  Prism Chat (Meta Agent Brain)
// ═══════════════════════════════════════════════════════════════

export interface PrismChatRequest {
    message: string;
    mode: 'ask' | 'route' | 'create';
    conversationId?: string;
    specialAgentContext?: {
        name: string;
        role: string;
        predefinedPrompt: string;
        defaultTools: string[];
        suggestedModel: string;
    };
}

export interface PrismChatResponse {
    text: string;
    toolCall?: any;
    conversationId: string;
    mode: string;
    suggestMode?: boolean;
    recommendation?: object;
}

export async function prismChat(params: PrismChatRequest): Promise<PrismChatResponse> {
    try {
        return await apiRequest<PrismChatResponse>('POST', '/api/v2/prism/chat', {
            userId: getUserId(),
            message: params.message,
            mode: params.mode,
            conversationId: params.conversationId || null,
            ...(params.specialAgentContext ? { specialAgentContext: params.specialAgentContext } : {})
        });
    } catch (error: any) {
        console.error('API: prismChat failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Agent Create (Save Approved Blueprint)
// ═══════════════════════════════════════════════════════════════

export interface CreateAgentResponse {
    agentId: string;
    name: string;
    status: string;
    message: string;
}

export async function createAgent(blueprint: object): Promise<CreateAgentResponse> {
    try {
        return await apiRequest<CreateAgentResponse>('POST', '/api/v2/agents/create', {
            userId: getUserId(),
            blueprint
        });
    } catch (error: any) {
        console.error('API: createAgent failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Agent Chat (Run a Created Agent)
// ═══════════════════════════════════════════════════════════════

export interface AgentChatRequest {
    agentId: string;
    message: string;
    conversationId?: string;
}

export interface AgentChatResponse {
    response: string;
    conversationId: string;
    agentId: string;
    agentName: string;
}

export async function agentChat(params: AgentChatRequest): Promise<AgentChatResponse> {
    try {
        return await apiRequest<AgentChatResponse>('POST', `/api/v2/agents/${params.agentId}/chat`, {
            agentId: params.agentId,
            userId: getUserId(),
            message: params.message,
            conversationId: params.conversationId || null
        });
    } catch (error: any) {
        console.error('API: agentChat failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  List User's Agents
// ═══════════════════════════════════════════════════════════════

export interface AgentListItem {
    agentId: string;
    name: string;
    description: string;
    status: string;
}

export interface ListAgentsResponse {
    agents: AgentListItem[];
}

export async function listAgents(): Promise<ListAgentsResponse> {
    try {
        const userId = getUserId();
        return await apiRequest<ListAgentsResponse>('GET', `/api/v2/agents?userId=${encodeURIComponent(userId)}`);
    } catch (error: any) {
        console.error('API: listAgents failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Special Agents (Templates from DynamoDB)
// ═══════════════════════════════════════════════════════════════

export interface SpecialAgentTemplate {
    templateId: string;
    name: string;
    role: string;
    icon: string;
    description: string;
    predefinedPrompt: string;
    defaultTools: string[];
    suggestedModel: string;
}

export interface ListSpecialAgentsResponse {
    templates: SpecialAgentTemplate[];
}

export async function listSpecialAgents(): Promise<ListSpecialAgentsResponse> {
    try {
        return await apiRequest<ListSpecialAgentsResponse>('GET', '/api/v2/special-agents');
    } catch (error: any) {
        console.error('API: listSpecialAgents failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  UserMap and Memory
// ═══════════════════════════════════════════════════════════════

export interface ConsolidateUserMapRequest {
    memories: string[];
    existingTree?: any;
}

export async function consolidateUserMap(params: ConsolidateUserMapRequest): Promise<any> {
    try {
        return await apiRequest<any>('POST', '/api/v2/usermap/consolidate', {
            userId: getUserId(),
            memories: params.memories,
            existingTree: params.existingTree || null
        });
    } catch (error: any) {
        console.error('API: consolidateUserMap failed:', error.message);
        throw error;
    }
}

export interface ExtractMemoryRequest {
    messages: Array<{ role: string; content: string }>;
}

export async function extractMemory(params: ExtractMemoryRequest): Promise<{ facts: string[] }> {
    try {
        return await apiRequest<{ facts: string[] }>('POST', '/api/v2/memory/extract', {
            userId: getUserId(),
            messages: params.messages
        });
    } catch (error: any) {
        console.error('API: extractMemory failed:', error.message);
        throw error;
    }
}
