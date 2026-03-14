/**
 * RamN AI — API V2 Service
 * 
 * Frontend client for the new v2 backend endpoints.
 * All agent logic lives on the backend — this file only transports data.
 */

import type { RuntimeAttachment } from './runtimeAttachments';

const API_BASE = import.meta.env.VITE_BACKEND_URL || '';
const PRISM_STREAM_URL = import.meta.env.VITE_PRISM_STREAM_URL || `${API_BASE}/api/v2/prism/chat/stream`;
const AGENT_STREAM_URL = import.meta.env.VITE_AGENT_STREAM_URL || '';
const IS_DEV = import.meta.env.DEV;

// ─── Auth Helper ─────────────────────────────────────────────

function getAuthToken(): string {
    // We need the ID token so the backend validateToken verifier can extract the user's email and details securely.
    const token = sessionStorage.getItem('id_token')
        || sessionStorage.getItem('auth_token')
        || localStorage.getItem('id_token')
        || localStorage.getItem('auth_token');
    if (!token) throw new Error('Not authenticated. Please log in.');
    return token;
}

function getUserId(): string {
    const raw = sessionStorage.getItem('currentUser') || localStorage.getItem('currentUser');
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
    if (IS_DEV) console.log(`API: ${method} ${path}`);

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
            if (IS_DEV) console.warn('API: ⚠️ Unauthorized token detected. Forcing logout clearing state...');
            sessionStorage.removeItem('auth_token');
            sessionStorage.removeItem('id_token');
            sessionStorage.removeItem('currentUser');
            localStorage.removeItem('auth_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('currentUser');
            window.location.reload();
            return {} as T; // Return empty to prevent downstream crashes during reload
        }

        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        const finalMessage = `${error}${detail}`;

        if (IS_DEV) console.error(`API: ❌ ${method} ${path} → ${response.status}: ${finalMessage}`);
        throw new Error(finalMessage);
    }

    const data = await response.json();
    if (IS_DEV) console.log(`API: ✅ ${method} ${path} → 200`);
    return data as T;
}

async function apiDeleteRequest<T>(path: string): Promise<T> {
    const url = `${API_BASE}${path}`;
    if (IS_DEV) console.log(`API: DELETE ${path}`);

    const token = getAuthToken();
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        throw new Error(`${error}${detail}`);
    }

    return await response.json() as T;
}

export interface StreamEvent<TPayload = any> {
    type?: string;
    phase?: string;
    delta?: string;
    payload?: TPayload;
    error?: string;
    message?: string;
    tool?: any;
    preview?: string;
}

async function readEventStream<TPayload>(
    response: Response,
    onEvent?: (event: StreamEvent<TPayload>) => void
): Promise<TPayload> {
    if (!response.body) {
        return await response.json() as TPayload;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalPayload: TPayload | null = null;
    let streamError: Error | null = null;

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() || '';

        for (const chunk of chunks) {
            const lines = chunk
                .split('\n')
                .map((line) => line.trim())
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trim())
                .filter(Boolean);

            if (lines.length === 0) continue;

            try {
                const event = JSON.parse(lines.join('\n')) as StreamEvent<TPayload>;
                onEvent?.(event);
                if (event?.type === 'final' && event.payload) {
                    finalPayload = event.payload;
                }
                if (event?.type === 'error') {
                    streamError = new Error(event.message || event.error || 'Streaming request failed');
                }
            } catch {
                // Ignore malformed chunk and continue parsing stream.
            }
        }
    }

    if (streamError) throw streamError;
    if (finalPayload) return finalPayload;
    throw new Error('Stream ended without final payload');
}

// ═══════════════════════════════════════════════════════════════
//  Prism Chat (Meta Agent Brain)
// ═══════════════════════════════════════════════════════════════

export interface PrismChatRequest {
    message: string;
    mode: 'ask' | 'route' | 'create';
    conversationId?: string;
    attachments?: RuntimeAttachment[];
    focusDocumentIds?: string[];
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
            attachments: params.attachments || [],
            focusDocumentIds: params.focusDocumentIds || [],
            ...(params.specialAgentContext ? { specialAgentContext: params.specialAgentContext } : {})
        });
    } catch (error: any) {
        console.error('API: prismChat failed:', error.message);
        throw error;
    }
}

export async function prismChatStream(
    params: PrismChatRequest,
    onEvent?: (event: StreamEvent<PrismChatResponse>) => void
): Promise<PrismChatResponse> {
    const token = getAuthToken();
    const response = await fetch(PRISM_STREAM_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            userId: getUserId(),
            message: params.message,
            mode: params.mode,
            conversationId: params.conversationId || null,
            attachments: params.attachments || [],
            focusDocumentIds: params.focusDocumentIds || [],
            ...(params.specialAgentContext ? { specialAgentContext: params.specialAgentContext } : {})
        })
    });

    if (!response.ok) {
        if ((response.headers.get('content-type') || '').includes('text/event-stream')) {
            await readEventStream<PrismChatResponse>(response, onEvent);
        }
        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        throw new Error(`${error}${detail}`);
    }

    return readEventStream<PrismChatResponse>(response, onEvent);
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
    attachments?: RuntimeAttachment[];
    focusDocumentIds?: string[];
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
            conversationId: params.conversationId || null,
            attachments: params.attachments || [],
            focusDocumentIds: params.focusDocumentIds || []
        });
    } catch (error: any) {
        console.error('API: agentChat failed:', error.message);
        throw error;
    }
}

export async function agentChatStream(
    params: AgentChatRequest,
    onEvent?: (event: StreamEvent<AgentChatResponse>) => void
): Promise<AgentChatResponse> {
    const token = getAuthToken();
    const streamUrl = AGENT_STREAM_URL || `${API_BASE}/api/v2/agents/${encodeURIComponent(params.agentId)}/chat/stream`;
    const response = await fetch(streamUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            agentId: params.agentId,
            userId: getUserId(),
            message: params.message,
            conversationId: params.conversationId || null,
            attachments: params.attachments || [],
            focusDocumentIds: params.focusDocumentIds || []
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        throw new Error(`${error}${detail}`);
    }

    return readEventStream<AgentChatResponse>(response, onEvent);
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

export interface DeleteAgentResponse {
    success: boolean;
    agentId: string;
}

export async function deleteAgent(agentId: string): Promise<DeleteAgentResponse> {
    try {
        return await apiDeleteRequest<DeleteAgentResponse>(`/api/v2/agents/${encodeURIComponent(agentId)}`);
    } catch (error: any) {
        console.error('API: deleteAgent failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Teams
// ═══════════════════════════════════════════════════════════════

export interface TeamRecord {
    teamId: string;
    userId: string;
    name: string;
    description?: string;
    agentIds: string[];
    status?: string;
}

export interface ListTeamsResponse {
    teams: TeamRecord[];
}

export interface UpsertTeamRequest {
    teamId?: string;
    name: string;
    description?: string;
    agentIds: string[];
}

export interface UpsertTeamResponse {
    team: TeamRecord;
}

export interface FabricateTeamSpecialist {
    name: string;
    role: string;
    description?: string;
    jobDescription?: string;
    icon?: string;
    capabilities?: string[];
    toolIds?: string[];
    tools?: string[];
    modelId?: string;
}

export interface FabricateTeamRequest {
    teamName: string;
    objective: string;
    specialists: FabricateTeamSpecialist[];
}

export interface FabricateTeamResponse {
    team: TeamRecord;
    agents: Array<{
        agentId: string;
        name: string;
        role: string;
        icon: string;
        modelId: string;
        toolIds: string[];
        status: string;
        blueprint: any;
    }>;
    message: string;
}

export async function listTeams(): Promise<ListTeamsResponse> {
    try {
        return await apiRequest<ListTeamsResponse>('GET', '/api/v2/teams');
    } catch (error: any) {
        console.error('API: listTeams failed:', error.message);
        throw error;
    }
}

export async function upsertTeam(params: UpsertTeamRequest): Promise<UpsertTeamResponse> {
    try {
        return await apiRequest<UpsertTeamResponse>('POST', '/api/v2/teams', {
            teamId: params.teamId || null,
            name: params.name,
            description: params.description || '',
            agentIds: Array.isArray(params.agentIds) ? params.agentIds : []
        });
    } catch (error: any) {
        console.error('API: upsertTeam failed:', error.message);
        throw error;
    }
}

export async function deleteTeamApi(teamId: string): Promise<{ success: boolean; teamId: string }> {
    try {
        return await apiDeleteRequest<{ success: boolean; teamId: string }>(`/api/v2/teams/${encodeURIComponent(teamId)}`);
    } catch (error: any) {
        console.error('API: deleteTeam failed:', error.message);
        throw error;
    }
}

export async function fabricateTeam(params: FabricateTeamRequest): Promise<FabricateTeamResponse> {
    try {
        return await apiRequest<FabricateTeamResponse>('POST', '/api/v2/teams/fabricate', {
            teamName: params.teamName,
            objective: params.objective,
            specialists: params.specialists
        });
    } catch (error: any) {
        console.error('API: fabricateTeam failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Special Agents (Templates from DynamoDB)
// ═══════════════════════════════════════════════════════════════

export interface SpecialAgentTemplate {
    id?: string;
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
//  Model & Tool Registries
// ═══════════════════════════════════════════════════════════════

export interface ModelRegistryItem {
    modelId: string;
    name?: string;
    provider?: string;
    version?: string;
    icon?: string;
    tagline?: string;
    status?: string;
}

export interface ListModelsResponse {
    models: ModelRegistryItem[];
}

export async function listModels(): Promise<ListModelsResponse> {
    try {
        return await apiRequest<ListModelsResponse>('GET', '/api/v2/models');
    } catch (error: any) {
        console.error('API: listModels failed:', error.message);
        throw error;
    }
}

export interface ToolRegistryItem {
    toolId: string;
    name?: string;
    icon?: string;
    category?: string;
    description?: string;
    summary?: string;
    behavior?: string;
    status?: string;
}

export interface ListToolsResponse {
    tools: ToolRegistryItem[];
}

export async function listTools(): Promise<ListToolsResponse> {
    try {
        return await apiRequest<ListToolsResponse>('GET', '/api/v2/tools');
    } catch (error: any) {
        console.error('API: listTools failed:', error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════
//  Documents Registry
// ═══════════════════════════════════════════════════════════════

export interface DocumentRecord {
    docId: string;
    userId: string;
    ownerType: 'agent' | 'user';
    ownerId: string;
    fileName: string;
    fileKey: string;
    fileUrl?: string | null;
    textKey?: string | null;
    textUrl?: string | null;
    contentType?: string;
    size?: number;
    createdAt?: string;
    updatedAt?: string;
}

export interface RegisterDocumentRequest {
    ownerType: 'agent' | 'user';
    ownerId: string;
    fileName: string;
    fileKey: string;
    fileUrl?: string;
    textKey?: string;
    textUrl?: string;
    contentType?: string;
    size?: number;
}

export async function registerDocument(params: RegisterDocumentRequest): Promise<{ document: DocumentRecord }> {
    return apiRequest<{ document: DocumentRecord }>('POST', '/api/v2/documents/register', params);
}

export async function listDocuments(ownerType: 'agent' | 'user', ownerId: string): Promise<{ documents: DocumentRecord[] }> {
    return apiRequest<{ documents: DocumentRecord[] }>(
        'GET',
        `/api/v2/documents?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`
    );
}

export async function deleteDocument(docId: string): Promise<{ success: boolean; docId: string }> {
    return apiDeleteRequest<{ success: boolean; docId: string }>(`/api/v2/documents/${encodeURIComponent(docId)}`);
}

// ═══════════════════════════════════════════════════════════════
//  UserMap and Memory
// ═══════════════════════════════════════════════════════════════

export interface ConsolidateUserMapRequest {
    memories: string[];
    existingTree?: any;
}

export interface UserMapTreeResponse {
    userId: string;
    tree: any;
    updatedAt?: string | null;
}

export interface SaveUserMapResponse {
    success: boolean;
    userId: string;
    updatedAt?: string | null;
}

export async function getUserMapTree(): Promise<UserMapTreeResponse> {
    try {
        return await apiRequest<UserMapTreeResponse>('GET', '/api/v2/usermap');
    } catch (error: any) {
        console.error('API: getUserMapTree failed:', error.message);
        throw error;
    }
}

export async function saveUserMapTree(tree: any, expectedUpdatedAt?: string | null): Promise<SaveUserMapResponse> {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/api/v2/usermap`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tree, expectedUpdatedAt: expectedUpdatedAt || null })
    });

    if (response.status === 409) {
        const conflict = await response.json().catch(() => ({}));
        const err: any = new Error(conflict.message || 'UserMap conflict');
        err.code = 'CONFLICT';
        err.currentTree = conflict.currentTree || null;
        err.currentUpdatedAt = conflict.currentUpdatedAt || null;
        throw err;
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        throw new Error(`${error}${detail}`);
    }

    return await response.json() as SaveUserMapResponse;
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

export interface MemoryRecord {
    id: string;
    userId: string;
    agentId?: string | null;
    content: string;
    category?: string;
    createdAt?: string;
}

export async function listMemories(limit: number = 300): Promise<{ memories: MemoryRecord[]; count: number }> {
    const token = getAuthToken();
    const response = await fetch(`${API_BASE}/api/memory/list?limit=${encodeURIComponent(String(limit))}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText, message: '' }));
        const error = errorData.error || `Request failed: ${response.status}`;
        const detail = errorData.message ? ` — ${errorData.message}` : '';
        throw new Error(`${error}${detail}`);
    }

    return await response.json() as { memories: MemoryRecord[]; count: number };
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
