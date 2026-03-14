import { listTools, listModels } from '../shared/dynamo.js';

async function testDynamo() {
    console.log('--- Testing DynamoDB Connection via dynamo.js ---');
    try {
        const tools = await listTools();
        console.log(`Tools found: ${tools.length}`);

        const models = await listModels();
        console.log(`Models found: ${models.length}`);

        if (tools.length > 0 && models.length > 0) {
            console.log('✅ DynamoDB Test Passed!');
        } else {
            console.log('❌ DynamoDB Test Failed: Tables might be empty.');
        }
    } catch (e) {
        console.error('❌ DynamoDB Test Failed:', e.message);
    }
}

testDynamo();
