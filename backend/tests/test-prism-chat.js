/**
 * Test: backend/functions/prism-chat/index.js
 * 
 * Tests all three Prism modes (ask, route, create) by simulating Lambda events.
 * Uses real Vertex AI and real DynamoDB.
 * 
 * Run: GCP_SERVICE_ACCOUNT_KEY_FILE="path/to/key.json" AWS_REGION=us-east-1 node backend/tests/test-prism-chat.js
 */

import { handler } from '../functions/prism-chat/index.js';

function makeEvent(body) {
    return {
        httpMethod: 'POST',
        body: JSON.stringify(body)
    };
}

async function runTest(testName, body) {
    console.log(`\n▸ ${testName}`);
    console.log('─'.repeat(50));

    try {
        const event = makeEvent(body);
        const result = await handler(event);
        const parsed = JSON.parse(result.body);

        console.log(`  Status: ${result.statusCode}`);
        console.log(`  Mode: ${parsed.mode}`);
        console.log(`  ConversationId: ${parsed.conversationId}`);

        if (parsed.mode === 'ask') {
            console.log(`  Response: "${parsed.response?.substring(0, 150)}..."`);
            console.log(`  SuggestMode: ${parsed.suggestMode}`);
        } else if (parsed.mode === 'route') {
            console.log(`  Recommendation: ${JSON.stringify(parsed.recommendation, null, 2)}`);
        } else if (parsed.mode === 'create') {
            const resp = parsed.response;
            console.log(`  BlueprintReady: ${resp.blueprintReady}`);
            if (resp.blueprintReady) {
                console.log(`  Agent Name: ${resp.agentName}`);
                console.log(`  Tools: ${resp.tools?.join(', ')}`);
                console.log(`  Model: ${resp.model?.modelId}`);
            } else {
                console.log(`  Message: "${resp.message?.substring(0, 150)}..."`);
                console.log(`  Questions: ${resp.questionsAsked?.join(', ')}`);
            }
        }

        const passed = result.statusCode === 200;
        console.log(`\n  ${passed ? '✅' : '❌'} ${testName} — ${passed ? 'PASSED' : 'FAILED'}`);
        return { passed, conversationId: parsed.conversationId };
    } catch (error) {
        console.error(`  ❌ ${testName} — ERROR: ${error.message}`);
        return { passed: false };
    }
}

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — Prism Chat Lambda Test');
    console.log('═══════════════════════════════════════════');

    const testUserId = 'test-user-001';

    // Test 1: ASK mode
    const askResult = await runTest('ASK MODE — Simple question', {
        userId: testUserId,
        message: 'What is machine learning?',
        mode: 'ask',
        conversationId: null
    });

    // Test 2: ROUTE mode
    await runTest('ROUTE MODE — Model recommendation', {
        userId: testUserId,
        message: 'I need to analyze a 500-page legal document and extract key clauses',
        mode: 'route',
        conversationId: null
    });

    // Test 3: CREATE mode
    await runTest('CREATE MODE — Agent blueprint', {
        userId: testUserId,
        message: 'I need an agent that monitors our competitors websites daily and sends me a summary email of any changes or news',
        mode: 'create',
        conversationId: null
    });

    console.log('\n═══════════════════════════════════════════');
    console.log('  All Prism tests completed!');
    console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
