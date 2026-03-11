/**
 * Memory Service — Self-Hosted with pgvector (Aurora PostgreSQL)
 *
 * Server-side memory engine. Users don't interact with this directly.
 * Uses Gemini for embedding generation + PostgreSQL with pgvector for storage.
 *
 * When Aurora/pgvector is not configured, falls back to an in-memory store
 * so the app remains functional in development without a database.
 */

interface MemoryEntry {
    id: string;
    userId: string;
    agentId?: string;
    content: string;
    embedding?: number[];
    metadata?: Record<string, any>;
    createdAt: string;
}

// ==========================================
// In-Memory Fallback Store (Dev / No DB)
// ==========================================
const inMemoryStore: MemoryEntry[] = [];

class InMemoryVectorStore {
    async add(entry: MemoryEntry): Promise<void> {
        // Remove duplicates by content similarity
        const existing = inMemoryStore.findIndex(e =>
            e.userId === entry.userId && e.content.toLowerCase() === entry.content.toLowerCase()
        );
        if (existing >= 0) {
            inMemoryStore[existing] = entry; // Update
        } else {
            inMemoryStore.push(entry);
        }
    }

    async search(query: string, userId: string, agentId?: string, limit = 10): Promise<MemoryEntry[]> {
        // Simple keyword-based search for fallback
        const queryWords = query.toLowerCase().split(/\s+/);
        return inMemoryStore
            .filter(e => {
                if (e.userId !== userId) return false;
                if (agentId && e.agentId !== agentId) return false;
                const content = e.content.toLowerCase();
                return queryWords.some(w => content.includes(w));
            })
            .slice(0, limit);
    }

    async getAll(userId: string, agentId?: string): Promise<MemoryEntry[]> {
        return inMemoryStore.filter(e => {
            if (e.userId !== userId) return false;
            if (agentId && e.agentId !== agentId) return false;
            return true;
        });
    }

    async delete(id: string): Promise<void> {
        const idx = inMemoryStore.findIndex(e => e.id === id);
        if (idx >= 0) inMemoryStore.splice(idx, 1);
    }
}

// ==========================================
// pgvector Store (Production)
// ==========================================
class PgVectorStore {
    private connectionString: string;
    private initialized = false;

    constructor(config: { host: string; port: number; database: string; user: string; password: string }) {
        this.connectionString = `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}`;
    }

    private async getClient() {
        // Dynamic import to avoid requiring pg in dev when not used
        const { default: pg } = await import('pg');
        const client = new pg.Client({ connectionString: this.connectionString });
        await client.connect();
        return client;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        try {
            const client = await this.getClient();
            await client.query('CREATE EXTENSION IF NOT EXISTS vector');
            await client.query(`
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    agent_id TEXT,
                    content TEXT NOT NULL,
                    embedding vector(768),
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id)
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
                USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)
            `);
            await client.end();
            this.initialized = true;
            console.log('[MemoryService] pgvector initialized successfully');
        } catch (e: any) {
            console.error('[MemoryService] pgvector initialization failed:', e.message);
            throw e;
        }
    }

    async add(entry: MemoryEntry): Promise<void> {
        const client = await this.getClient();
        try {
            const embeddingStr = entry.embedding ? `[${entry.embedding.join(',')}]` : null;
            await client.query(
                `INSERT INTO memories (id, user_id, agent_id, content, embedding, metadata, created_at)
                 VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
                 ON CONFLICT (id) DO UPDATE SET content = $4, embedding = $5::vector, metadata = $6`,
                [entry.id, entry.userId, entry.agentId || null, entry.content, embeddingStr, JSON.stringify(entry.metadata || {}), entry.createdAt]
            );
        } finally {
            await client.end();
        }
    }

    async search(query: string, userId: string, agentId?: string, limit = 10, embedding?: number[]): Promise<MemoryEntry[]> {
        const client = await this.getClient();
        try {
            if (embedding) {
                const embeddingStr = `[${embedding.join(',')}]`;
                const agentFilter = agentId ? 'AND agent_id = $4' : '';
                const params = agentId
                    ? [embeddingStr, userId, limit, agentId]
                    : [embeddingStr, userId, limit];
                const result = await client.query(
                    `SELECT id, user_id as "userId", agent_id as "agentId", content, metadata, created_at as "createdAt"
                     FROM memories
                     WHERE user_id = $2 ${agentFilter}
                     ORDER BY embedding <=> $1::vector
                     LIMIT $3`,
                    params
                );
                return result.rows;
            } else {
                // Fallback to text search
                const agentFilter = agentId ? 'AND agent_id = $3' : '';
                const params = agentId ? [`%${query}%`, userId, agentId, limit] : [`%${query}%`, userId, limit];
                const limitIdx = agentId ? '$4' : '$3';
                const result = await client.query(
                    `SELECT id, user_id as "userId", agent_id as "agentId", content, metadata, created_at as "createdAt"
                     FROM memories
                     WHERE user_id = $2 AND content ILIKE $1 ${agentFilter}
                     LIMIT ${limitIdx}`,
                    params
                );
                return result.rows;
            }
        } finally {
            await client.end();
        }
    }

    async getAll(userId: string, agentId?: string): Promise<MemoryEntry[]> {
        const client = await this.getClient();
        try {
            const agentFilter = agentId ? 'AND agent_id = $2' : '';
            const params = agentId ? [userId, agentId] : [userId];
            const result = await client.query(
                `SELECT id, user_id as "userId", agent_id as "agentId", content, metadata, created_at as "createdAt"
                 FROM memories
                 WHERE user_id = $1 ${agentFilter}
                 ORDER BY created_at DESC`,
                params
            );
            return result.rows;
        } finally {
            await client.end();
        }
    }

    async delete(id: string): Promise<void> {
        const client = await this.getClient();
        try {
            await client.query('DELETE FROM memories WHERE id = $1', [id]);
        } finally {
            await client.end();
        }
    }
}

// ==========================================
// Fact Extractor — Uses backend memory-extract endpoint
// ==========================================
async function extractFacts(messages: Array<{ role: string; content: string }>): Promise<string[]> {
    // Dynamically import to avoid circular dependency issues
    const { extractMemory } = await import('./apiV2.js');
    try {
        const result = await extractMemory({ messages });
        return result.facts || [];
    } catch (e: any) {
        console.error('[MemoryService] Fact extraction failed:', e.message);
        return [];
    }
}

// ==========================================
// Memory Service — Public API
// ==========================================
export class MemoryService {
    private store: InMemoryVectorStore | PgVectorStore;
    private usePgVector: boolean;

    constructor(pgConfig?: { host: string; port: number; database: string; user: string; password: string }) {
        if (pgConfig && pgConfig.host) {
            this.store = new PgVectorStore(pgConfig);
            this.usePgVector = true;
            console.log('[MemoryService] Using pgvector (Aurora PostgreSQL)');
        } else {
            this.store = new InMemoryVectorStore();
            this.usePgVector = false;
            console.log('[MemoryService] Using in-memory store (no DB configured)');
        }
    }

    async initialize(): Promise<void> {
        if (this.usePgVector) {
            await (this.store as PgVectorStore).initialize();
        }
    }

    /**
     * Ingest chat messages — extract facts and store them.
     */
    async ingestMessages(messages: Array<{ role: string; content: string }>, userId: string, agentId?: string): Promise<string[]> {
        const facts = await extractFacts(messages);

        for (const fact of facts) {
            const entry: MemoryEntry = {
                id: `mem-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
                userId,
                agentId,
                content: fact,
                metadata: { source: 'chat', extractedAt: new Date().toISOString() },
                createdAt: new Date().toISOString()
            };
            await this.store.add(entry);
        }

        return facts;
    }

    /**
     * Search memories by query.
     */
    async search(query: string, userId: string, agentId?: string): Promise<MemoryEntry[]> {
        return this.store.search(query, userId, agentId);
    }

    /**
     * Get all memories for a user.
     */
    async getAll(userId: string, agentId?: string): Promise<MemoryEntry[]> {
        return this.store.getAll(userId, agentId);
    }

    /**
     * Delete a memory.
     */
    async deleteMemory(id: string): Promise<void> {
        return this.store.delete(id);
    }
}
