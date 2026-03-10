
/**
 * UserMapService: Cloud-First Long-term Context Memory for Users.
 * 
 * Architecture:
 * 1. Captures user interactions/profiles.
 * 2. Sends to Backend → Gemini Embedding API → DynamoDB (with embedding vectors).
 * 3. Before each AI call, queries backend for semantically relevant context.
 * 4. Injects into the AI's system prompt (Prism context).
 * 
 * Falls back to local in-memory storage if backend is unavailable.
 */

import { Message } from "../types";

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
    private memoryCache: UserContextItem[] = []; // In-session cache for fast lookups
    private lastSearchCache: Map<string, { result: string; timestamp: number }> = new Map();
    private CACHE_TTL_MS = 60_000; // 1 minute cache for repeated queries

    private constructor() {
        this.loadLocalFallback();
    }

    public static getInstance() {
        if (!UserMapService.instance) {
            UserMapService.instance = new UserMapService();
        }
        return UserMapService.instance;
    }

    /**
     * Store a new piece of context about the user.
     * Cloud-first: sends to /api/memory/add for embedding + DynamoDB storage.
     * Falls back to local storage if backend unavailable.
     */
    async recordContext(userId: string, content: string, category: UserContextItem['category']) {
        const newItem: UserContextItem = {
            id: `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            userId,
            content,
            category,
            timestamp: Date.now()
        };

        // Add to session cache
        this.memoryCache.push(newItem);

        // Cloud-first
        if (BACKEND_URL) {
            try {
                const token = getAuthToken();
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                await fetch(`${BACKEND_URL}/api/memory/add`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ content, category })
                });
            } catch (e) {
                console.error('[UserMap Cloud Error]', e);
            }
        }

        // Local fallback persistence
        this.saveLocalFallback();
    }

    /**
     * Retrieve relevant context for a query.
     * Cloud-first: uses /api/memory/search for vector similarity search.
     * Falls back to local recency-based matching.
     */
    async getRelevantContext(userId: string, query: string, limit = 5): Promise<string> {
        // Check cache first
        const cacheKey = `${userId}:${query.substring(0, 100)}`;
        const cached = this.lastSearchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            return cached.result;
        }

        let contextString = '';

        // Cloud-first: vector similarity search
        if (BACKEND_URL) {
            try {
                const token = getAuthToken();
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(`${BACKEND_URL}/api/memory/search`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ query, limit })
                });

                if (res.ok) {
                    const data = await res.json();
                    const results = data.results || [];
                    if (results.length > 0) {
                        contextString = results
                            .map((r: any) => `[${(r.category || 'CONTEXT').toUpperCase()}] ${r.content}`)
                            .join('\n');
                    }
                }
            } catch (e) {
                console.warn('[UserMap Cloud Search Fallback]', e);
            }
        }

        // Fallback: local recency-based
        if (!contextString) {
            const userMemory = this.memoryCache.filter(m => m.userId === userId);
            if (userMemory.length === 0) return '';

            const relevant = userMemory
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);

            if (relevant.length === 0) return '';

            contextString = relevant
                .map(m => `[${m.category.toUpperCase()}] ${m.content}`)
                .join('\n');
        }

        if (!contextString) return '';

        const result = `\n=== USER_MAP_RECALL (Prism Memory) ===\n${contextString}\n=======================================\n`;

        // Cache the result
        this.lastSearchCache.set(cacheKey, { result, timestamp: Date.now() });

        return result;
    }

    /**
     * Load from local storage (fallback persistence).
     */
    private loadLocalFallback() {
        try {
            const data = localStorage.getItem('ramn_user_map');
            if (data) {
                this.memoryCache = JSON.parse(data);
            }
        } catch (e) {
            this.memoryCache = [];
        }
    }

    /**
     * Persist to local storage (fallback).
     */
    private saveLocalFallback() {
        // Keep only last 200 items locally to avoid storage bloat
        const trimmed = this.memoryCache.slice(-200);
        localStorage.setItem('ramn_user_map', JSON.stringify(trimmed));
    }

    /**
     * Wipe all user context (Privacy first).
     */
    clearMemory(userId: string) {
        this.memoryCache = this.memoryCache.filter(m => m.userId !== userId);
        this.lastSearchCache.clear();
        this.saveLocalFallback();
    }
}

export const userMapService = UserMapService.getInstance();
