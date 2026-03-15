/**
 * RamN AI — UserMap Consolidate Lambda
 *
 * Takes raw facts and organizes them into a weighted hierarchical tree structure.
 *
 * POST /api/usermap/consolidate
 * Body: { userId, memories, existingTree }
 */

import { callAI } from '../../shared/vertex-ai.js';
import { validateToken } from '../../shared/auth.js';
import { buildCorsHeaders } from '../../shared/cors.js';

const STRUCTURING_PROMPT = `You are a Context Structurer for RamN AI.

You are given raw memory facts about a user and, optionally, an existing UserMap tree. Your job is to organize the information into a compact, trustworthy, human-readable hierarchy.

RULES:
1. Group facts under logical categories such as Identity, Preferences, Career, Education, Projects, Operations, Marketing & Communications, Technical Stack, Business Goals, Instructions, or General Context.
2. NEVER output raw section headers like EDUCATION, EXPERIENCE, SUMMARY, CONTACT, or SKILLS as fact labels or values.
3. NEVER use truncated labels like "St" when the meaning is "Location".
4. If label and value are effectively the same, rewrite the label semantically.
5. If a fact describes a structured relationship, prefer nesting.
   Example: education should be a cluster with Degree + Institution children when possible.
6. Keep labels concise, professional, and user-facing.
7. Assign an importance value of high, medium, or low.
8. Assign a confidence number between 0.0 and 1.0.
9. Return ONLY valid JSON.

Return this JSON shape:
{
  "categories": [
    {
      "label": "Category Name",
      "entries": [
        {
          "label": "Short Label",
          "value": "Fact content",
          "importance": "high|medium|low",
          "confidence": 0.92,
          "nodeType": "fact|cluster",
          "children": [
            {
              "label": "Child Label",
              "value": "Child fact",
              "importance": "medium",
              "confidence": 0.9
            }
          ]
        }
      ]
    }
  ]
}`;

const CATEGORY_ORDER = [
    'Identity',
    'Preferences',
    'Career',
    'Education',
    'Projects',
    'Operations',
    'Marketing & Communications',
    'Technical Stack',
    'Business Goals',
    'Instructions',
    'General Context'
];

const CATEGORY_ALIASES = new Map([
    ['identity', 'Identity'],
    ['profile', 'Identity'],
    ['preferences', 'Preferences'],
    ['preference', 'Preferences'],
    ['career', 'Career'],
    ['education', 'Education'],
    ['projects', 'Projects'],
    ['project', 'Projects'],
    ['operations', 'Operations'],
    ['marketing', 'Marketing & Communications'],
    ['marketing communications', 'Marketing & Communications'],
    ['marketing and communications', 'Marketing & Communications'],
    ['technical stack', 'Technical Stack'],
    ['tech stack', 'Technical Stack'],
    ['business goals', 'Business Goals'],
    ['business goal', 'Business Goals'],
    ['instructions', 'Instructions'],
    ['instruction', 'Instructions'],
    ['general context', 'General Context'],
    ['general', 'General Context']
]);

const SECTION_HEADERS = new Set([
    'ABOUT',
    'BIO',
    'CAPABILITIES',
    'CAPABILITY STATEMENT',
    'CAREER',
    'CERTIFICATIONS',
    'CONTACT',
    'CONTACT INFORMATION',
    'EDUCATION',
    'EXPERIENCE',
    'GENERAL CONTEXT',
    'IDENTITY',
    'INSTRUCTIONS',
    'INTERESTS',
    'OBJECTIVE',
    'OPERATIONS',
    'PREFERENCES',
    'PROFILE',
    'PROJECTS',
    'SKILLS',
    'SUMMARY',
    'TECHNICAL STACK',
    'WORK EXPERIENCE'
]);

const LABEL_ALIASES = new Map([
    ['ai collaboration style', 'AI Collaboration Style'],
    ['response style', 'Response Style'],
    ['output structure', 'Output Structure'],
    ['tool stack', 'Tool Stack'],
    ['workflow style', 'Workflow Style'],
    ['work style', 'Workflow Style'],
    ['instructions', 'Instruction'],
    ['location', 'Location'],
    ['city', 'Location'],
    ['name', 'Name'],
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['website', 'Website'],
    ['portfolio', 'Portfolio'],
    ['linkedin', 'LinkedIn'],
    ['degree', 'Degree'],
    ['institution', 'Institution'],
    ['company', 'Company'],
    ['role', 'Role']
]);

const IMPORTANCE_RANK = { high: 3, medium: 2, low: 1 };
const CONFIDENCE_FALLBACK = 0.76;

function slugify(value, fallback = 'node') {
    const normalized = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return normalized || fallback;
}

function normalizeSpace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeString(value, fallback = '') {
    const cleaned = normalizeSpace(value);
    return cleaned || fallback;
}

function normalizeKey(value) {
    return normalizeSpace(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function titleCase(value) {
    return normalizeSpace(value)
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function extractDatePrefix(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^\[([^\]]+)\]\s*-\s*([\s\S]+)$/);
    if (!match) {
        return { sourceDate: undefined, text: normalizeSpace(raw) };
    }
    return {
        sourceDate: normalizeSpace(match[1]),
        text: normalizeSpace(match[2])
    };
}

function stripDatePrefix(value) {
    return extractDatePrefix(value).text;
}

function clampConfidence(value, fallback = CONFIDENCE_FALLBACK) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0.4, Math.min(0.99, Number(value)));
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return Math.max(0.4, Math.min(0.99, parsed));
        }
    }
    return fallback;
}

function normalizeImportance(value, fallback = 'medium') {
    const lowered = String(value || '').toLowerCase().trim();
    if (lowered === 'high' || lowered === 'medium' || lowered === 'low') return lowered;
    if (typeof value === 'number') {
        if (value >= 0.8) return 'high';
        if (value >= 0.55) return 'medium';
        return 'low';
    }
    return fallback;
}

function isSectionHeader(value) {
    const cleaned = normalizeSpace(stripDatePrefix(value)).replace(/[\-:–]+$/, '');
    if (!cleaned) return false;
    if (SECTION_HEADERS.has(cleaned.toUpperCase())) return true;

    const alphaOnly = cleaned.replace(/[^A-Za-z]/g, '');
    const words = cleaned.split(' ').filter(Boolean);
    const hasLowercase = /[a-z]/.test(cleaned);

    return !hasLowercase && alphaOnly.length >= 4 && words.length <= 4 && cleaned.length <= 42;
}

function isLabelTooShort(label) {
    const cleaned = normalizeSpace(label).replace(/[^A-Za-z]/g, '');
    return cleaned.length > 0 && cleaned.length <= 2;
}

function labelsDuplicateValue(label, value) {
    const labelKey = normalizeKey(label);
    const valueKey = normalizeKey(value);
    if (!labelKey || !valueKey) return false;
    return labelKey === valueKey || valueKey.startsWith(`${labelKey} `);
}

function extractLabeledValue(value) {
    const cleaned = normalizeSpace(value);
    const match = cleaned.match(/^([A-Za-z][A-Za-z &/()+-]{1,48}?)\s*:\s*(.+)$/);
    if (!match) return null;
    const label = safeString(match[1]);
    const nextValue = safeString(match[2]);
    if (!label || !nextValue || isSectionHeader(label)) return null;
    return { label, value: nextValue };
}

function canonicalLabel(label) {
    const cleaned = safeString(label);
    if (!cleaned) return '';
    const alias = LABEL_ALIASES.get(normalizeKey(cleaned));
    if (alias) return alias;
    return titleCase(cleaned);
}

function normalizeCategoryLabel(label, fallback = 'General Context') {
    const cleaned = safeString(label, fallback);
    const alias = CATEGORY_ALIASES.get(normalizeKey(cleaned));
    return alias || titleCase(cleaned) || fallback;
}

function extractEmail(value) {
    return value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
}

function extractPhone(value) {
    return value.match(/(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/)?.[0] || '';
}

function extractWebsite(value) {
    if (extractEmail(value)) return '';
    const match = value.match(/(?:https?:\/\/|www\.)[^\s]+|\b[a-z0-9.-]+\.[a-z]{2,}(?:\/[a-z0-9._~:/?#\[\]@!$&'()*+,;=-]*)?/i);
    if (!match) return '';
    const site = match[0].replace(/[),.;]+$/, '');
    if (site.includes('@')) return '';
    return site;
}

function extractLocation(value) {
    const explicit = value.match(/\b([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+)*,\s?[A-Z]{2})\b/);
    if (explicit?.[1]) return explicit[1];
    const remote = value.match(/\b(remote|hybrid|onsite)\b/i);
    if (remote?.[1]) return titleCase(remote[1]);
    return '';
}

function inferCategory(label, value) {
    const combined = `${label} ${value}`.toLowerCase();

    if (/\b(ai collaboration style|response style|output structure|tool stack|workflow style|work style|preference|prefer|likes|dislikes|priority)\b/.test(combined)) {
        return 'Preferences';
    }
    if (/\b(always|never|must|should|rule|instruction|format|tone|style guide)\b/.test(combined)) {
        return 'Instructions';
    }
    if (/\b(email|phone|location|name|family|language|interest|hobby|website|portfolio|linkedin)\b/.test(combined)) {
        return 'Identity';
    }
    if (/\b(bachelor|master|doctorate|phd|b\.?tech|m\.?tech|b\.?s\.?|m\.?s\.?|mba|college|university|institute|school|academy|certificate|certification|diploma)\b/.test(combined)) {
        return 'Education';
    }
    if (/\b(project|platform|product|feature|roadmap|build|built|app|workflow)\b/.test(combined)) {
        return 'Projects';
    }
    if (/\b(operations|operational|process|automation|admin|execution|sop|pipeline)\b/.test(combined)) {
        return 'Operations';
    }
    if (/\b(marketing|branding|communications|copywriting|campaign|content|website design|advertising)\b/.test(combined)) {
        return 'Marketing & Communications';
    }
    if (/\b(aws|vertex|gemini|dynamodb|react|typescript|n8n|appscript|apps script|lambda|api|tooling|tech stack|technical stack)\b/.test(combined)) {
        return 'Technical Stack';
    }
    if (/\b(goal|objective|growth|revenue|rfp|opportunity|target market|target client|business)\b/.test(combined)) {
        return 'Business Goals';
    }
    if (/\b(role|company|career|experience|founder|consultant|manager|engineer|analyst|skill)\b/.test(combined)) {
        return 'Career';
    }
    return 'General Context';
}

function inferSemanticLabel(value, category) {
    const cleaned = safeString(value);
    if (!cleaned) return 'Context Item';

    if (extractEmail(cleaned)) return 'Email';
    if (extractPhone(cleaned)) return 'Phone';
    if (extractWebsite(cleaned)) return /linkedin/i.test(cleaned) ? 'LinkedIn' : 'Website';
    if (extractLocation(cleaned)) return 'Location';

    const lowered = cleaned.toLowerCase();

    if (category === 'Preferences') {
        if (/collaboration/.test(lowered)) return 'AI Collaboration Style';
        if (/response/.test(lowered)) return 'Response Style';
        if (/output/.test(lowered)) return 'Output Structure';
        if (/tool stack|n8n|appscript|apps script|ai agents/.test(lowered)) return 'Tool Stack';
        if (/workflow|work style/.test(lowered)) return 'Workflow Style';
        return 'Preference';
    }

    if (category === 'Instructions') {
        return /always|never|must|should/.test(lowered) ? 'Operating Rule' : 'Instruction';
    }

    if (category === 'Education') {
        if (/university|college|institute|school|academy/.test(lowered)) return 'Institution';
        if (/bachelor|master|doctorate|phd|certificate|certification|diploma|mba|b\.?s\.?|m\.?s\.?|b\.?tech|m\.?tech/.test(lowered)) return 'Degree';
        return 'Education Detail';
    }

    if (category === 'Career') {
        if (/founder|ceo|cto|manager|engineer|analyst|consultant|specialist/.test(lowered)) return 'Role';
        if (/llc|inc|corp|company|organization|studio|agency/.test(lowered)) return 'Company';
        if (/experience|years/.test(lowered)) return 'Experience';
        return 'Career Detail';
    }

    if (category === 'Projects') {
        return 'Project Context';
    }

    if (category === 'Operations') {
        return /automation|workflow|process/.test(lowered) ? 'Workflow' : 'Operations Detail';
    }

    if (category === 'Marketing & Communications') {
        return /branding/.test(lowered) ? 'Brand Focus' : 'Marketing Detail';
    }

    if (category === 'Technical Stack') {
        return /stack|aws|vertex|react|typescript|n8n|lambda|dynamodb/.test(lowered) ? 'Technical Stack' : 'Technology';
    }

    if (category === 'Business Goals') {
        if (/rfp|opportunity/.test(lowered)) return 'Opportunity Focus';
        if (/goal|objective/.test(lowered)) return 'Business Goal';
        return 'Target Outcome';
    }

    if (category === 'Identity') {
        return 'Identity Detail';
    }

    return 'Context Item';
}

function inferImportance(category, label, value, explicitImportance) {
    if (explicitImportance) {
        return normalizeImportance(explicitImportance);
    }

    const labelKey = normalizeKey(label);
    const combined = `${label} ${value}`.toLowerCase();

    if (category === 'Instructions' || category === 'Preferences' || category === 'Business Goals') {
        return 'high';
    }
    if (['ai collaboration style', 'response style', 'output structure', 'tool stack'].includes(labelKey)) {
        return 'high';
    }
    if (['email', 'phone', 'website', 'linkedin'].includes(labelKey)) {
        return 'low';
    }
    if (category === 'Identity' && /\b(location|name)\b/.test(labelKey)) {
        return 'medium';
    }
    if (category === 'Projects' || category === 'Career' || category === 'Operations' || category === 'Technical Stack') {
        return 'medium';
    }
    if (/\bcurrent|active|priority|must|critical\b/.test(combined)) {
        return 'high';
    }
    return 'low';
}

function inferConfidence({
    explicitConfidence,
    explicitLabel,
    normalizedLabel,
    value,
    category,
    matchedPattern = false,
    wasStructured = false
}) {
    if (explicitConfidence !== undefined && explicitConfidence !== null) {
        return clampConfidence(explicitConfidence);
    }

    if (matchedPattern) return 0.97;
    if (wasStructured) return 0.94;
    if (explicitLabel && normalizedLabel && !labelsDuplicateValue(normalizedLabel, value)) return 0.88;
    if (category === 'General Context') return 0.72;
    return 0.8;
}

function pickBestValue(left, right) {
    const a = safeString(left);
    const b = safeString(right);
    if (!a) return b;
    if (!b) return a;
    const aKey = normalizeKey(a);
    const bKey = normalizeKey(b);
    if (!aKey) return b;
    if (!bKey) return a;
    if (aKey === bKey) return a.length >= b.length ? a : b;
    if (aKey.includes(bKey)) return a;
    if (bKey.includes(aKey)) return b;
    return a.length >= b.length ? a : b;
}

function buildEducationCluster(value, sourceDate) {
    const cleaned = safeString(value);
    if (!cleaned) return null;
    if (!/\b(bachelor|master|doctorate|phd|b\.?tech|m\.?tech|b\.?s\.?|m\.?s\.?|mba|college|university|institute|school|academy|certificate|certification|diploma)\b/i.test(cleaned)) {
        return null;
    }

    const degreeMatch = cleaned.match(/\b(?:Bachelor(?:'s)?(?: of [^,;]+)?|Master(?:'s)?(?: of [^,;]+)?|Doctor(?:ate)?(?: of [^,;]+)?|PhD(?: in [^,;]+)?|B\.?\s?Tech[^,;]*|M\.?\s?Tech[^,;]*|B\.?\s?S\.?[^,;]*|M\.?\s?S\.?[^,;]*|MBA|Associate(?: of [^,;]+)?|Diploma(?: in [^,;]+)?|Certificate(?: in [^,;]+)?|Certification(?: in [^,;]+)?)\b/i);
    const institutionMatch = cleaned.match(/([A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,6}\s+(?:University|College|Institute|School|Academy))/);

    const degree = safeString(degreeMatch?.[0]);
    let institution = safeString(institutionMatch?.[1]);

    if (!institution && /\b(?:at|from)\b/i.test(cleaned)) {
        institution = safeString(cleaned.split(/\b(?:at|from)\b/i).slice(1).join(' '));
    }

    const children = [];
    if (degree) {
        children.push({
            label: 'Degree',
            value: degree,
            nodeType: 'fact',
            importance: 'medium',
            confidence: 0.95,
            sourceDate,
            children: []
        });
    }
    if (institution) {
        children.push({
            label: 'Institution',
            value: institution,
            nodeType: 'fact',
            importance: 'medium',
            confidence: 0.95,
            sourceDate,
            children: []
        });
    }

    if (children.length < 2) return null;

    return {
        label: institution || 'Education Record',
        value: degree && institution ? `${degree} at ${institution}` : pickBestValue(degree, institution),
        nodeType: 'cluster',
        importance: 'medium',
        confidence: 0.96,
        sourceDate,
        children
    };
}

function sanitizeRawValue(value) {
    const { sourceDate, text } = extractDatePrefix(value);
    return {
        sourceDate,
        value: safeString(text)
    };
}

function buildEntryFromText(rawValue, categoryLabel, explicitLabel, rawMeta = {}) {
    const sanitized = sanitizeRawValue(rawValue);
    let value = sanitized.value;
    const sourceDate = rawMeta.sourceDate || sanitized.sourceDate;
    let label = safeString(explicitLabel);

    if (!value) return null;
    if (isSectionHeader(value)) return null;

    const labeled = !label ? extractLabeledValue(value) : null;
    if (labeled) {
        label = labeled.label;
        value = labeled.value;
    }

    const email = extractEmail(value);
    if (email) {
        return {
            label: 'Email',
            value: email,
            nodeType: 'fact',
            importance: inferImportance(categoryLabel || 'Identity', 'Email', email, rawMeta.importance),
            confidence: inferConfidence({ explicitConfidence: rawMeta.confidence, value: email, category: 'Identity', matchedPattern: true }),
            sourceDate,
            children: []
        };
    }

    const phone = extractPhone(value);
    if (phone) {
        return {
            label: 'Phone',
            value: phone,
            nodeType: 'fact',
            importance: 'low',
            confidence: inferConfidence({ explicitConfidence: rawMeta.confidence, value: phone, category: 'Identity', matchedPattern: true }),
            sourceDate,
            children: []
        };
    }

    const website = extractWebsite(value);
    if (website && /\b(http|www\.|\.[a-z]{2,})/i.test(website)) {
        return {
            label: /linkedin/i.test(website) ? 'LinkedIn' : (label && /portfolio/i.test(label) ? 'Portfolio' : 'Website'),
            value: website,
            nodeType: 'fact',
            importance: 'low',
            confidence: inferConfidence({ explicitConfidence: rawMeta.confidence, value: website, category: 'Identity', matchedPattern: true }),
            sourceDate,
            children: []
        };
    }

    const location = extractLocation(value);
    if (location && (!label || /location|city|based/i.test(label))) {
        return {
            label: 'Location',
            value: location,
            nodeType: 'fact',
            importance: 'medium',
            confidence: inferConfidence({ explicitConfidence: rawMeta.confidence, value: location, category: 'Identity', matchedPattern: true }),
            sourceDate,
            children: []
        };
    }

    const derivedCategory = categoryLabel || inferCategory(label, value);
    const educationCluster = buildEducationCluster(value, sourceDate);
    if (educationCluster && derivedCategory === 'Education') {
        return educationCluster;
    }

    let normalizedLabel = canonicalLabel(label);
    if (!normalizedLabel || isSectionHeader(normalizedLabel) || isLabelTooShort(normalizedLabel) || labelsDuplicateValue(normalizedLabel, value)) {
        normalizedLabel = inferSemanticLabel(value, derivedCategory);
    }

    if (!normalizedLabel || isSectionHeader(normalizedLabel)) return null;

    const cleanedValue = normalizedLabel === 'Email'
        ? extractEmail(value) || value
        : normalizedLabel === 'Phone'
            ? extractPhone(value) || value
            : normalizedLabel === 'Location'
                ? extractLocation(value) || value
                : value;

    return {
        label: normalizedLabel,
        value: cleanedValue,
        nodeType: 'fact',
        importance: inferImportance(derivedCategory, normalizedLabel, cleanedValue, rawMeta.importance),
        confidence: inferConfidence({
            explicitConfidence: rawMeta.confidence,
            explicitLabel: label,
            normalizedLabel,
            value: cleanedValue,
            category: derivedCategory,
            matchedPattern: false,
            wasStructured: !!labeled
        }),
        sourceDate,
        children: []
    };
}

function entrySignature(entry) {
    const childSignature = Array.isArray(entry.children) && entry.children.length > 0
        ? entry.children.map((child) => `${normalizeKey(child.label)}::${normalizeKey(child.value || '')}`).join('|')
        : '';
    return `${normalizeKey(entry.label)}::${normalizeKey(entry.value || '')}::${childSignature}`;
}

function compareEntries(left, right) {
    const leftRank = IMPORTANCE_RANK[normalizeImportance(left.importance, 'medium')] || 0;
    const rightRank = IMPORTANCE_RANK[normalizeImportance(right.importance, 'medium')] || 0;
    if (leftRank !== rightRank) return rightRank - leftRank;

    const leftType = left.nodeType === 'cluster' ? 0 : 1;
    const rightType = right.nodeType === 'cluster' ? 0 : 1;
    if (leftType !== rightType) return leftType - rightType;

    return safeString(left.label).localeCompare(safeString(right.label));
}

function mergeEntryCollections(existingEntries = [], incomingEntries = []) {
    const map = new Map();

    for (const rawEntry of [...existingEntries, ...incomingEntries]) {
        const signature = entrySignature(rawEntry);
        if (!signature) continue;

        if (!map.has(signature)) {
            map.set(signature, {
                ...rawEntry,
                children: Array.isArray(rawEntry.children) ? rawEntry.children.slice() : []
            });
            continue;
        }

        const current = map.get(signature);
        current.value = pickBestValue(current.value, rawEntry.value);
        current.importance = normalizeImportance(
            IMPORTANCE_RANK[normalizeImportance(current.importance, 'medium')] >= IMPORTANCE_RANK[normalizeImportance(rawEntry.importance, 'medium')]
                ? current.importance
                : rawEntry.importance,
            'medium'
        );
        current.confidence = Math.max(clampConfidence(current.confidence), clampConfidence(rawEntry.confidence));
        current.sourceDate = current.sourceDate || rawEntry.sourceDate;
        current.nodeType = current.nodeType === 'cluster' || rawEntry.nodeType === 'cluster' ? 'cluster' : 'fact';
        current.children = mergeEntryCollections(current.children, rawEntry.children);
    }

    return Array.from(map.values()).sort(compareEntries);
}

function postProcessCategoryEntries(categoryLabel, entries) {
    const normalizedEntries = mergeEntryCollections([], entries);

    if (categoryLabel === 'Education' && normalizedEntries.length >= 2 && !normalizedEntries.some((entry) => entry.nodeType === 'cluster')) {
        const structured = normalizedEntries.filter((entry) => ['Degree', 'Institution', 'Education Detail'].includes(entry.label));
        if (structured.length >= 2) {
            const degree = structured.find((entry) => entry.label === 'Degree')?.value || '';
            const institution = structured.find((entry) => entry.label === 'Institution')?.value || '';
            const summary = degree && institution ? `${degree} at ${institution}` : pickBestValue(degree, institution);
            const grouped = {
                label: institution || 'Formal Education',
                value: summary,
                nodeType: 'cluster',
                importance: 'medium',
                confidence: Math.max(...structured.map((entry) => clampConfidence(entry.confidence, 0.85))),
                sourceDate: structured.find((entry) => entry.sourceDate)?.sourceDate,
                children: structured
            };
            const remainder = normalizedEntries.filter((entry) => !structured.includes(entry));
            return mergeEntryCollections(remainder, [grouped]);
        }
    }

    return normalizedEntries;
}

function normalizeEntry(rawEntry, categoryLabel, fallbackIndex = 0) {
    if (!rawEntry) return null;

    if (typeof rawEntry === 'string') {
        return buildEntryFromText(rawEntry, categoryLabel, '', { confidence: 0.72 });
    }

    const rawChildren = Array.isArray(rawEntry.children) ? rawEntry.children : [];
    const explicitLabel = safeString(rawEntry.label);
    const sanitized = sanitizeRawValue(rawEntry.value || explicitLabel);
    const value = sanitized.value;
    const sourceDate = rawEntry.sourceDate || sanitized.sourceDate;
    const nodeType = rawChildren.length > 0 ? 'cluster' : (rawEntry.nodeType === 'cluster' ? 'cluster' : 'fact');

    if (rawChildren.length > 0) {
        let normalizedLabel = canonicalLabel(explicitLabel);
        if (!normalizedLabel || isSectionHeader(normalizedLabel) || isLabelTooShort(normalizedLabel) || labelsDuplicateValue(normalizedLabel, value)) {
            normalizedLabel = inferSemanticLabel(value || explicitLabel || `Entry ${fallbackIndex + 1}`, categoryLabel);
        }
        if (!normalizedLabel || isSectionHeader(normalizedLabel)) return null;

        const normalizedChildren = rawChildren
            .map((child, childIndex) => normalizeEntry(child, categoryLabel, childIndex))
            .filter(Boolean);

        if (normalizedChildren.length === 0 && !value) return null;

        return {
            label: normalizedLabel,
            value: value || undefined,
            nodeType,
            importance: inferImportance(categoryLabel, normalizedLabel, value, rawEntry.importance),
            confidence: inferConfidence({
                explicitConfidence: rawEntry.confidence,
                explicitLabel,
                normalizedLabel,
                value,
                category: categoryLabel,
                wasStructured: true
            }),
            sourceDate,
            children: mergeEntryCollections([], normalizedChildren)
        };
    }

    return buildEntryFromText(value || explicitLabel, categoryLabel, explicitLabel, {
        importance: rawEntry.importance,
        confidence: rawEntry.confidence,
        sourceDate
    });
}

function normalizePlan(plan) {
    const rawCategories = Array.isArray(plan?.categories) ? plan.categories : [];
    const categories = [];

    for (const rawCategory of rawCategories) {
        const categoryLabel = normalizeCategoryLabel(rawCategory?.label, 'General Context');
        const entriesSource = Array.isArray(rawCategory?.entries)
            ? rawCategory.entries
            : Array.isArray(rawCategory?.facts)
                ? rawCategory.facts
                : [];

        const entries = entriesSource
            .map((entry, entryIndex) => normalizeEntry(entry, categoryLabel, entryIndex))
            .filter(Boolean);

        const processedEntries = postProcessCategoryEntries(categoryLabel, entries);
        if (processedEntries.length === 0) continue;
        categories.push({ label: categoryLabel, entries: processedEntries });
    }

    return {
        categories: categories.sort((left, right) => {
            const leftIndex = CATEGORY_ORDER.indexOf(left.label);
            const rightIndex = CATEGORY_ORDER.indexOf(right.label);
            return (leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex) - (rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex);
        })
    };
}

function flattenNodeToEntry(node) {
    if (!node || typeof node !== 'object' || node.id === 'root') return null;

    const children = Array.isArray(node.children) ? node.children.map(flattenNodeToEntry).filter(Boolean) : [];
    const nodeType = node.nodeType || (children.length > 0 ? 'cluster' : 'fact');

    if (!safeString(node.label)) return null;

    return {
        label: node.label,
        value: safeString(node.value) || undefined,
        source: safeString(node.source) || undefined,
        sourceDate: safeString(node.sourceDate) || undefined,
        nodeType,
        importance: normalizeImportance(node.importance, nodeType === 'fact' ? 'medium' : 'high'),
        confidence: clampConfidence(node.confidence, nodeType === 'fact' ? 0.84 : 0.88),
        children: mergeEntryCollections([], children)
    };
}

function flattenTreeToPlan(tree) {
    if (!tree || tree.id !== 'root' || !Array.isArray(tree.children)) {
        return { categories: [] };
    }

    const categories = tree.children
        .map((categoryNode) => {
            const label = normalizeCategoryLabel(categoryNode?.label, 'General Context');
            const entries = Array.isArray(categoryNode?.children)
                ? categoryNode.children.map(flattenNodeToEntry).filter(Boolean)
                : [];
            if (entries.length === 0) return null;
            return { label, entries: postProcessCategoryEntries(label, entries) };
        })
        .filter(Boolean);

    return normalizePlan({ categories });
}

function buildFallbackPlan(memories) {
    const categoryMap = new Map();

    for (const rawMemory of memories || []) {
        const memory = safeString(rawMemory);
        if (!memory || isSectionHeader(memory)) continue;
        const explicit = extractLabeledValue(memory);
        const categoryLabel = inferCategory(explicit?.label || '', explicit?.value || memory);
        const entry = buildEntryFromText(explicit?.value || memory, categoryLabel, explicit?.label || '', { confidence: 0.78 });
        if (!entry) continue;

        const key = categoryLabel.toLowerCase();
        if (!categoryMap.has(key)) {
            categoryMap.set(key, { label: categoryLabel, entries: [] });
        }
        categoryMap.get(key).entries.push(entry);
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
                categoryMap.set(key, { label: category.label, entries: [] });
            }
            const current = categoryMap.get(key);
            current.entries = mergeEntryCollections(current.entries, category.entries);
        }
    }

    return normalizePlan({ categories: Array.from(categoryMap.values()) });
}

function aggregateCategoryImportance(entries) {
    return entries.some((entry) => normalizeImportance(entry.importance) === 'high')
        ? 'high'
        : entries.some((entry) => normalizeImportance(entry.importance) === 'medium')
            ? 'medium'
            : 'low';
}

function averageConfidence(entries) {
    if (!entries.length) return 0.8;
    return entries.reduce((sum, entry) => sum + clampConfidence(entry.confidence), 0) / entries.length;
}

function buildTreeFromEntries(entries, categoryLabel, lineage = []) {
    return entries.map((entry, entryIndex) => {
        const slugBase = slugify(`${lineage.join('-')}-${entry.label}`, `${lineage.length + 1}-${entryIndex + 1}`);
        const children = Array.isArray(entry.children) && entry.children.length > 0
            ? buildTreeFromEntries(entry.children, categoryLabel, [...lineage, slugBase])
            : [];

        return {
            id: `node-${slugBase}-${entryIndex + 1}`,
            label: entry.label,
            value: entry.value,
            source: entry.source || 'memory',
            sourceDate: entry.sourceDate,
            nodeType: entry.nodeType || (children.length > 0 ? 'cluster' : 'fact'),
            importance: normalizeImportance(entry.importance, categoryLabel === 'Preferences' ? 'high' : 'medium'),
            confidence: clampConfidence(entry.confidence, children.length > 0 ? 0.88 : 0.8),
            children
        };
    });
}

function buildTreeFromPlan(plan) {
    const normalized = normalizePlan(plan);
    return {
        id: 'root',
        label: 'UserMap',
        nodeType: 'root',
        importance: 'high',
        confidence: 0.99,
        children: normalized.categories.map((category, categoryIndex) => {
            const entries = postProcessCategoryEntries(category.label, category.entries);
            return {
                id: `category-${slugify(category.label, `category-${categoryIndex + 1}`)}`,
                label: category.label,
                nodeType: 'category',
                importance: aggregateCategoryImportance(entries),
                confidence: clampConfidence(averageConfidence(entries), 0.85),
                children: buildTreeFromEntries(entries, category.label, [slugify(category.label)])
            };
        })
    };
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
            // continue
        }
    }

    return null;
}

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

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return respond(event, 200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { memories, existingTree } = body;

        if (!Array.isArray(memories)) {
            return respond(event, 400, { error: 'Missing memories array' });
        }

        console.log(`USERMAP-CONSOLIDATE: userId=${userId}, memories=${memories.length}`);

        const normalizedMemories = memories
            .map((memory) => safeString(memory))
            .filter(Boolean)
            .filter((memory) => !isSectionHeader(memory))
            .slice(0, 500);

        if (normalizedMemories.length === 0) {
            return respond(event, 400, { error: 'No valid memories to consolidate' });
        }

        const memoryList = normalizedMemories.map((memory, index) => `${index + 1}. ${memory}`).join('\n');
        let userMessage = `Raw facts:\n${memoryList}`;
        if (existingTree) {
            userMessage += `\n\nExisting Tree:\n${JSON.stringify(existingTree, null, 2)}`;
            userMessage += '\n\nPlease merge the new facts into this existing structure.';
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
        } catch (error) {
            console.warn('USERMAP-CONSOLIDATE: Failed to normalize structured plan:', error.message);
        }

        const existingPlan = flattenTreeToPlan(existingTree);
        const fallbackPlan = buildFallbackPlan(normalizedMemories);
        const planToUse = generatedPlan?.categories?.length
            ? mergePlans(existingPlan, generatedPlan, fallbackPlan)
            : mergePlans(existingPlan, fallbackPlan);
        const tree = buildTreeFromPlan(planToUse);

        if (!tree || tree.id !== 'root' || !Array.isArray(tree.children)) {
            throw new Error('Failed to generate valid UserMap tree');
        }

        const usedFallback = !generatedPlan?.categories?.length;
        console.log(`USERMAP-CONSOLIDATE: ✅ Tree generated with ${tree.children.length} categories${usedFallback ? ' (fallback-assisted)' : ''}`);

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
