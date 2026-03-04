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

const STRUCTURING_PROMPT = `You are a Context Structurer. Given a list of raw memory facts about a user, organize them into a clean hierarchical JSON tree for the UserMap.

RULES:
1. Group related facts under logical parent categories (e.g., "Business Goals", "Technical Stack", "Infrastructure", "Preferences")
2. Merge duplicate or similar facts into single nodes
3. Use concise, professional labels for nodes
4. Each leaf node should have a "value" field with the actual information
5. If an 'existingTree' is provided, merge new facts into it seamlessly.

Output ONLY valid JSON matching this schema:
{
  "id": "root",
  "label": "UserMap",
  "children": [
    {
      "id": "category-id",
      "label": "Category Name",
      "children": [
        { "id": "fact-id", "label": "Fact Label", "value": "The actual fact content", "children": [] }
      ]
    }
  ]
}

No preamble, no markdown blocks unless requested. Just pure JSON.`;

// ─── CORS Headers ────────────────────────────────────────────────

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Content-Type': 'application/json'
};

function respond(statusCode, body) {
    return { statusCode, headers: CORS, body: JSON.stringify(body) };
}

// ─── Handler ─────────────────────────────────────────────────────

export const handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return respond(200, {});
    }

    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        const auth = await validateToken(authHeader);
        const userId = auth.userId;

        const body = JSON.parse(event.body || '{}');
        const { memories, existingTree } = body;

        if (!memories || !Array.isArray(memories)) return respond(400, { error: 'Missing memories array' });

        console.log(`USERMAP-CONSOLIDATE: userId=${userId}, memories=${memories.length}`);

        const memoryList = memories.map((m, i) => `${i + 1}. ${m}`).join('\n');

        let userMessage = `Raw facts:\n${memoryList}`;
        if (existingTree) {
            userMessage += `\n\nExisting Tree:\n${JSON.stringify(existingTree, null, 2)}`;
            userMessage += `\n\nPlease merge the new facts into this existing structure.`;
        }

        // Use gemini-2.0-flash-lite for structuring to save quota
        const aiResult = await callAI({
            systemPrompt: STRUCTURING_PROMPT,
            userMessage,
            modelName: 'gemini-2.0-flash-lite',
            temperature: 0.1
        });

        // Parse JSON from response
        let tree = null;
        const jsonMatch = aiResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                tree = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn('USERMAP-CONSOLIDATE: Failed to parse tree JSON:', e.message);
            }
        }

        if (!tree) throw new Error('Failed to generate valid UserMap tree');

        console.log(`USERMAP-CONSOLIDATE: ✅ Tree generated with ${tree.children.length} categories`);

        return respond(200, tree);

    } catch (error) {
        console.error('USERMAP-CONSOLIDATE: ❌ Error:', error);
        return respond(500, {
            error: 'Failed to consolidate user map',
            message: error.message || 'Unknown error'
        });
    }
};
