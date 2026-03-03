/**
 * RamN AI — Memory Extract Lambda
 * 
 * Analyzes a conversation and extracts key facts about the user.
 * 
 * POST /api/memory/extract
 * Body: { userId, messages }
 */

import { callAI } from '../../shared/vertex-ai.js';
import { validateToken } from '../../shared/auth.js';

const EXTRACTION_PROMPT = `Extract key facts about the user from this conversation. 
Each fact should be a standalone, concise sentence.
Exclude metadata, timestamps, or system info.
Focus ONLY on user preferences, goals, technical choices, and identity.

Return ONLY a JSON array of strings. Example: ["User prefers React", "User is building a fintech app"].
If no new facts found, return [].`;

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
        // 1. Auth check
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (!authHeader) return respond(401, { error: 'Unauthorized' });

        // (Optional: validateToken if we want to be strict, but keeping it simple for now as per prism-chat)
        // const auth = await validateToken(authHeader);

        // 2. Parse body
        const body = JSON.parse(event.body || '{}');
        const { userId, messages } = body;

        if (!userId) return respond(400, { error: 'Missing userId' });
        if (!messages || !Array.isArray(messages)) return respond(400, { error: 'Missing messages array' });

        console.log(`MEMORY-EXTRACT: userId=${userId}, messages=${messages.length}`);

        // 3. Prepare conversation text for extraction
        const chatText = messages
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n');

        // 4. Call Vertex AI
        // Use flash-lite for simple extraction to save quota
        const aiResult = await callAI({
            systemPrompt: EXTRACTION_PROMPT,
            userMessage: `Analyze this conversation and extract facts:\n\n${chatText}`,
            modelName: 'gemini-2.0-flash-lite',
            temperature: 0.1
        });

        // 5. Parse JSON array from response
        let facts = [];
        const jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            try {
                facts = JSON.parse(jsonMatch[0]);
            } catch (e) {
                console.warn('MEMORY-EXTRACT: Failed to parse facts JSON:', e.message);
            }
        }

        console.log(`MEMORY-EXTRACT: ✅ Extracted ${facts.length} facts`);

        return respond(200, { facts });

    } catch (error) {
        console.error('MEMORY-EXTRACT: ❌ Error:', error);
        return respond(500, {
            error: 'Failed to extract memory',
            message: error.message || 'Unknown error'
        });
    }
};
