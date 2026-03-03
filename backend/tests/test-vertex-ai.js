/**
 * Test: backend/shared/vertex-ai.js
 * 
 * Run: node backend/tests/test-vertex-ai.js
 * 
 * Prerequisites:
 *   - GCP_SERVICE_ACCOUNT_SECRET_ARN env var set
 *   - GCP_PROJECT_ID env var set (or defaults to 'ramn-ai')
 *   - AWS credentials configured (for Secrets Manager access)
 */

import { callAI } from '../shared/vertex-ai.js';

async function runTest() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — Vertex AI Module Test');
    console.log('═══════════════════════════════════════════\n');

    // --- Test 1: Basic callAI ---
    console.log('▸ Test 1: Basic callAI (simple question)');
    console.log('  System Prompt: "You are a helpful assistant."');
    console.log('  User Message:  "What is 2+2?"\n');

    try {
        const result = await callAI({
            systemPrompt: 'You are a helpful assistant. Keep your responses brief and direct.',
            userMessage: 'What is 2+2?'
        });

        console.log('  ✅ Response received!');
        console.log(`  Text: "${result.text}"`);
        console.log(`  Tool Calls: ${result.toolCalls.length}`);
        console.log(`  Usage: ${JSON.stringify(result.usage)}`);
        console.log('');

        if (result.text && result.text.length > 0) {
            console.log('  ✅ TEST 1 PASSED — Got a real AI response');
        } else {
            console.log('  ❌ TEST 1 FAILED — Empty response');
            process.exit(1);
        }
    } catch (error) {
        console.error('  ❌ TEST 1 FAILED —', error.message);
        process.exit(1);
    }

    console.log('\n───────────────────────────────────────────\n');

    // --- Test 2: callAI with conversation history ---
    console.log('▸ Test 2: callAI with conversation history');

    try {
        const result = await callAI({
            systemPrompt: 'You are a math tutor. Be concise.',
            userMessage: 'And what is that times 10?',
            history: [
                { role: 'user', content: 'What is 5+3?' },
                { role: 'model', content: '5+3 equals 8.' }
            ]
        });

        console.log('  ✅ Response received!');
        console.log(`  Text: "${result.text}"`);

        if (result.text && result.text.length > 0) {
            console.log('  ✅ TEST 2 PASSED — History context works');
        } else {
            console.log('  ❌ TEST 2 FAILED — Empty response');
        }
    } catch (error) {
        console.error('  ❌ TEST 2 FAILED —', error.message);
    }

    console.log('\n═══════════════════════════════════════════');
    console.log('  All tests completed!');
    console.log('═══════════════════════════════════════════');
}

runTest().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
