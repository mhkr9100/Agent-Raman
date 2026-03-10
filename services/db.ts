import Dexie, { Table } from 'dexie';

// ==========================================
// IndexedDB Store Names
// ==========================================
export const STORES_ENUM = {
    AGENTS: 'agents',
    GROUPS: 'groups',
    CHATS: 'chats',
    TASKS: 'tasks',
    FEEDBACK: 'feedback',
    SESSIONS: 'sessions',
    USERMAP: 'usermap',
    MEMORIES: 'memories'
} as const;

type StoreName = typeof STORES_ENUM[keyof typeof STORES_ENUM];

// ==========================================
// Dexie Database Definition (Local Cache)
// ==========================================
class RamNDatabase extends Dexie {
    agents!: Table<any, string>;
    groups!: Table<any, string>;
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
            groups: 'id, userId',
            chats: 'id',
            tasks: 'id, agentId, status',
            feedback: 'id',
            sessions: 'id, entityId, userId',
            usermap: 'id'
        });
        this.version(2).stores({
            agents: 'id, userId',
            groups: 'id, userId',
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

// ==========================================
// DBService — DynamoDB-First, IndexedDB Cache
// ==========================================
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
        if (token) headers['Authorization'] = `Bearer ${token}`;
        return headers;
    }

    /**
     * PUT — DynamoDB First, IndexedDB Cache
     * 1. Write to DynamoDB immediately (if backend is available)
     * 2. Cache locally in IndexedDB for offline/fast access
     */
    async put(storeName: StoreName, value: any, explicitKey?: string) {
        try {
            const key = explicitKey || (value && value.id ? value.id : undefined);
            if (!key) throw new Error(`No key provided for store ${storeName}`);

            const item = Array.isArray(value)
                ? { id: key, data: value }
                : { ...value, id: key };

            // 1. DynamoDB FIRST (if backend exists and item has userId)
            if (BACKEND_URL && item.userId) {
                try {
                    await fetch(`${BACKEND_URL}/api/db`, {
                        method: 'POST',
                        headers: this.getAuthHeaders(),
                        body: JSON.stringify({ store: storeName, item })
                    });
                } catch (e) {
                    console.error(`[DynamoDB Write Error] ${storeName}:`, e);
                    // Continue to local cache even if cloud fails
                }
            }

            // 2. Cache locally
            await this.getTable(storeName).put(item);
        } catch (error) {
            console.error(`DB Put Error [${storeName}]:`, error);
        }
    }

    /**
     * GET — DynamoDB First, IndexedDB Fallback
     * 1. Try DynamoDB if backend is available
     * 2. Fallback to local IndexedDB cache
     */
    async get<T>(storeName: StoreName, key: string, userId?: string): Promise<T | null> {
        try {
            // Try DynamoDB first
            if (BACKEND_URL && userId) {
                try {
                    const res = await fetch(
                        `${BACKEND_URL}/api/db?store=${storeName}&id=${key}&userId=${userId}`,
                        { headers: this.getAuthHeaders() }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        if (data.item) {
                            // Cache locally for future fast access
                            await this.getTable(storeName).put(
                                Array.isArray(data.item) ? { id: key, data: data.item } : { ...data.item, id: key }
                            );
                            if (data.item.data && Array.isArray(data.item.data)) return data.item.data as T;
                            return data.item as T;
                        }
                    }
                } catch (e) {
                    console.warn(`[DynamoDB Read Fallback] ${storeName}:`, e);
                    // Fall through to local
                }
            }

            // Fallback: local IndexedDB
            const item = await this.getTable(storeName).get(key);
            if (!item) return null;
            if (item.data && Array.isArray(item.data)) return item.data as T;
            return item as T;
        } catch (error) {
            console.error(`DB Get Error [${storeName}]:`, error);
            return null;
        }
    }

    /**
     * GET ALL — DynamoDB First, IndexedDB Fallback
     */
    async getAll<T>(storeName: StoreName, userId?: string): Promise<T[]> {
        try {
            // Try DynamoDB first
            if (BACKEND_URL && userId) {
                try {
                    const res = await fetch(
                        `${BACKEND_URL}/api/db?store=${storeName}&userId=${userId}`,
                        { headers: this.getAuthHeaders() }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        const items = data.items || [];
                        if (items.length > 0) {
                            // Upsert cloud items into local cache without destructive clears.
                            await this.getTable(storeName).bulkPut(items.map((i: any) => ({ ...i, id: i.id || i.originalId })));
                            return this.filterByUser(items as T[], userId);
                        }

                        // Cloud can be temporarily empty; preserve local continuity.
                        const localItems = await this.getTable(storeName).toArray();
                        if (localItems.length > 0) {
                            return this.filterByUser(localItems as T[], userId);
                        }
                        return [];
                    }
                } catch (e) {
                    console.warn(`[DynamoDB GetAll Fallback] ${storeName}:`, e);
                    // Fall through to local
                }
            }

            // Fallback: local IndexedDB
            const items = await this.getTable(storeName).toArray();
            return this.filterByUser(items as T[], userId);
        } catch (error) {
            console.error(`DB GetAll Error [${storeName}]:`, error);
            return [];
        }
    }

    /**
     * DELETE — DynamoDB First, then IndexedDB
     */
    async delete(storeName: StoreName, key: string, userId?: string) {
        try {
            // 1. DynamoDB first
            if (BACKEND_URL && userId) {
                try {
                    await fetch(
                        `${BACKEND_URL}/api/db?store=${storeName}&id=${key}&userId=${userId}`,
                        { method: 'DELETE', headers: this.getAuthHeaders() }
                    );
                } catch (e) {
                    console.error(`[DynamoDB Delete Error] ${storeName}:`, e);
                }
            }

            // 2. Local cache
            await this.getTable(storeName).delete(key);
        } catch (error) {
            console.error(`DB Delete Error [${storeName}]:`, error);
        }
    }

    /**
     * Pull from cloud — Sync DynamoDB → IndexedDB
     * Called on login to hydrate local cache
     */
    async pullFromCloud<T>(storeName: StoreName, userId: string): Promise<T[]> {
        if (!BACKEND_URL) return this.getAll<T>(storeName);

        try {
            const res = await fetch(
                `${BACKEND_URL}/api/db?store=${storeName}&userId=${userId}`,
                { headers: this.getAuthHeaders() }
            );
            if (!res.ok) throw new Error(`Cloud fetch failed: ${res.status}`);

            const data = await res.json();
            const items = data.items || [];

            // Upsert cloud items into local cache without clearing other cached records.
            if (items.length > 0) {
                await this.getTable(storeName).bulkPut(items);
            }
            return items as T[];
        } catch (error) {
            console.error(`[Cloud Sync Error] Failed to pull ${storeName}:`, error);
            return this.getAll<T>(storeName);
        }
    }
}

export const dbService = new DBService();
