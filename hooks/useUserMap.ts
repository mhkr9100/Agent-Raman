import { useState, useEffect, useCallback, useRef } from 'react';
import { PageNode, UserProfile } from '../types';

const EMPTY_TREE: PageNode = {
    id: 'root',
    label: 'UserMap',
    nodeType: 'root',
    children: []
};

function normalizeImportance(value?: string): 'high' | 'medium' | 'low' {
    return value === 'high' || value === 'low' ? value : 'medium';
}

function normalizeTree(node: PageNode, depth = 0): PageNode {
    const children = Array.isArray(node.children)
        ? node.children.map((child) => normalizeTree(child, depth + 1))
        : [];

    const nodeType = node.nodeType
        || (depth === 0
            ? 'root'
            : children.length > 0
                ? (depth === 1 ? 'category' : 'cluster')
                : 'fact');

    return {
        ...node,
        nodeType,
        importance: normalizeImportance(node.importance || (depth <= 1 ? 'high' : 'medium')),
        confidence: typeof node.confidence === 'number' ? node.confidence : (depth === 0 ? 0.99 : undefined),
        children
    };
}

export const useUserMap = (currentUser: UserProfile | null) => {
    const [userMapTree, setUserMapTree] = useState<PageNode>(EMPTY_TREE);
    const [isLoading, setIsLoading] = useState(false);
    const [isConsolidating, setIsConsolidating] = useState(false);
    const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);

    const latestTreeRef = useRef<PageNode>(EMPTY_TREE);
    const latestUpdatedAtRef = useRef<string | null>(null);

    useEffect(() => {
        if (!currentUser) return;

        let mounted = true;
        (async () => {
            setIsLoading(true);
            try {
                const { getUserMapTree } = await import('../services/apiV2');
                const remote = await getUserMapTree();
                const tree = remote?.tree && remote.tree.id === 'root' ? normalizeTree(remote.tree) : EMPTY_TREE;
                const updatedAt = remote?.updatedAt || null;

                if (!mounted) return;
                setUserMapTree(tree);
                latestTreeRef.current = tree;
                setServerUpdatedAt(updatedAt);
                latestUpdatedAtRef.current = updatedAt;
            } catch (error) {
                console.warn('[useUserMap] Remote load failed, resetting to empty tree:', error);
                if (!mounted) return;
                setUserMapTree(EMPTY_TREE);
                latestTreeRef.current = EMPTY_TREE;
                setServerUpdatedAt(null);
                latestUpdatedAtRef.current = null;
            } finally {
                if (mounted) setIsLoading(false);
            }
        })();

        return () => {
            mounted = false;
        };
    }, [currentUser]);

    const saveTree = useCallback(async (tree: PageNode) => {
        if (!currentUser) return;

        const previousTree = latestTreeRef.current;
        const previousUpdatedAt = latestUpdatedAtRef.current;
        const normalizedTree = normalizeTree(tree);

        setUserMapTree(normalizedTree);
        latestTreeRef.current = normalizedTree;

        try {
            const { saveUserMapTree } = await import('../services/apiV2');
            const response = await saveUserMapTree(normalizedTree, previousUpdatedAt);
            const nextUpdatedAt = response.updatedAt || new Date().toISOString();

            setServerUpdatedAt(nextUpdatedAt);
            latestUpdatedAtRef.current = nextUpdatedAt;
        } catch (error: any) {
            if (error?.code === 'CONFLICT' && error.currentTree?.id === 'root') {
                const remoteTree = error.currentTree as PageNode;
                const remoteUpdatedAt = error.currentUpdatedAt || null;
                const normalizedRemoteTree = normalizeTree(remoteTree);
                setUserMapTree(normalizedRemoteTree);
                latestTreeRef.current = normalizedRemoteTree;
                setServerUpdatedAt(remoteUpdatedAt);
                latestUpdatedAtRef.current = remoteUpdatedAt;
                return;
            }

            console.error('[useUserMap] Failed to save tree, rolling back:', error);
            setUserMapTree(previousTree);
            latestTreeRef.current = previousTree;
            setServerUpdatedAt(previousUpdatedAt);
            latestUpdatedAtRef.current = previousUpdatedAt;
            throw error;
        }
    }, [currentUser]);

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
            const { listMemories, consolidateUserMap } = await import('../services/apiV2');
            const memoriesResponse = await listMemories(500);
            const memoryStrings = (memoriesResponse.memories || [])
                .map((m) => (m.content || '').trim())
                .filter(Boolean);

            if (memoryStrings.length === 0) {
                throw new Error('No memories to consolidate. Chat with Prism or your chatbots first to build your memory.');
            }

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
        const BACKEND_URL = import.meta.env.VITE_API_V2_URL || import.meta.env.VITE_BACKEND_URL || '';
        const failures: string[] = [];

        if (!BACKEND_URL) {
            throw new Error('Cloud memory endpoint is not configured.');
        }

        let storedCount = 0;
        const token = sessionStorage.getItem('id_token')
            || sessionStorage.getItem('auth_token')
            || localStorage.getItem('id_token')
            || localStorage.getItem('auth_token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;

        for (const fact of facts) {
            const cleaned = (fact || '').trim();
            if (!cleaned) continue;

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
                    continue;
                }
                storedCount += 1;
            } catch (error: any) {
                failures.push(`memory/add network error: ${error?.message || 'unknown error'}`);
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
