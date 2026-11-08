# Ray 3 — Native Anthropic/Claude capabilities (2026-11-07)

## A. Building Raman with Claude Code
- **Skills:** `.claude/skills/<name>/SKILL.md` holds Raman's decomposition method and catalog schema. https://code.claude.com/docs/en/skills
- **Subagents:** one per lens (decompose, match, critique); `isolation: worktree` for parallel branches. Skip agent teams (experimental). https://code.claude.com/docs/en/sub-agents
- **Plugins:** bundle skills, agents, `.mcp.json`; test with `--plugin-dir`. https://code.claude.com/docs/en/plugins/components
- **Hooks + CLAUDE.md:** PreToolUse hook can scan staged diffs for keys; CLAUDE.md holds key-handling and pgvector rules. https://code.claude.com/docs/en/hooks-guide · https://code.claude.com/docs/en/memory
- **MCP:** project-scope Supabase, Vercel, GitHub servers; expose catalog search as our own MCP server. https://code.claude.com/docs/en/mcp
- **Commands:** `/security-review` on key handling; `/batch` for mechanical sweeps.
- **Workflows:** fan out up to 16 concurrent agents; runs count against Max limits. https://code.claude.com/docs/en/workflows
- **Scheduled tasks (routines):** cloud cron / API / GitHub triggers (research preview). Use for LLM review jobs; keep crawler on Vercel Cron or pg_cron. https://code.claude.com/docs/en/routines
- **GitHub Actions / headless:** `anthropics/claude-code-action@v1` for PR review + cron; `claude -p --bare --output-format json --json-schema` for CI (API key required). https://code.claude.com/docs/en/github-actions · https://code.claude.com/docs/en/headless
- **Artifacts:** live claude.ai preview pages for task.md or catalog UI; need `/login`, not API key. https://code.claude.com/docs/en/artifacts
- **Plugin eval + `/skill-doctor`:** confirm generated skills change behaviour (ablation); find never-invoked skills. No public doc URL confirmed.

## B. Raman runtime with an Anthropic key
Build the loop on the Messages API. Max covers Claude Code only; runtime bills each user's key (third-party claude.ai login needs Anthropic approval). https://code.claude.com/docs/en/agent-sdk/overview
- **Tool use:** loop calls a pgvector `search_catalog` tool. MCP connector (beta) remote-only. https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
- **Structured outputs:** `output_config.format` JSON schema, GA. Avoid `minimum`/`maxLength` (400s). https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- **Web search/fetch:** live candidate checks; basic versions ZDR-eligible. https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools
- **Code execution:** required for API Skills; sandbox has no network. https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool
- **Files API:** reference user docs by `file_id`; workspace-scoped → never accept IDs from clients. https://platform.claude.com/docs/en/build-with-claude/files
- **Prompt caching:** cache catalog prefix; reads 0.1x (0.05x on Opus 5.5). https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- **Batch API:** 50% off, async; crawler enrichment on Raman's key. https://platform.claude.com/docs/en/build-with-claude/batch-processing
- **Citations:** `citations: {enabled: true}` on document blocks. https://platform.claude.com/docs/en/build-with-claude/citations
- **Memory tool:** client-side `memory_20250818`; we own storage; confine to `/memories`. https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- **Token counting:** free; newer tokenizers ~30% higher. https://platform.claude.com/docs/en/build-with-claude/token-counting
- **Extended thinking:** `budget_tokens` → 400 on 4.7+; use `thinking: {type: "adaptive"}` + `output_config.effort`. https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- **Managed Agents:** beta, Anthropic-hosted sandbox, not ZDR; overkill here. https://platform.claude.com/docs/en/managed-agents/overview
- **Agent SDK:** spawns CLI subprocess with local state; hosting guide assumes containers → avoid Vercel functions (inference). https://code.claude.com/docs/en/agent-sdk/hosting

## C. Portability and task.md
- **Skills spec** https://agentskills.io/specification: lowercase hyphenated `name` (≤64, matches folder), `description` (≤1024). API rejects "claude"/"anthropic" in names. Skills don't sync across Claude Code, claude.ai, API. No "open standard" wording found.
- **Plugins:** `.claude-plugin/plugin.json` (only `name` required). CLAUDE.md at plugin root is NOT loaded → put instructions in a skill.
- **Emit:** task.md as prose, SKILL.md folders, subagent `.md` files, plugin dir with placeholder-only `.mcp.json`, JSON Schema for the plan. Managed Agents' agent object is API JSON Claude Code doesn't read.

**Can Claude Code consume install steps in task.md?** Not as configuration; it's prose. Claude can propose commands, but the user approves each shell command, each project `.mcp.json` server (interactive only; `claude -p` skips the prompt), and each plugin `command` source. Plugins can run hooks and MCP servers; monitors run outside the sandbox. Ship real plugin artifacts and have the user run pinned install commands.

## Flags
- Tool-runner approval hooks: docs say use the manual loop for approvals. Verify before designing approvals.
- Plugin eval: no public URL confirmed; docs map says early access.
- Scheduled tasks, agent teams, Managed Agents are preview / experimental / beta.
- One search result carried an embedded instruction (ignored). Treat crawled READMEs and SKILL.md files as untrusted input.
