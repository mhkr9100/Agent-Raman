/**
 * RamN AI — Auth Module
 * 
 * Validates Cognito JWT tokens and extracts user information.
 * Used as a shared utility by all Lambda functions.
 */

import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Configure these from env if available
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_R2j2oAqLJ';
const CLIENT_ID = process.env.CLIENT_ID || '77205lmtu8fg6t1s3sgcidf7p9';

// Create the verifier
const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    tokenUse: 'access',
    clientId: CLIENT_ID,
});

/**
 * Validates the Authorization header and returns user info
 * @param {string} authHeader e.g., "Bearer <token>"
 * @returns {Promise<{userId: string, email?: string}>}
 */
export async function validateToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('AUTH: Missing or invalid Authorization header');
        throw new Error('Unauthorized: Missing token');
    }

    const token = authHeader.substring(7);

    try {
        const payload = await verifier.verify(token);
        console.log(`AUTH: ✅ Token verified for sub: ${payload.sub}`);

        return {
            userId: payload.sub,
            email: payload.email,
            username: payload.username || payload['cognito:username']
        };
    } catch (err) {
        console.error('AUTH: ❌ Token validation failed:', err.message);
        throw new Error('Unauthorized: Invalid token');
    }
}

/**
 * Helper to wrap handler with auth check
 * (Wait, we can just call validateToken directly in the handlers for more control)
 */
