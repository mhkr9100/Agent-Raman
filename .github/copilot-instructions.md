# RamN AI — Copilot Instructions

## Architecture
- **Frontend:** React + TypeScript + Vite (deployed to Vercel/static hosting)
- **Backend:** AWS SAM (API Gateway + Lambda + DynamoDB)
- **AI Providers:** Google Vertex AI (Gemini), AWS Bedrock (Claude)
- **Auth:** AWS Cognito (JWT validation via `aws-jwt-verify`)

## Critical Rules
1. **DO NOT** simulate, mock, or hardcode ANY responses
2. **DO NOT** use `setTimeout` to fake loading states
3. **DO NOT** return example/dummy/placeholder data
4. **ALL** data must come from real DynamoDB calls via `backend/shared/dynamo.js`
5. **ALL** AI responses must come from real Vertex AI calls via `backend/shared/vertex-ai.js`
6. If a database table is empty, return empty array `[]`
7. If an API call fails, return the real error message (but sanitize internal details)
8. **DO NOT** put business logic in frontend code — all logic goes in Lambda functions
9. **DO NOT** create UI components unless explicitly requested
10. Test every function with real data before considering it complete

## Security Rules
- Never hardcode AWS credentials, Cognito pool IDs, or API keys in source code
- Always use `validateToken()` from `backend/shared/auth.js` for authentication
- Always use `buildCorsHeaders()` from `backend/shared/cors.js` for CORS (JS Lambdas) or `backend/src/security.ts` (TS Lambdas)
- Never expose `error.message` directly to clients in production — use sanitized messages
- Never log PII (userId, email) to CloudWatch — truncate or hash if needed
- All frontend API calls go through `services/apiV2.ts` with proper auth headers

## File Structure
- `backend/functions/` — Individual Lambda function handlers (plain JS)
- `backend/shared/` — Shared utilities (dynamo.js, auth.js, cors.js, vertex-ai.js, rate-limit.js)
- `backend/src/` — TypeScript Lambda handlers (compiled)
- `backend/template.yaml` — AWS SAM infrastructure definition
- `components/` — React UI components
- `hooks/` — React custom hooks
- `services/` — Frontend service layer (API calls, DB, auth)

## DynamoDB Tables
- `RamN_Agents` (PK: agentId, SK: userId)
- `RamN_Conversations` (PK: conversationId, SK: timestamp)
- `RamN_ToolRegistry` (PK: toolId)
- `RamN_ModelRegistry` (PK: modelId)
- `RamN_SpecialAgents` (PK: templateId)
- `RamN_UserMap` (PK: userId)
- `RamN_Documents` (PK: docId, SK: userId)

## Beta Limits
- 10 requests/hour per user (configurable via `HOURLY_REQUEST_LIMIT` env var)
- Max 5 agents per account (configurable via `MAX_AGENTS_PER_USER` env var)
- Output token caps: Flash-Lite=2048, Flash=4096, Pro=8192
