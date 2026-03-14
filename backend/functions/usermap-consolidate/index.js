/**
 * RamN AI — UserMap Consolidate Lambda
 * 
 * Takes raw facts and organizes them into a hierarchical tree structure.
 * 
 * POST /api/usermap/consolidate
 * Body: { userId, memories, existingTree }
 */

import { callAI } from '../../shared/vertex-ai.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

const STRUCTURING_PROMPT = `You are a Context Structurer for RamN AI.

You are given raw memory facts about a user and, optionally, an existing UserMap tree. Your job is to organize the information into compact categories and fact items.

RULES:
1. Group related facts under logical categories such as Identity, Career, Projects, Preferences, Instructions, Technical Stack, Business Goals, or General Context.
2. Merge duplicates or near-duplicates.
3. Keep labels concise and professional.
4. Every fact item must have:
   - "label": a short title
   - "value": the full fact content
5. Preserve important existing information if it is still relevant.
6. Return ONLY valid JSON.

Return this JSON shape:
{
  "categories": [
    {
      "label": "Category Name",
      "facts": [
        { "label": "Short Fact Label", "value": "Full fact content" }
      ]
    }
  ]
}`;

const CATEGORY_RULES = [
    { label: 'Instructions', patterns: [/\balways\b/i, /\bnever\b/i, /\bmust\b/i, /\bshould\b/i, /\brule\b/i, /\binstruction\b/i, /\bformat\b/i, /\btone\b/i, /\bstyle\b/i] },
    { label: 'Identity', patterns: [/\bname\b/i, /\bage\b/i, /\blive\b/i, /\blocation\b/i, /\bfamily\b/i, /\brelationship\b/i, /\blanguage\b/i, /\binterest\b/i, /\bhobby\b/i] },
    { label: 'Career', patterns: [/\bcareer\b/i, /\brole\b/i, /\bcompany\b/i, /\bwork\b/i, /\bskill\b/i, /\bexperience\b/i, /\bfounder\b/i, /\bconsultant\b/i] },
    { label: 'Projects', patterns: [/\bproject\b/i, /\bbuild\b/i, /\bbuilt\b/i, /\bapp\b/i, /\bplatform\b/i, /\bproduct\b/i, /\bfeature\b/i, /\broadmap\b/i] },
    { label: 'Preferences', patterns: [/\bprefer\b/i, /\bpreference\b/i, /\blike\b/i, /\bdislike\b/i, /\bpriority\b/i, /\bworkflow\b/i, /\btaste\b/i] },
    { label: 'Technical Stack', patterns: [/\baws\b/i, /\bvertex\b/i, /\bdynamodb\b/i, /\breact\b/i, /\btypescript\b/i, /\blambda\b/i, /\bapi\b/i, /\bfrontend\b/i, /\bbackend\b/i] },
    { label: 'Business Goals', patterns: [/\bgoal\b/i, /\brevenue\b/i, /\bgrowth\b/i, /\bcustomer\b/i, /\brfp\b/i, /\bopportunity\b/i, /\bbusiness\b/i] }
];

function slugify(value, fallback = 'node') {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized || fallback;
}

function safeString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}

function stripDatePrefix(value) {
    return String(value || '').replace(/^\[[^\]]+\]\s*-\s*/, '').trim();
}

function buildFactLabel(value) {
    const cleaned = stripDatePrefix(value)
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) return 'Context Item';
    const sentence = cleaned.split(/[.!?]/)[0].trim();
    const candidate = sentence || cleaned;
    return candidate.length <= 72 ? candidate : `${candidate.slice(0, 69).trimEnd()}...`;
}

function parseJsonCandidate(text) {
    const raw = safeString(text);
    if (!raw) return null;

    const attempts = [raw];
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) attempts.push(codeBlockMatch[1].trim());

    const braceStart = raw.indexOf('{');
    const braceEnd = raw.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
        attempts.push(raw.slice(braceStart, braceEnd + 1));
    }

    for (const candidate of attempts) {
        try {
            return JSON.parse(candidate);
        } catch {
            // try next
        }
    }

    return null;
}

function categorizeFact(fact) {
    const value = stripDatePrefix(fact);
    for (const rule of CATEGORY_RULES) {
        if (rule.patterns.some((pattern) => pattern.test(value))) {
            return rule.label;
        }
    }
    return 'General Context';
}

function normalizePlan(plan) {
    const categories = Array.isArray(plan?.categories) ? plan.categories : [];
    const normalized = [];

    for (const category of categories) {
        const label = safeString(category?.label, 'General Context');
        const facts = Array.isArray(category?.facts) ? category.facts : [];
        const seenFacts = new Set();
        const normalizedFacts = [];

        for (const fact of facts) {
            const value = safeString(fact?.value);
            if (!value) continue;
            const labelValue = safeString(fact?.label, buildFactLabel(value));
            const dedupeKey = `${labelValue.toLowerCase()}::${value.toLowerCase()}`;
            if (seenFacts.has(dedupeKey)) continue;
            seenFacts.add(dedupeKey);
            normalizedFacts.push({ label: labelValue, value });
        }

        if (normalizedFacts.length > 0) {
            normalized.push({ label, facts: normalizedFacts });
        }
    }

    return { categories: normalized };
}

function flattenTreeToPlan(tree) {
    if (!tree || tree.id !== 'root' || !Array.isArray(tree.children)) {
        return { categories: [] };
    }

    const categoryMap = new Map();

    const ensureCategory = (label) => {
        const key = safeString(label, 'General Context').toLowerCase();
        if (!categoryMap.has(key)) {
            categoryMap.set(key, { label: safeString(label, 'General Context'), facts: [] });
        }
        return categoryMap.get(key);
    };

    const visit = (node, topLevelLabel) => {
        if (!node || typeof node !== 'object') return;
        const children = Array.isArray(node.children) ? node.children : [];
        const nextTopLevel = topLevelLabel || safeString(node.label, 'General Context');

        if (children.length === 0) {
            const category = ensureCategory(topLevelLabel || 'General Context');
            const value = safeString(node.value, safeString(node.label));
            if (!value) return;
            category.facts.push({
                label: safeString(node.label, buildFactLabel(value)),
                value
            });
            return;
        }

        for (const child of children) {
            visit(child, node.id === 'root' ? safeString(child.label, 'General Context') : nextTopLevel);
        }
    };

    visit(tree, null);
    return normalizePlan({ categories: Array.from(categoryMap.values()) });
}

function buildFallbackPlan(memories) {
    const categoryMap = new Map();

    for (const rawMemory of memories || []) {
        const value = safeString(rawMemory);
        if (!value) continue;
        const label = categorizeFact(value);
        const key = label.toLowerCase();
        if (!categoryMap.has(key)) {
            categoryMap.set(key, { label, facts: [] });
        }
        categoryMap.get(key).facts.push({
            label: buildFactLabel(value),
            value
        });
    }

    return normalizePlan({ categories: Array.from(categoryMap.values()) });
}

function mergePlans(...plans) {
    const categoryMap = new Map();

    for (const plan of plans) {
        const normalized = normalizePlan(plan);
        for (const category of normalized.categories) {
            const key = category.label.toLowerCase();
            if (!categoryMap.has(key)) {
                categoryMap.set(key, { label: category.label, facts: [] });
            }
            const target = categoryMap.get(key);
            const seen = new Set(target.facts.map((fact) => `${fact.label.toLowerCase()}::${fact.value.toLowerCase()}`));

            for (const fact of category.facts) {
                const dedupeKey = `${fact.label.toLowerCase()}::${fact.value.toLowerCase()}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                target.facts.push(fact);
            }
        }
    }

    return { categories: Array.from(categoryMap.values()) };
}

function buildTreeFromPlan(plan) {
    const normalized = normalizePlan(plan);
    return {
        id: 'root',
        label: 'UserMap',
        children: normalized.categories.map((category, categoryIndex) => ({
            id: `category-${slugify(category.label, `category-${categoryIndex + 1}`)}`,
            label: category.label,
            children: category.facts.map((fact, factIndex) => ({
                id: `fact-${slugify(`${category.label}-${fact.label}`, `fact-${categoryIndex + 1}-${factIndex + 1}`)}`,
                label: fact.label,
                value: fact.value,
                children: []
            }))
        }))
    };
}

// ─── CORS Headers ────────────────────────────────────────────────

function respond(event, statusCode, body) {
    return {
        statusCode,
        headers: {
            ...buildCorsHeaders(event?.headers, 'OPTIONS,POST'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(event, 200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { memories, existingTree } = body;

        if (!memories || !Array.isArray(memories)) return respond(event, 400, { error: 'Missing memories array' });

        console.log(`USERMAP-CONSOLIDATE: userId=${userId}, memories=${memories.length}`);

        const normalizedMemories = memories
            .map((memory) => safeString(memory))
            .filter(Boolean)
            .slice(0, 500);

        if (normalizedMemories.length === 0) {
            return respond(event, 400, { error: 'No valid memories to consolidate' });
        }

        const memoryList = normalizedMemories.map((m, i) => `${i + 1}. ${m}`).join('\n');

        let userMessage = `Raw facts:\n${memoryList}`;
        if (existingTree) {
            userMessage += `\n\nExisting Tree:\n${JSON.stringify(existingTree, null, 2)}`;
            userMessage += `\n\nPlease merge the new facts into this existing structure.`;
        }

        let generatedPlan = null;
        const aiResult = await callAI({
            systemPrompt: STRUCTURING_PROMPT,
            userMessage,
            modelName: 'gemini-2.5-flash',
            temperature: 0.1
        });

        try {
            generatedPlan = normalizePlan(parseJsonCandidate(aiResult.text));
        } catch (e) {
            console.warn('USERMAP-CONSOLIDATE: Failed to normalize structured plan:', e.message);
        }

        const existingPlan = flattenTreeToPlan(existingTree);
        const fallbackPlan = buildFallbackPlan(normalizedMemories);
        const planToUse = generatedPlan?.categories?.length
            ? mergePlans(existingPlan, generatedPlan)
            : mergePlans(existingPlan, fallbackPlan);
        const tree = buildTreeFromPlan(planToUse);

        if (!tree || tree.id !== 'root' || !Array.isArray(tree.children)) {
            throw new Error('Failed to generate valid UserMap tree');
        }

        const usedFallback = !generatedPlan?.categories?.length;
        console.log(`USERMAP-CONSOLIDATE: ✅ Tree generated with ${tree.children.length} categories${usedFallback ? ' (fallback plan)' : ''}`);

        return respond(event, 200, tree);

    } catch (error) {
        console.error('USERMAP-CONSOLIDATE: ❌ Error:', error);

        if (error.message && error.message.startsWith('Unauthorized')) {
            return respond(event, 401, { error: 'Unauthorized', message: error.message });
        }

        return respond(event, 500, {
            error: 'Failed to consolidate user map',
            message: error.message || 'Unknown error'
        });
    }
};
