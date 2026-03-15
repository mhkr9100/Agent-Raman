const IMPORTANCE_RANK = { high: 3, medium: 2, low: 1 };

function normalizeImportance(value, fallback = 'medium') {
    const lowered = String(value || '').toLowerCase().trim();
    if (lowered === 'high' || lowered === 'medium' || lowered === 'low') return lowered;
    return fallback;
}

function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeNodeValue(node) {
    if (normalizeSpace(node?.value)) return normalizeSpace(node.value);
    if (!Array.isArray(node?.children) || node.children.length === 0) return '';

    const childSummary = node.children
        .slice(0, 3)
        .map((child) => `${normalizeSpace(child.label)}${normalizeSpace(child.value) ? `: ${normalizeSpace(child.value)}` : ''}`)
        .filter(Boolean)
        .join(' | ');

    return childSummary;
}

function flattenTree(tree, categoryLabel = null, items = []) {
    if (!tree || typeof tree !== 'object') return items;

    if (tree.id === 'root' && Array.isArray(tree.children)) {
        tree.children.forEach((child) => flattenTree(child, child.label, items));
        return items;
    }

    const children = Array.isArray(tree.children) ? tree.children : [];
    const isCategory = tree.nodeType === 'category';

    if (!isCategory) {
        const summary = summarizeNodeValue(tree);
        if (normalizeSpace(tree.label) && normalizeSpace(summary)) {
            items.push({
                category: categoryLabel || 'General Context',
                label: normalizeSpace(tree.label),
                value: summary,
                importance: normalizeImportance(tree.importance),
                confidence: typeof tree.confidence === 'number' ? tree.confidence : null
            });
        }
    }

    if (children.length > 0) {
        children.forEach((child) => flattenTree(child, categoryLabel, items));
    }

    return items;
}

export function formatUserMapTreeContext(tree, { maxItems = 18 } = {}) {
    if (!tree || tree.id !== 'root') return '';

    const items = flattenTree(tree)
        .sort((left, right) => {
            const leftRank = IMPORTANCE_RANK[left.importance] || 0;
            const rightRank = IMPORTANCE_RANK[right.importance] || 0;
            if (leftRank !== rightRank) return rightRank - leftRank;
            return left.label.localeCompare(right.label);
        })
        .slice(0, maxItems);

    if (items.length === 0) return '';

    return items
        .map((item) => {
            const confidence = typeof item.confidence === 'number'
                ? ` (${Math.round(item.confidence * 100)}% confidence)`
                : '';
            return `- [${item.importance.toUpperCase()}] [${item.category}] ${item.label}: ${item.value}${confidence}`;
        })
        .join('\n');
}
