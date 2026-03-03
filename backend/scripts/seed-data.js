/**
 * RamN AI — Seed Data Script
 * 
 * Populates DynamoDB tables with initial data:
 *   - RamN_ToolRegistry    (7 tools)
 *   - RamN_ModelRegistry   (3 models)
 *   - RamN_SpecialAgents   (3 templates)
 * 
 * Uses DynamoDB DocumentClient directly.
 * Checks if items exist before inserting (idempotent).
 * 
 * Run: node backend/scripts/seed-data.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const REGION = process.env.AWS_REGION || 'us-east-1';
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true }
});

// ─── Helper: put if not exists ───────────────────────────────────

async function putIfNotExists(tableName, keyFields, item) {
    // Build key from keyFields
    const key = {};
    for (const field of keyFields) {
        key[field] = item[field];
    }

    // Check if already exists
    const existing = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: key
    }));

    if (existing.Item) {
        console.log(`  ⏭️  ${tableName} → ${JSON.stringify(key)} — already exists, skipping`);
        return 'skipped';
    }

    // Insert with timestamp
    await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
            ...item,
            createdAt: new Date().toISOString()
        }
    }));
    console.log(`  ✅ ${tableName} → ${item.name || item.toolId || item.modelId || item.templateId}`);
    return 'created';
}

// ══════════════════════════════════════════════════════════════════
//  SEED 1: RamN_ToolRegistry
// ══════════════════════════════════════════════════════════════════

const TOOLS = [
    {
        toolId: 'web-search',
        name: 'Web Search',
        type: 'plugin',
        category: 'research',
        description: 'Search the internet for current info',
        capabilities: ['search', 'fetch_url'],
        status: 'active'
    },
    {
        toolId: 'slack-notify',
        name: 'Slack Notifications',
        type: 'api',
        category: 'communication',
        description: 'Send messages to Slack channels',
        capabilities: ['send_message', 'create_channel'],
        status: 'active'
    },
    {
        toolId: 'email-sender',
        name: 'Email Sender',
        type: 'api',
        category: 'communication',
        description: 'Send emails via AWS SES',
        capabilities: ['send_email', 'send_template'],
        status: 'active'
    },
    {
        toolId: 'doc-reader',
        name: 'Document Reader',
        type: 'plugin',
        category: 'data',
        description: 'Read and parse PDF, DOCX, TXT files',
        capabilities: ['parse_pdf', 'parse_docx', 'extract_text'],
        status: 'active'
    },
    {
        toolId: 'data-analyzer',
        name: 'Data Analyzer',
        type: 'plugin',
        category: 'analysis',
        description: 'Analyze CSV and JSON data sets',
        capabilities: ['csv_analysis', 'statistics', 'charting'],
        status: 'active'
    },
    {
        toolId: 'calendar-api',
        name: 'Calendar Manager',
        type: 'api',
        category: 'productivity',
        description: 'Manage Google Calendar events',
        capabilities: ['create_event', 'list_events', 'update'],
        status: 'active'
    },
    {
        toolId: 'code-executor',
        name: 'Code Executor',
        type: 'plugin',
        category: 'development',
        description: 'Execute Python and JavaScript code safely',
        capabilities: ['run_python', 'run_javascript'],
        status: 'active'
    }
];

// ══════════════════════════════════════════════════════════════════
//  SEED 2: RamN_ModelRegistry
// ══════════════════════════════════════════════════════════════════

const MODELS = [
    {
        modelId: 'gemini-2.0-flash',
        provider: 'google',
        name: 'Gemini 2.0 Flash',
        strengths: 'Fast responses, good for general tasks, cost efficient, large context window',
        contextWindow: 1000000,
        costTier: 'low',
        bestFor: ['general', 'chat', 'quick-tasks', 'summarization'],
        temperature_default: 0.3
    },
    {
        modelId: 'gemini-2.5-pro',
        provider: 'google',
        name: 'Gemini 2.5 Pro',
        strengths: 'Deep reasoning, code generation, complex analysis, large context for document processing',
        contextWindow: 1000000,
        costTier: 'high',
        bestFor: ['reasoning', 'code', 'analysis', 'research', 'complex-tasks'],
        temperature_default: 0.2
    },
    {
        modelId: 'gemini-2.0-flash-lite',
        provider: 'google',
        name: 'Gemini 2.0 Flash Lite',
        strengths: 'Fastest, cheapest, simple tasks only',
        contextWindow: 500000,
        costTier: 'lowest',
        bestFor: ['simple-chat', 'classification', 'short-answers'],
        temperature_default: 0.5
    }
];

// ══════════════════════════════════════════════════════════════════
//  SEED 3: RamN_SpecialAgents
// ══════════════════════════════════════════════════════════════════

const SPECIAL_AGENTS = [
    {
        templateId: 'research-agent',
        name: 'Research Agent',
        description: 'Deep research assistant that finds, analyzes, and summarizes information on any topic',
        icon: '🔬',
        systemPromptTemplate: `You are a Research Agent specializing in {{DOMAIN}}.

Your goal is to provide comprehensive, accurate research on {{TOPIC}}.

## RULES
### YOU MUST:
- Always cite or reference your sources
- Present findings in clear structured format
- Distinguish between facts, data, and opinions
- Provide multiple perspectives when relevant

### YOU MUST NOT:
- Make up sources or statistics
- Present speculation as fact
- Skip over contradicting evidence

### SAFETY:
- If unsure about accuracy, explicitly say so
- Recommend human verification for critical claims

### OUTPUT FORMAT:
Structured report with: Summary, Key Findings, Details, Sources, Recommendations`,
        tools: ['web-search', 'doc-reader'],
        model: { provider: 'google', modelId: 'gemini-2.5-pro', temperature: 0.3 },
        contextSlots: ['DOMAIN', 'TOPIC'],
        category: 'research'
    },
    {
        templateId: 'writing-agent',
        name: 'Writing Assistant',
        description: 'Professional content writer that creates blog posts, emails, reports, and marketing copy',
        icon: '✍️',
        systemPromptTemplate: `You are a Writing Agent creating {{CONTENT_TYPE}} for {{AUDIENCE}}.

## RULES
### YOU MUST:
- Match the requested tone and style
- Be original and engaging
- Follow any brand guidelines provided
- Structure content with clear headings

### YOU MUST NOT:
- Plagiarize content
- Use filler or fluff paragraphs
- Go off topic

### OUTPUT FORMAT:
{{FORMAT}}`,
        tools: ['web-search'],
        model: { provider: 'google', modelId: 'gemini-2.0-flash', temperature: 0.7 },
        contextSlots: ['CONTENT_TYPE', 'AUDIENCE', 'FORMAT'],
        category: 'content'
    },
    {
        templateId: 'code-assistant',
        name: 'Code Assistant',
        description: 'Expert coding agent that writes, reviews, debugs, and explains code in any language',
        icon: '💻',
        systemPromptTemplate: `You are a Code Assistant Agent expert in {{LANGUAGES}}.

Your goal is to help with {{TASK_TYPE}} tasks.

## RULES
### YOU MUST:
- Write clean, well-commented code
- Follow best practices for the language
- Explain your approach before writing code
- Handle edge cases

### YOU MUST NOT:
- Write code without explaining it
- Ignore security best practices
- Use deprecated functions or libraries

### OUTPUT FORMAT:
Explanation → Code block → Usage example`,
        tools: ['code-executor', 'web-search'],
        model: { provider: 'google', modelId: 'gemini-2.5-pro', temperature: 0.2 },
        contextSlots: ['LANGUAGES', 'TASK_TYPE'],
        category: 'development'
    }
];

// ─── Main ────────────────────────────────────────────────────────

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  RamN AI — Seed Data');
    console.log(`  Region: ${REGION}`);
    console.log('═══════════════════════════════════════════\n');

    const results = { created: 0, skipped: 0, failed: 0 };

    // ── Seed Tools ──
    console.log('▸ Seeding RamN_ToolRegistry...');
    for (const tool of TOOLS) {
        try {
            const status = await putIfNotExists('RamN_ToolRegistry', ['toolId'], tool);
            results[status]++;
        } catch (error) {
            console.error(`  ❌ FAILED: ${tool.toolId} — ${error.message}`);
            results.failed++;
        }
    }

    // ── Seed Models ──
    console.log('\n▸ Seeding RamN_ModelRegistry...');
    for (const model of MODELS) {
        try {
            const status = await putIfNotExists('RamN_ModelRegistry', ['modelId'], model);
            results[status]++;
        } catch (error) {
            console.error(`  ❌ FAILED: ${model.modelId} — ${error.message}`);
            results.failed++;
        }
    }

    // ── Seed Special Agents ──
    console.log('\n▸ Seeding RamN_SpecialAgents...');
    for (const agent of SPECIAL_AGENTS) {
        try {
            const status = await putIfNotExists('RamN_SpecialAgents', ['templateId'], agent);
            results[status]++;
        } catch (error) {
            console.error(`  ❌ FAILED: ${agent.templateId} — ${error.message}`);
            results.failed++;
        }
    }

    console.log('\n───────────────────────────────────────────');
    console.log(`  Created: ${results.created}  |  Skipped: ${results.skipped}  |  Failed: ${results.failed}`);
    console.log('═══════════════════════════════════════════\n');

    if (results.failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
