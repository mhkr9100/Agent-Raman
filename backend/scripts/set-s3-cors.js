/**
 * Apply CORS policy for RamN knowledge-base S3 bucket.
 *
 * Run:
 *   node backend/scripts/set-s3-cors.js
 *
 * Optional env:
 *   AWS_REGION=us-east-2
 *   S3_BUCKET_NAME=ramn-ai-agent-knowledge-base
 */

import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3';

const REGION = process.env.S3_BUCKET_REGION || process.env.AWS_REGION || 'us-east-2';
const BUCKET = process.env.S3_BUCKET_NAME || 'ramn-ai-agent-knowledge-base';

const corsRules = [
    {
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'PUT', 'HEAD'],
        AllowedOrigins: [
            'https://www.ramnai.com',
            'https://ramnai.com',
            'http://localhost:3000',
            'http://localhost:5173'
        ],
        ExposeHeaders: ['ETag', 'x-amz-request-id'],
        MaxAgeSeconds: 3000
    }
];

async function main() {
    const client = new S3Client({ region: REGION });
    await client.send(new PutBucketCorsCommand({
        Bucket: BUCKET,
        CORSConfiguration: {
            CORSRules: corsRules
        }
    }));

    console.log(`✅ Applied S3 CORS to ${BUCKET} in ${REGION}`);
}

main().catch((error) => {
    console.error('❌ Failed to apply S3 CORS:', error);
    process.exitCode = 1;
});
