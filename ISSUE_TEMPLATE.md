## 🔴 Severity: CRITICAL

## Finding ID: C-01

## Summary
Real AWS Cognito User Pool ID and Client ID are hardcoded as fallback values in two files. Anyone who reads this repo can target the Cognito pool for brute-force attacks, account enumeration, or unauthorized registration.

## Affected Files
- `backend/shared/auth.js` — Lines 11-12
- `backend/src/security.ts` — Lines 5-6

## Evidence

**backend/shared/auth.js:**
```javascript
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_R2j2oAqLJ';
const CLIENT_ID = process.env.CLIENT_ID || '77205lmtu8fg6t1s3sgcidf7p9';
```

**backend/src/security.ts:**
```typescript
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_R2j2oAqLJ';
const CLIENT_ID = process.env.CLIENT_ID || '77205lmtu8fg6t1s3sgcidf7p9';
```

## Risk
- Exposes real AWS Cognito User Pool ID and Client ID to the public
- Enables targeted brute-force attacks against the Cognito pool
- Allows account enumeration or unauthorized registration attempts

## Remediation

Remove the hardcoded fallback values and require the env vars to be set:

```typescript
const USER_POOL_ID = process.env.USER_POOL_ID;
const CLIENT_ID = process.env.CLIENT_ID;

if (!USER_POOL_ID || !CLIENT_ID) {
    throw new Error('FATAL: USER_POOL_ID and CLIENT_ID must be set as environment variables.');
}
```

Apply the same fix in both `backend/shared/auth.js` and `backend/src/security.ts`.

Ensure the SAM template (`backend/template.yaml`) passes these env vars to every Lambda function that uses auth.

## Checklist
- [ ] Remove hardcoded fallback in `backend/shared/auth.js`
- [ ] Remove hardcoded fallback in `backend/src/security.ts`
- [ ] Verify all Lambda functions receive `USER_POOL_ID` and `CLIENT_ID` via environment variables in `template.yaml`
- [ ] Rotate the Cognito credentials (since they were exposed in a public repo)
- [ ] Verify the application still works after the change
