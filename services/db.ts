import Dexie, { Table } from 'dexie';

export const STORES_ENUM = {
    AGENTS: 'agents',
    CHATS: 'chats',
    TASKS: 'tasks',
    FEEDBACK: 'feedback',
    SESSIONS: 'sessions',
    USERMAP: 'usermap',
    MEMORIES: 'memories'
} as const;

type StoreName = typeof STORES_ENUM[keyof typeof STORES_ENUM];

class RamNDatabase extends Dexie {
    agents!: Table<any, string>;
    chats!: Table<any, string>;
    tasks!: Table<any, string>;
    feedback!: Table<any, string>;
    sessions!: Table<any, string>;
    usermap!: Table<any, string>;
    memories!: Table<any, string>;

    constructor() {
        super('RamN_AI');
        this.version(1).stores({
            agents: 'id, userId',
            chats: 'id',
            tasks: 'id, agentId, status',
            feedback: 'id',
            sessions: 'id, entityId, userId',
            usermap: 'id'
        });
        this.version(2).stores({
            agents: 'id, userId',
            chats: 'id',
            tasks: 'id, agentId, status',
            feedback: 'id',
            sessions: 'id, entityId, userId',
            usermap: 'id',
            memories: 'id, userId, agentId, createdAt'
        });
    }
}

const db = new RamNDatabase();
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || '';

class DBService {
    private getTable(storeName: StoreName): Table<any, string> {
        return db[storeName as keyof RamNDatabase] as Table<any, string>;
    }

    private filterByUser<T extends Record<string, any>>(items: T[], userId?: string): T[] {
        if (!userId) return items;
        return items.filter(item => !item?.userId || item.userId === userId);
    }

    private getAuthHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const token = sessionStorage.getItem('auth_token')
            || sessionStorage.getItem('id_token')
            || localStorage.getItem('auth_token')
            || localStorage.getItem('id_token');
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    }

    private async parseJsonSafe<T>(response: Response): Promise<T> {
        try {
            return await response.json() as T;
        } catch {
            return {} as T;
        }
    }

    async put(storeName: StoreName, value: any, explicitKey?: string) {
        const key = explicitKey || (value && value.id ? value.id : undefined);
        if (!key) throw new Error(`No key provided for store ${storeName}`);

        const item = Array.isArray(value)
            ? { id: key, data: value }
            : { ...value, id: key };

        // Cloud-first and authoritative whenever backend is configured.
        if (BACKEND_URL && item.userId) {
            const response = await fetch(`${BACKEND_URL}/api/db`, {
                method: 'POST',
                headers: this.getAuthHeaders(),
                body: JSON.stringify({ store: storeName, item })
            });
            if (!response.ok) {
                const body = await this.parseJsonSafe<{ error?: string; message?: string }>(response);
                throw new Error(body?.message || body?.error || `Cloud write failed (${response.status})`);
            }
        }

        // Local cache is strictly secondary.
        await this.getTable(storeName).put(item);
    }

    async get<T>(storeName: StoreName, key: string, userId?: string): Promise<T | null> {
        if (BACKEND_URL && userId) {
            const response = await fetch(
                `${BACKEND_URL}/api/db?store=${storeName}&id=${key}&userId=${userId}`,
                { headers: this.getAuthHeaders() }
            );
            if (!response.ok) {
                const body = await this.parseJsonSafe<{ error?: string; message?: string }>(response);
                throw new Error(body?.message || body?.error || `Cloud read failed (${response.status})`);
            }

            const data = await this.parseJsonSafe<{ item?: any }>(response);
            if (!data.item) return null;

            const normalized = Array.isArray(data.item) ? { id: key, data: data.item } : { ...data.item, id: key };
            await this.getTable(storeName).put(normalized);
            if (normalized.data && Array.isArray(normalized.data)) return normalized.data as T;
            return normalized as T;
        }

        const item = await this.getTable(storeName).get(key);
        if (!item) return null;
        if (item.data && Array.isArray(item.data)) return item.data as T;
        return item as T;
    }

    async getAll<T>(storeName: StoreName, userId?: string): Promise<T[]> {
        if (BACKEND_URL && userId) {
            const response = await fetch(
                `${BACKEND_URL}/api/db?store=${storeName}&userId=${userId}`,
                { headers: this.getAuthHeaders() }
            );
            if (!response.ok) {
                const body = await this.parseJsonSafe<{ error?: string; message?: string }>(response);
                throw new Error(body?.message || body?.error || `Cloud list failed (${response.status})`);
            }

            const data = await this.parseJsonSafe<{ items?: any[] }>(response);
            const items = Array.isArray(data.items) ? data.items : [];
            if (items.length > 0) {
                await this.getTable(storeName).bulkPut(items.map((i: any) => ({ ...i, id: i.id || i.originalId })));
            }
            return this.filterByUser(items as T[], userId);
        }

        const items = await this.getTable(storeName).toArray();
        return this.filterByUser(items as T[], userId);
    }

    async delete(storeName: StoreName, key: string, userId?: string) {
        if (BACKEND_URL && userId) {
            const response = await fetch(
                `${BACKEND_URL}/api/db?store=${storeName}&id=${key}&userId=${userId}`,
                { method: 'DELETE', headers: this.getAuthHeaders() }
            );
            if (!response.ok) {
                const body = await this.parseJsonSafe<{ error?: string; message?: string }>(response);
                throw new Error(body?.message || body?.error || `Cloud delete failed (${response.status})`);
            }
        }

        await this.getTable(storeName).delete(key);
    }

    async pullFromCloud<T>(storeName: StoreName, userId: string): Promise<T[]> {
        if (!BACKEND_URL) return this.getAll<T>(storeName);

        const response = await fetch(
            `${BACKEND_URL}/api/db?store=${storeName}&userId=${userId}`,
            { headers: this.getAuthHeaders() }
        );
        if (!response.ok) {
            const body = await this.parseJsonSafe<{ error?: string; message?: string }>(response);
            throw new Error(body?.message || body?.error || `Cloud fetch failed (${response.status})`);
        }

        const data = await this.parseJsonSafe<{ items?: any[] }>(response);
        const items = Array.isArray(data.items) ? data.items : [];
        if (items.length > 0) {
            await this.getTable(storeName).bulkPut(items);
        }
        return items as T[];
    }
}

export const dbService = new DBService();
