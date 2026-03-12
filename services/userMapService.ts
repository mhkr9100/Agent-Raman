/**
 * UserMapService: Cloud-backed context retrieval helper.
 * Local storage is not used as an authoritative source.
 */

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

function getAuthToken(): string | null {
    return sessionStorage.getItem('auth_token')
        || sessionStorage.getItem('id_token')
        || localStorage.getItem('auth_token')
        || localStorage.getItem('id_token');
}

export interface UserContextItem {
    id: string;
    userId: string;
    content: string;
    category: 'profile' | 'preference' | 'task_history' | 'technical_spec' | 'general';
    timestamp: number;
    embedding?: number[];
}

class UserMapService {
    private static instance: UserMapService;
    private lastSearchCache: Map<string, { result: string; timestamp: number }> = new Map();
    private CACHE_TTL_MS = 60_000;

    public static getInstance() {
        if (!UserMapService.instance) {
            UserMapService.instance = new UserMapService();
        }
        return UserMapService.instance;
    }

    async recordContext(_userId: string, content: string, category: UserContextItem['category']) {
        if (!BACKEND_URL) {
            throw new Error('UserMap backend is not configured.');
        }

        const token = getAuthToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${BACKEND_URL}/api/memory/add`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ content, category })
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(body || `memory/add failed (${response.status})`);
        }
    }

    async getRelevantContext(userId: string, query: string, limit = 5): Promise<string> {
        if (!BACKEND_URL) return '';

        const cacheKey = `${userId}:${query.substring(0, 100)}`;
        const cached = this.lastSearchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            return cached.result;
        }

        const token = getAuthToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await fetch(`${BACKEND_URL}/api/memory/search`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, limit })
        });

        if (!response.ok) return '';

        const data = await response.json();
        const results = Array.isArray(data.results) ? data.results : [];
        if (results.length === 0) return '';

        const contextString = results
            .map((r: any) => `[${(r.category || 'CONTEXT').toUpperCase()}] ${r.content}`)
            .join('\n');

        const result = `\n=== USER_MAP_RECALL (Prism Memory) ===\n${contextString}\n=======================================\n`;
        this.lastSearchCache.set(cacheKey, { result, timestamp: Date.now() });

        return result;
    }

    clearMemory(_userId: string) {
        this.lastSearchCache.clear();
    }
}

export const userMapService = UserMapService.getInstance();
