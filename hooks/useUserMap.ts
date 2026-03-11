import { useState, useEffect, useCallback, useRef } from 'react';
import { UserProfile } from '../types';
import { dbService, STORES_ENUM } from '../services/db';

export interface PageNode {
    id: string;
    label: string;
    value?: string;
    source?: string;
    children: PageNode[];
}

interface StoredUserMapRecord {
    id: string;
    userId: string;
    tree: PageNode;
    updatedAt: string | null;
}

const EMPTY_TREE: PageNode = {
    id: 'root',
    label: 'UserMap',
    children: []
};

export const useUserMap = (currentUser: UserProfile | null) => {
    const [userMapTree, setUserMapTree] = useState<PageNode>(EMPTY_TREE);
    const [isLoading, setIsLoading] = useState(false);
    const [isConsolidating, setIsConsolidating] = useState(false);
    const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);

    const latestTreeRef = useRef<PageNode>(EMPTY_TREE);
    const latestUpdatedAtRef = useRef<string | null>(null);

    const persistLocalCache = useCallback(async (userId: string, tree: PageNode, updatedAt: string | null) => {
        const key = `usermap-${userId}`;
        const payload: StoredUserMapRecord = {
            id: key,
            userId,
            tree,
            updatedAt
        };
        await dbService.put(STORES_ENUM.USERMAP, payload, key);
    }, []);

    const readLocalCache = useCallback(async (userId: string): Promise<StoredUserMapRecord | null> => {
        const keyPrimary = `usermap-${userId}`;
        const keyLegacy = `usermap_${userId}`;
        let saved = await dbService.get<StoredUserMapRecord | PageNode>(STORES_ENUM.USERMAP, keyPrimary, userId);
        if (!saved) saved = await dbService.get<StoredUserMapRecord | PageNode>(STORES_ENUM.USERMAP, keyLegacy, userId);

        if (saved && (saved as StoredUserMapRecord).tree) {
            return saved as StoredUserMapRecord;
        }

        if (saved && (saved as PageNode).id === 'root') {
            return {
                id: keyPrimary,
                userId,
                tree: saved as PageNode,
                updatedAt: null
            };
        }

        return null;
    }, []);

    useEffect(() => {
        if (!currentUser) return;

        let mounted = true;
        (async () => {
            setIsLoading(true);
            try {
                const { getUserMapTree } = await import('../services/apiV2');
                const remote = await getUserMapTree();
                const tree = remote?.tree && remote.tree.id === 'root' ? remote.tree : EMPTY_TREE;
                const updatedAt = remote?.updatedAt || null;

                if (!mounted) return;
                setUserMapTree(tree);
                latestTreeRef.current = tree;
                setServerUpdatedAt(updatedAt);
                latestUpdatedAtRef.current = updatedAt;

                await persistLocalCache(currentUser.id, tree, updatedAt);
            } catch (error) {
                console.warn('[useUserMap] Remote load failed, using local cache:', error);
                const local = await readLocalCache(currentUser.id);
                const fallbackTree = local?.tree && local.tree.id === 'root' ? local.tree : EMPTY_TREE;
                const fallbackUpdatedAt = local?.updatedAt || null;

                if (!mounted) return;
                setUserMapTree(fallbackTree);
                latestTreeRef.current = fallbackTree;
                setServerUpdatedAt(fallbackUpdatedAt);
                latestUpdatedAtRef.current = fallbackUpdatedAt;
            } finally {
                if (mounted) setIsLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [currentUser, persistLocalCache, readLocalCache]);

    const saveTree = useCallback(async (tree: PageNode) => {
        if (!currentUser) return;

        const previousTree = latestTreeRef.current;
        const previousUpdatedAt = latestUpdatedAtRef.current;

        setUserMapTree(tree);
        latestTreeRef.current = tree;
        await persistLocalCache(currentUser.id, tree, previousUpdatedAt);

        try {
            const { saveUserMapTree } = await import('../services/apiV2');
            const response = await saveUserMapTree(tree, previousUpdatedAt);
            const nextUpdatedAt = response.updatedAt || new Date().toISOString();

            setServerUpdatedAt(nextUpdatedAt);
            latestUpdatedAtRef.current = nextUpdatedAt;
            await persistLocalCache(currentUser.id, tree, nextUpdatedAt);
        } catch (error: any) {
            if (error?.code === 'CONFLICT' && error.currentTree?.id === 'root') {
                const remoteTree = error.currentTree as PageNode;
                const remoteUpdatedAt = error.currentUpdatedAt || null;
                setUserMapTree(remoteTree);
                latestTreeRef.current = remoteTree;
                setServerUpdatedAt(remoteUpdatedAt);
                latestUpdatedAtRef.current = remoteUpdatedAt;
                await persistLocalCache(currentUser.id, remoteTree, remoteUpdatedAt);
                return;
            }

            console.error('[useUserMap] Failed to save tree, rolling back:', error);
            setUserMapTree(previousTree);
            latestTreeRef.current = previousTree;
            setServerUpdatedAt(previousUpdatedAt);
            latestUpdatedAtRef.current = previousUpdatedAt;
            await persistLocalCache(currentUser.id, previousTree, previousUpdatedAt);
        }
    }, [currentUser, persistLocalCache]);

    const updateNode = useCallback((nodeId: string, updates: Partial<PageNode>) => {
        const updateInTree = (node: PageNode): PageNode => {
            if (node.id === nodeId) {
                return { ...node, ...updates };
            }
            return { ...node, children: node.children.map(updateInTree) };
        };
        const updated = updateInTree(latestTreeRef.current);
        void saveTree(updated);
    }, [saveTree]);

    const deleteNode = useCallback((nodeId: string) => {
        const removeFromTree = (node: PageNode): PageNode => {
            return {
                ...node,
                children: node.children
                    .filter(c => c.id !== nodeId)
                    .map(removeFromTree)
            };
        };
        const updated = removeFromTree(latestTreeRef.current);
        void saveTree(updated);
    }, [saveTree]);

    const addNode = useCallback((parentId: string, newNode: PageNode) => {
        const addToTree = (node: PageNode): PageNode => {
            if (node.id === parentId) {
                return { ...node, children: [...node.children, newNode] };
            }
            return { ...node, children: node.children.map(addToTree) };
        };
        const updated = addToTree(latestTreeRef.current);
        void saveTree(updated);
    }, [saveTree]);

    const consolidate = useCallback(async () => {
        if (!currentUser) {
            throw new Error('Not logged in.');
        }

        setIsConsolidating(true);
        try {
            const stored = await dbService.getAll<{ id: string; content: string }>(STORES_ENUM.MEMORIES, currentUser.id);
            const memoryStrings = stored.map(m => m.content || m.id).filter(Boolean);

            if (memoryStrings.length === 0) {
                throw new Error('No memories to consolidate. Chat with agents first to build your memory.');
            }

            const { consolidateUserMap } = await import('../services/apiV2');
            const tree = await consolidateUserMap({
                memories: memoryStrings,
                existingTree: latestTreeRef.current.children.length > 0 ? latestTreeRef.current : undefined
            });

            await saveTree(tree);
        } finally {
            setIsConsolidating(false);
        }
    }, [currentUser, saveTree]);

    const persistFacts = useCallback(async (
        facts: string[],
        agentId?: string,
        source: string = 'chat',
        requireCloudAck: boolean = false
    ) => {
        if (!currentUser || facts.length === 0) return 0;
        const timestamp = Date.now();
        const BACKEND_URL = import.meta.env.VITE_API_V2_URL || import.meta.env.VITE_BACKEND_URL || '';
        const failures: string[] = [];

        if (requireCloudAck && !BACKEND_URL) {
            throw new Error('Cloud memory endpoint is not configured. External memory import requires backend sync.');
        }

        let storedCount = 0;
        for (const fact of facts) {
            const cleaned = (fact || '').trim();
            if (!cleaned) continue;

            const id = `mem_${timestamp}_${Math.random().toString(36).slice(2, 8)}`;

            await dbService.put(STORES_ENUM.MEMORIES, {
                id,
                userId: currentUser.id,
                agentId,
                source,
                content: cleaned,
                createdAt: new Date().toISOString()
            });
            storedCount += 1;

            if (BACKEND_URL) {
                const token = sessionStorage.getItem('id_token')
                    || sessionStorage.getItem('auth_token')
                    || localStorage.getItem('id_token')
                    || localStorage.getItem('auth_token');
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (token) headers['Authorization'] = `Bearer ${token}`;

                try {
                    const response = await fetch(`${BACKEND_URL}/api/memory/add`, {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            agentId,
                            content: cleaned,
                            category: source === 'external-import' ? 'profile' : 'general'
                        })
                    });
                    if (!response.ok) {
                        const body = await response.text();
                        failures.push(`memory/add failed (${response.status}): ${body || 'no response body'}`);
                    }
                } catch (error: any) {
                    failures.push(`memory/add network error: ${error?.message || 'unknown error'}`);
                }
            }
        }

        if (failures.length > 0) {
            if (requireCloudAck) {
                throw new Error(failures[0]);
            }
            console.error('[AWS Memory Sync Error]', failures[0]);
        }

        return storedCount;
    }, [currentUser]);

    const ingestSession = useCallback(async (messages: Array<{ role: string; content: string }>, agentId?: string) => {
        if (!currentUser) return;
        if (messages.length < 2) return;
        try {
            const { extractMemory } = await import('../services/apiV2');
            const res = await extractMemory({ messages });
            const facts: string[] = res.facts || [];
            await persistFacts(facts, agentId, 'chat', false);
        } catch (e) {
            console.error('Memory ingestion failed:', e);
        }
    }, [currentUser, persistFacts]);

    const ingestExternalMemory = useCallback(async (rawText: string) => {
        if (!currentUser) return 0;

        const codeBlockMatch = rawText.match(/```[\w-]*\s*([\s\S]*?)```/);
        const body = (codeBlockMatch ? codeBlockMatch[1] : rawText)
            .replace(/\r/g, '\n')
            .trim();

        const lines = body
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .filter(line => !line.startsWith('#'))
            .filter(line => !/^[-*]\s*$/.test(line));

        const normalized = lines
            .map(line => line.replace(/^\d+\.\s+/, '').trim())
            .filter(line => line.length >= 8)
            .slice(0, 200);

        return persistFacts(normalized, undefined, 'external-import', true);
    }, [currentUser, persistFacts]);

    return {
        userMapTree,
        setUserMapTree: saveTree,
        isLoading,
        isConsolidating,
        serverUpdatedAt,
        updateNode,
        deleteNode,
        addNode,
        consolidate,
        ingestSession,
        ingestExternalMemory
    };
};
