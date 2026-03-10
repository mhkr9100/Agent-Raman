import { useState, useEffect, useCallback } from 'react';
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
    updatedAt: string;
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

    // Load UserMap from local DB on mount
    useEffect(() => {
        if (!currentUser) return;
        const load = async () => {
            const keyPrimary = `usermap-${currentUser.id}`;
            const keyLegacy = `usermap_${currentUser.id}`;
            let saved = await dbService.get<StoredUserMapRecord | PageNode>(STORES_ENUM.USERMAP, keyPrimary, currentUser.id);
            if (!saved) {
                saved = await dbService.get<StoredUserMapRecord | PageNode>(STORES_ENUM.USERMAP, keyLegacy, currentUser.id);
            }

            if (!saved) {
                const all = await dbService.getAll<StoredUserMapRecord | PageNode>(STORES_ENUM.USERMAP, currentUser.id);
                const candidate = (all || []).find((entry: any) => (
                    (entry as StoredUserMapRecord).userId === currentUser.id || (entry as PageNode).id === 'root'
                ));
                if (!candidate) return;
                saved = candidate;
            }

            if ((saved as StoredUserMapRecord).tree) {
                setUserMapTree((saved as StoredUserMapRecord).tree);
                return;
            }

            // Backward compatibility for older local-only shape.
            if ((saved as PageNode).id === 'root') {
                setUserMapTree(saved as PageNode);
            }
        };
        load();
    }, [currentUser]);

    // Save to local DB whenever tree changes
    const saveTree = useCallback(async (tree: PageNode) => {
        if (!currentUser) return;
        setUserMapTree(tree);
        const key = `usermap-${currentUser.id}`;
        const payload: StoredUserMapRecord = {
            id: key,
            userId: currentUser.id,
            tree,
            updatedAt: new Date().toISOString()
        };
        await dbService.put(STORES_ENUM.USERMAP, payload, key);
    }, [currentUser]);

    // Update a specific node
    const updateNode = useCallback((nodeId: string, updates: Partial<PageNode>) => {
        const updateInTree = (node: PageNode): PageNode => {
            if (node.id === nodeId) {
                return { ...node, ...updates };
            }
            return { ...node, children: node.children.map(updateInTree) };
        };
        const updated = updateInTree(userMapTree);
        saveTree(updated);
    }, [userMapTree, saveTree]);

    // Delete a node
    const deleteNode = useCallback((nodeId: string) => {
        const removeFromTree = (node: PageNode): PageNode => {
            return {
                ...node,
                children: node.children
                    .filter(c => c.id !== nodeId)
                    .map(removeFromTree)
            };
        };
        const updated = removeFromTree(userMapTree);
        saveTree(updated);
    }, [userMapTree, saveTree]);

    // Add a child node
    const addNode = useCallback((parentId: string, newNode: PageNode) => {
        const addToTree = (node: PageNode): PageNode => {
            if (node.id === parentId) {
                return { ...node, children: [...node.children, newNode] };
            }
            return { ...node, children: node.children.map(addToTree) };
        };
        const updated = addToTree(userMapTree);
        saveTree(updated);
    }, [userMapTree, saveTree]);

    // Consolidate: pull chat memories from IndexedDB, structure into tree via API
    const consolidate = useCallback(async () => {
        if (!currentUser) {
            throw new Error('Not logged in.');
        }
        setIsConsolidating(true);
        try {
            // Get all stored memories from IndexedDB
            const stored = await dbService.getAll<{ id: string; content: string }>(STORES_ENUM.MEMORIES, currentUser.id);
            const memoryStrings = stored.map(m => m.content || m.id).filter(Boolean);

            if (memoryStrings.length === 0) {
                throw new Error('No memories to consolidate. Chat with agents first to build your memory.');
            }

            const { consolidateUserMap } = await import('../services/apiV2');
            const tree = await consolidateUserMap({
                memories: memoryStrings,
                existingTree: userMapTree.children.length > 0 ? userMapTree : undefined
            });

            await saveTree(tree);

        } finally {
            setIsConsolidating(false);
        }
    }, [currentUser, userMapTree, saveTree]);

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
                const token = sessionStorage.getItem('auth_token')
                    || sessionStorage.getItem('id_token')
                    || localStorage.getItem('auth_token')
                    || localStorage.getItem('id_token');
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

    // Ingest current chat session into memory — extract facts via API, store in IndexedDB
    const ingestSession = useCallback(async (messages: Array<{ role: string; content: string }>, agentId?: string) => {
        if (!currentUser) return;
        if (messages.length < 2) return; // Need at least a user+agent exchange
        try {
            const { extractMemory } = await import('../services/apiV2');

            // Send messages to backend to extract facts
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
        userMapTree, setUserMapTree: saveTree,
        isLoading, isConsolidating,
        updateNode, deleteNode, addNode,
        consolidate, ingestSession, ingestExternalMemory
    };
};
