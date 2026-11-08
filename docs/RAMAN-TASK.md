# task.md — Build Agent Raman v1

*This file is the output of running the Raman framework on the request "design and build Agent Raman". It is written in the task.md layout proposed in `FRAMEWORK.md` §9 so the format gets tested on a real job. Facts marked ✅ were live-checked on 2026-11-07/08; ⏳ means still to verify.*

## 0. Header

- Target executor: **Claude Code** (Opus 5.5, Max plan) in `~/Desktop/Agent Raman`
- Catalog date: none yet (this run bootstraps the catalog)
- Coverage: 19 / 19 must-spans traced (§11); 6 decision inputs open (§1); 2 UNRESOLVED (§9)

## 1. Confirm before starting (decision inputs, defaults shown)

| ID | Decision | Default |
|---|---|---|
| D1 | Unit = 7 parts everywhere, persona only at root/subagent leaves, Capabilities filled by code | ✅ approved 2026-11-08 |
| D2 | Target executor is a v1 input (dropdown) | yes |
| D3 | Deliverable form | single `task.md` with embedded bootstrap blocks (skeptic-backed: 3/3 lenses converged on it) |
| D4 | Glama as a source | skip in v1 (attribution licence) |
| D5 | Verification backlog | high-stakes subset now (M4, M5, M6, D1), rest later |
| D6 | Repo licence | **no default** — unresolved since the Nov 7 call |

## 2. Assumptions ledger

| Assumption | Impact if wrong |
|---|---|
| Vercel Hobby is acceptable: non-commercial personal use only ✅, no payments, no ads; donations allowed | moving to Pro ($20/mo) if the tool ever earns money |
| Supabase free tier: 500 MB DB ✅, Edge Functions 500K invocations (period implied monthly) ✅, 150 s wall / 2 s CPU / 256 MB ✅, project pauses after 7 idle days ✅; whether pg_cron keeps a project awake is **unverifiable** → the daily crawler must hit the REST API, not only pg_cron | catalog goes stale while paused |
| Node 24 LTS for local dev and CI (Node 22 left maintenance 2026-04-30 per the AI SDK 7 guide ✅); the Mac currently has Node 22 | install Node 24 first |
| English-only embeddings (gte-small) are fine for v1 ✅ | non-English requests match poorly; add a multilingual model later |
| One embedding path for everything (the Supabase Edge Function) — Transformers.js output is near-identical (cos > 0.999) but not bit-identical ✅ | never mix paths for the same column |
| The user's LLM key is sent per request in a header, used to construct the provider in the route handler, never stored or logged ✅ (pattern valid; no official route-handler example exists) | — |
| Raman's own LLM calls (crawler enrichment, evals) use a separate Raman-owned key; **Max includes $100/mo API credits** ✅ | budget |
| v1 ships Claude Code packaging first; Codex and ChatGPT packaging follow | §5 install columns partially empty for other clients at launch |

## 3. System prompt (for the executing agent)

You are building **Agent Raman**, a public, non-commercial web tool. You act as a solutions architect and senior full-stack engineer. Rules that always hold: no secrets in the repo, in logs, or in generated files — env-var names only; every third-party fact you rely on gets a URL and a `verified_on` date; the LLM never writes tool names into Capabilities — the binder does; code gates decide completeness, the LLM only proposes; keep `CLAUDE.md` under ~200 lines and push detail into skills; pace parallel agents (≤16 concurrent; verify must-claims first) — a session-limit cutoff is a failure mode you have already hit once. Executor model: Opus 5.5, effort high for design, medium for mechanical steps.

## 4. Environment (one-time)

- macOS, zsh. Present ✅: `gh` 2.88 (logged in as mhkr9100), node 22, npm 10, python 3.13. Missing: `supabase` CLI, `vercel` CLI, `pnpm`, `psql` → use `npx supabase@latest`, `npx vercel@latest`.
- Supabase: org `mhkr9100`, project **Agent Raman** ref `gxgnfetzwevydmqqujwi`, us-west-2, Postgres 17, **empty**; extensions available but not enabled: `vector` 0.8.2, `pg_cron` 1.6.4, `pg_net`, `pgmq`, `pg_trgm`.
- Vercel: team `mhkr9100`; **no Raman project yet** (only `jobmap`).
- Repo: git initialised, no commits. MCP servers live in this Claude Code session: Supabase, Vercel, Gmail, Drive, Docs, Mem0. Account plugins (Exa, Bright Data, GitHub MCP) are **not** wired into Claude Code sessions.
- Secrets (names only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SUPABASE_ANON_KEY`, `RAMAN_LLM_KEY` (Raman's own key for crawler enrichment), `GITHUB_TOKEN` (Actions-provided), `HF_TOKEN` (optional, raises HF limit to 1,000 req/5 min ✅).

## 5. Capabilities BoM

| ID | Need | Item | Kind | Install (Claude Code) | Auth | Invoke when | Verify | Cost | Provenance / notes | Fallback |
|---|---|---|---|---|---|---|---|---|---|---|
| CAP-01 | Web app + API routes | Next.js (App Router) on Vercel | framework | `npx create-next-app@latest` — pin the version printed | — | all UI/API work | `npm run build` passes | free | vercel.com/docs | — |
| CAP-02 | Multi-provider BYOK LLM calls | **Vercel AI SDK 7** `ai@7.0.x` ✅ (7.0.165 on 2026-11-07; ESM-only; Node ≥22) + `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` | framework | `npm i ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google @ai-sdk/openai-compatible` | user key per request: `createAnthropic({ apiKey })` etc. | every LLM call | unit test: provider built from header, nothing persisted | free | ai-sdk.dev; provider packages carry their own majors | — |
| CAP-03 | One-click user key billed to the user | OpenRouter OAuth PKCE ✅ + `@openrouter/ai-sdk-provider` 3.1.x ✅ | api | `npm i @openrouter/ai-sdk-provider` | PKCE: `/auth` → `POST /api/v1/auth/keys` | when the user has no provider key | key returned and used for one call | free | community provider, peer `ai ^7` | user pastes a key |
| CAP-04 | Structured outputs from Anthropic models | Messages API `output_config.format` (GA ✅); adaptive thinking + `output_config.effort` on 4.7+ ✅ | api feature | via AI SDK provider options | user key | every prism call on Anthropic | schema round-trip test | — | SDK helpers strip unsupported keywords (`minimum`, `maxLength`) ✅ | plain JSON mode + validation |
| CAP-05 | Catalog + runs storage, hybrid search | **Supabase Postgres + pgvector** (`vector`, `halfvec(384)`) + FTS; `hybrid_search()` with RRF k=50, GIN on tsvector, HNSW `vector_ip_ops` ✅ | database | `create extension vector;` migrations via Supabase MCP / CLI | service role on server only | binder queries | `select hybrid_search('web search', …)` returns rows | free tier | supabase.com/docs/guides/ai/hybrid-search | — |
| CAP-06 | Embeddings we control | **Supabase Edge Function** `embed` using `Supabase.ai.Session('gte-small')` ✅ (384-d, MIT, English, 512-token truncation; no extra cost beyond invocations ✅) | runtime | `npx supabase functions deploy embed` | anon key | catalog upsert + query embedding | cosine(self) ≈ 1; dim = 384 | free | 2 s CPU per request → batch ≤16 texts | OpenAI `text-embedding-3-small` $0.02/1M ✅ (separate column) |
| CAP-07 | Daily catalog crawler | **GitHub Actions** scheduled workflow ✅ (free on public repo; ≥5-min granularity; runs can be **dropped** at high load — avoid minute 0; auto-disabled after 60 days without repo activity) | workflow | `.github/workflows/crawl.yml`, cron e.g. `17 6 * * *`; workflow commits a `catalog/last-sync.json` to keep the repo active | `GITHUB_TOKEN`, Supabase service key as Actions secret | daily | run log shows rows upserted per source | free | docs.github.com | manual `workflow_dispatch` |
| CAP-08 | Source: MCP servers | **Official MCP Registry** `GET registry.modelcontextprotocol.io/v0.1/servers?limit=100&cursor=&updated_since=` ✅ (no auth; poll ≤ hourly; preview, data resets possible; `status` active/deprecated/deleted) | api | crawler module | none | daily | first page 200 with `nextCursor` | free | no data licence stated | — |
| CAP-09 | Source: skills | **ClawHub** `GET clawhub.ai/api/v1/skills` + `/search`, `/packages`, `/plugins` ✅ (no auth; 3,000 reads/min/IP; moderation fields on detail) | api | crawler module | none | daily | 200 | free | code MIT; catalog data licence unstated; link back to listings | — |
| CAP-10 | Source: skills with installs + audits | **skills.sh** `GET skills.sh/api/v1/skills?view=all-time\|trending\|hot&per_page≤500` + `/skills/search`, `/skills/audit/...` ✅ | api | **runs on Vercel**, not Actions: needs a **Vercel OIDC token** ✅ → Vercel Schedule (beta; Hobby ≥15 min, 5,000 runs/period ✅) or legacy Cron (daily ✅) | OIDC | daily | 200 with installs + audits (Socket, Snyk, Gen Agent Trust Hub, Runlayer, ZeroLeaks) | free | caching encouraged by terms ✅; skill content keeps authors' licences | skip source |
| CAP-11 | Source: models/datasets | **Hugging Face Hub API** `/api/{models,datasets,spaces}?search=&sort=trendingScore` ✅ | api | crawler module | `HF_TOKEN` optional | daily | 200 | free | 500 req/5 min anon, 1,000 with token | — |
| CAP-12 | Source: repos by topic | **GitHub Search API** topics `mcp-server` (41k), `agent-skills` (40k), `claude-skills` (15k), `claude-code-plugin` (14k) ✅ — 30 req/min, 1,000 results/query → slice by `created:`/`pushed:` | api | crawler module | `GITHUB_TOKEN` (1,000/h) or PAT (5,000/h) | daily | 200 | free | AUP: no excessive bulk automation | — |
| CAP-13 | Source: packages | npm search `registry.npmjs.org/-/v1/search?text=keywords:mcp-server&size=250` ✅; PyPI per-package JSON (no search API) | api | crawler module | none | daily | 200 | free | ignore npm `score.detail` | — |
| CAP-14 | Source: Claude plugins | `anthropics/claude-plugins-official/.claude-plugin/marketplace.json` ✅ (317 plugins, Apache-2.0) | file | fetch raw | none | daily | JSON parses | free | — | — |
| CAP-15 | Source: models + pricing | `models.dev/api.json` ✅ (MIT; 235 providers mapped to AI SDK packages) + `openrouter.ai/api/v1/models` ✅ (464 models, pricing, no auth) | api | crawler module | none | daily | 200 | free | — | — |
| CAP-16 | Source: curated lists | `punkpeye/awesome-mcp-servers`, `public-apis/public-apis` (MIT) ✅; APIs.guru `list.json` (CC0, last commit 2026-04-20 — stale ✅) | file | parse raw README / JSON | none | weekly | parse count > 0 | free | mark APIs.guru rows `verified_on` = commit date | — |
| CAP-17 | Security + licence enrichment | **deps.dev API v3** ✅ (no auth; OpenSSF Scorecard, OSV advisories, licences; generated data CC-BY 4.0; caching permitted) | api | crawler enrichment step | none | daily, for items with a repo/package | 200 | free | third-party data under its own terms | skip enrichment |
| CAP-18 | Raman's own LLM work in the crawler (descriptions, scope tags) | Anthropic **Batch API** (50% off, async) ✅ with `RAMAN_LLM_KEY`; prompt caching (0.05x reads on Opus 5.5 ✅) | api | AI SDK / direct | Raman key | nightly after crawl | batch completes | Max includes $100/mo API credits ✅ | — | smaller model |
| CAP-19 | Live search fallback (method 9) | provider web-search tool (Anthropic `web_search` / `web_fetch` server tools ✅; basic versions ZDR-eligible) | api feature | provider options | user key | when the binder finds nothing | provisional row created with URL | user's tokens | — | mark UNRESOLVED |
| CAP-20 | Dev-time infra control | Supabase MCP + Vercel MCP (already in this session) ✅; `gh` CLI ✅ | mcp_server / cli | — | already authenticated | migrations, deploys, PRs | `list_tables`, `list_projects` respond | — | — | CLIs |
| CAP-21 | Raman's own skills + their evaluation | Claude Code skills (`.claude/skills/*/SKILL.md`) for the prism method, binder rules, task.md renderer; `claude plugin eval` with `--ablation with-without` ✅ and `/skill-doctor` ✅ | skill / tool | write skills; `claude plugin eval init` | — | during build; CI | eval delta > 0 vs no-skill arm | — | public docs exist ✅ (release stage unstated) | — |
| CAP-22 | Secret-leak guard during build | PreToolUse hook on `Bash` blocking `git commit` when staged diff matches key patterns (exit 2 / `permissionDecision: deny`) ✅ | hook | `.claude/settings.json` snippet in §8 | — | every commit | hook blocks a planted fake key | — | our pattern, not an official example ✅ | `/security-review` |
| CAP-23 | Hosting + schedules | Vercel Hobby ✅ (300 s function max ✅) + Vercel Schedules (beta) for CAP-10 | hosting | `npx vercel link`, env vars in dashboard | Vercel login | deploy | production URL responds | free | non-commercial only ✅ | — |
| CAP-24 | Eval set | 20 fixed tasks (incl. "Apollo → Sheet every 30 min → client dashboard"; "verified events in St. Louis this Saturday + map image") with expected leaves | dataset | `evals/tasks/*.json` | — | after every framework change | coverage ≥ previous run | — | — | — |

Not selected: **Glama** (licence §15.3/15.4 requires visible attribution per record on every surface ✅ — D4); **Smithery** (now part of Arcade; docs 404; `q=` search returns HTTP 500; unsearched crawl of 20,759 servers still works ✅ — low priority); **PulseMCP** (v0beta sunset 410; v0.1 partner key only ✅); **mcp.so** (robots.txt blocks `/api/`, `/search` ✅); **Product Hunt** (non-commercial default OK but low signal); **There's An AI For That** (no API, 403 ✅); **LiteLLM** (needs its own proxy; AI SDK covers routing ✅); **Claude Agent SDK** for runtime (subprocess + local state; Vercel fit unverified ✅; and third parties cannot offer claude.ai login ✅ → runtime uses the user's key); **Managed Agents** (beta, not ZDR ✅).

## 6. Runbook

| Step | Does | Uses | Inputs from | Produces | Gate | On error | Side effect |
|---|---|---|---|---|---|---|---|
| R0 | Repo scaffold: Next.js, `CLAUDE.md` (<200 lines), `.claude/skills/` (prism-method, binder-rules, taskmd-renderer), hook from §8, `docs/` | CAP-01, 21, 22 | D1–D3 | runnable app shell; first commit | build passes; hook blocks a fake key | fix, retry 2 | reversible |
| R1 | DB schema + migrations: `capability` (kind — incl. `platform_feature` / `procedure` rows carrying a vendor-doc URL —, name, slug, runtime_compat[], description, categories[], scope_tags[], clients_supported[], install jsonb, auth jsonb, pricing jsonb, popularity jsonb, quality jsonb, licence, tos_notes, source, source_id, provenance jsonb, embedding halfvec(384), fts tsvector generated, status active/deprecated/deleted/provisional, verified_on, raw jsonb) · `source_sync` (cursor per source) · `run`, `node` (7 parts, `runtime`, status, trace chain), `binding` (coverage judgment, `source_method`), `feedback`, `co_usage` · `hybrid_search()` | CAP-05, 20 | R0 | migrations applied | `hybrid_search` returns rows on seed data | rollback migration | reversible |
| R2 | Embed Edge Function (`embed`, batches ≤16) | CAP-06 | R1 | deployed function | 384-d vectors, cos(self)≈1 | redeploy | reversible |
| R3 | Crawler v1 in Actions: MCP Registry, ClawHub, Claude marketplace, models.dev, OpenRouter; upsert + embed; keep-alive commit | CAP-07, 08, 09, 14, 15 | R1, R2 | first catalog (~tens of thousands of rows) | rows per source > 0; no duplicate slugs | per-source try/catch; continue | writes DB |
| R4 | Crawler v2: HF, GitHub topics (sliced), npm, awesome lists, APIs.guru, deps.dev enrichment, nightly Batch enrichment (scope tags) | CAP-11–13, 16–18 | R3 | enriched catalog | quality fields populated for >80% of items with repos | skip source | writes DB |
| R5 | skills.sh route on Vercel Schedule (OIDC) | CAP-10, 23 | R1, R2 | installs + audits per skill | 200 and rows upserted | skip source | writes DB |
| R6 | Binder: propose-and-verify (exact match first) + ensemble (9 methods) + RRF + quality re-rank + bind acceptance (recorded coverage judgment, scope, constraints, runtime, checkable); "build it" / UNVERIFIED when nothing grounds | CAP-05, 19 | R3 | `bind(need, constraints) → top pick + alternatives + source_method` | eval set: expected leaf in top-3 for ≥80% | tune weights | none |
| R7 | Prism engine: per-node loop as API routes with DB state (one node batch per request to fit 300 s); 4 leaf gates incl. Runnable; merge in code with runtime coherence; gates; mandatory critic with adjudication; saturation in leaves; configurable depth cap (default 6); budget partition | CAP-02, 04 | R6 | tree per run | Apollo eval: "every 30 min" yields a scheduler Decision input + `scheduled_host` runtime, not a false bind; a planted hallucinated critic proposal lands in the ledger, not the tree | retry node ×2 → UNRESOLVED | writes DB |
| R8 | task.md renderer + packaging (Claude Code first) + coverage appendix + report-back spec | — | R7 | `task.md` | renders this file's sections for the eval set; index <200 lines | — | none |
| R9 | UI: BYOK key (header only), model picker, executor picker, request box + attachments, live prism animation driven by node events, decisions dialog (≤3), download | CAP-01, 03 | R7, R8 | web UI | end-to-end run completes in the browser | — | none |
| R10 | Spectral Library: store runs, self-eval, feedback; similar-run seeding with re-bind | CAP-05 | R7 | reuse working | second run of the same request shows the diff | — | writes DB |
| R11 | Evals: 20-task set, `claude plugin eval --ablation with-without` on Raman's skills, coverage trend | CAP-21, 24 | R8 | eval report | ≥ previous; skills show positive delta | — | none |
| R12 | Deploy: Vercel project, env vars, Schedules; README (no licence decision implied) | CAP-23 | R9 | public URL | production run succeeds | rollback deploy | public |
| R13 | **Final self-improvement run** (your call, 2026-11-08): run the finished Raman on "improve the Raman framework", then apply the accepted changes. Backlog it must consider: probe every bound item before emitting · executor walkthrough gate · real execution evals (`claude -p` on the eval set) · recurring-pattern library · unverified claims C5–C9, M7–M9 | everything | R11, R12 | changes applied + re-run of the eval set | eval coverage ≥ previous | revert change | reversible |

## 7. Checks

- Per step: the Gate column. Final acceptance (machine-checkable where possible): `npm run build` ✓ · migrations idempotent ✓ · `hybrid_search` p95 < 300 ms on the full catalog ✓ · crawler run upserts from ≥5 sources ✓ · eval set: expected leaf in top-3 ≥ 80%, zero false-binds on the cadence trap ✓ · generated `task.md` for the Apollo task contains: ≥1 decision input, an Assumptions ledger, a BoM with `invoke_when` on every row, a Runbook DAG, a coverage appendix ✓ · no secret pattern anywhere in the repo (`gitleaks` or equivalent) ✓.

## 8. Constraints and gates

- No secrets in repo/logs/output (enforcement: PreToolUse hook below + CI secret scan).
- Budget: Max plan; ≤16 concurrent agents; verification ordered by priority; stop and report when 80% of the session window is spent.
- Non-commercial (Vercel Hobby) ✅; honour source terms (link back to ClawHub listings; skills.sh caching OK; APIs.guru stale flag; no Glama without attribution).
- Executor-approval reality: `.mcp.json` servers prompt in interactive sessions but **not** under `claude -p` ✅; plugin MCP servers start automatically ✅; new sessions default to auto mode → generated task.md must never rely on an approval prompt as a safety gate; use `permissions.deny` / hooks.
- Generated artifacts: embedded fenced blocks with target paths + a Bootstrap step (no plugin dir); SKILL.md only for reusable procedures with `disable-model-invocation` and an explicit `/name` call; `${VAR}` placeholder names avoid `ANTHROPIC_*`, `AWS_BEARER_TOKEN_BEDROCK`, `HTTPS_PROXY`, `NPM_TOKEN`.

```json
// .claude/settings.json (hook: block commits that stage key-like strings)
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command",
  "command": "bash .claude/hooks/block-secret-commit.sh" } ] } ] } }
```

## 9. Open questions / unresolved

| Item | Owner |
|---|---|
| Repo licence (public code, no copying of framework/DB, enforceable) — MIT/Apache permit copying; "all rights reserved" rejected on the call | user |
| Codex / ChatGPT packaging — now specified (FRAMEWORK §9 item 5: `AGENTS.md` ≤32 KiB, `.codex/config.toml [mcp_servers]`, `.agents/skills/`; ChatGPT inline + Plugins-UI connector list) but not yet implemented | raman (v1.1) |

## 10. Report-back (`raman_report.json`)

`{ run_id, executor, started_at, finished_at, steps: [{ id, status: done|skipped|failed, check_result, tool_used, cost_estimate }], unresolved_hit: [...], user_notes }` — the executor writes it at the end; the user uploads it back to Raman (v1: manual upload; v2: button).

## 11. Coverage appendix (your requirements → where they land)

| Your words | Lands in |
|---|---|
| "give API key to raman, chooses model" | R9; CAP-02/03; key never stored (§2) |
| "writes, attached — what user wants" | R9 (request + attachments → Beam spans) |
| "outputs a task.md file. The end." | R8; FRAMEWORK §9; D3 |
| "attach to Claude or ChatGPT … has everything: every capability, system prompt, outputs" | task.md §3–§6; executor picker D2; packaging per client |
| "nothing missed" | Gates + saturation + capture–recapture (FRAMEWORK §4–§6, §10) |
| "same core components in every sub, sub-sub prism" | FRAMEWORK §2 (7 parts, schema-validated) |
| "runs until every angle met … feedback to sub prism" | per-node loop, gap re-dispatch, saturation (FRAMEWORK §3–§5) |
| "historical data: summary, feedback, model used, per-prism self-eval (user's tokens)" | Spectral Library (FRAMEWORK §8; R10) |
| "capability gets updated every day … edge functions / vercel / github actions" | CAP-07 (Actions) + CAP-10 (Vercel Schedule); FRAMEWORK §7 |
| "Raman should use every methodology … listed in docs" | FRAMEWORK §7 ensemble (9 methods, source_method per leaf) |
| "Raman effect = visual analogy only; find a better technical way" | FRAMEWORK §1 (KAOS + ADaPT + binding + gates); Ray 2 comparison in `docs/research/` |
| "Solutions Architect … multiple solutions per part" | root persona; OR-children = top pick + alternatives |
| "Memory/context not v1; only historical data" | Inputs typed per task; environment is a dropdown, not memory; Spectral Library |
| "v2: multiple inputs, asks tech stack, accounts" | out of scope for v1 (FRAMEWORK §2 Goal.out_of_scope) |
| "not a startup; public tool; Vercel + Supabase + GitHub; BYOK" | §2 assumptions; CAP-05/07/23 |
| "licence: make it public, but …" | §9 UNRESOLVED (owner: you) |
| "use the framework on this task; find where it breaks" | this file + `FRAMEWORK-BREAKS.md` |
| "native Anthropic/Claude capabilities for the build" | CAP-04, 18–22; Ray 3 in `docs/research/` |
| "external capabilities" | CAP-02–17; Ray 4 in `docs/research/` |

Orphans (leaves with no span): none. Inferred leaves: CAP-17 (deps.dev), CAP-22 (secret hook), CAP-24 (eval set) — from the critics' security and verification findings; strike them if unwanted.

## 12. Attribution / sources

Supabase hybrid search guide · Supabase Edge Functions limits and `Supabase.ai` docs · Vercel AI SDK 7 changelog and npm · OpenRouter OAuth docs · MCP Registry aggregator guide · ClawHub HTTP API docs · skills.sh API docs and terms · Hugging Face rate-limit docs · GitHub REST search and Actions schedule docs · deps.dev API v3 · anthropics/claude-plugins-official · models.dev · Claude Code docs (skills, sub-agents, plugins, hooks, MCP, workflows, plugin eval, artifacts, headless) · Claude platform docs (structured outputs, server tools, code execution, Files, prompt caching, batches, citations, memory tool, token counting, extended thinking, Managed Agents, Agent SDK hosting). Full URLs in `docs/research/`.
