import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME || 'RamN-Entities';

// The tools we want to remove from the db
const TOOLS_TO_REMOVE = [
    'sendEmail',
    'readCalendar',
    'calendarific',
    'executeCode',
    'slack_webhook',
    'slack-notify'
];

async function removeTools() {
    console.log(`Starting cleanup of ${TOOLS_TO_REMOVE.length} tools from ${TABLE_NAME}...`);

    for (const toolId of TOOLS_TO_REMOVE) {
        try {
            const pk = `TOOL#${toolId}`;
            const sk = pk;

            await docClient.send(new DeleteCommand({
                TableName: TABLE_NAME,
                Key: { PK: pk, SK: sk }
            }));

            console.log(`✅ Deleted tool: ${toolId}`);
        } catch (error) {
            console.error(`❌ Failed to delete tool ${toolId}:`, error.message);
        }
    }

    console.log('Cleanup complete.');
}

removeTools().catch(console.error);
