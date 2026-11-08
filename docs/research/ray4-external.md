# Ray 4 — External capabilities + catalog sources (2026-11-07)
✓ = confirmed with a live call today. UNVERIFIED = could not confirm.

## 1. Catalog sources
- **MCP Registry** ✓ `registry.modelcontextprotocol.io/v0.1/servers?limit=100&cursor=&updated_since=<RFC3339>` — no auth; poll ≤ hourly; preview (data resets possible); sync `status`, drop `deleted`; no data licence stated. modelcontextprotocol.io/registry/registry-aggregators
- **Glama** ✓ `glama.ai/api/mcp/v1/servers|connectors` — Bearer key; 100 req/s; ten 429s → ban. **Licence requires visible credit + followed link to glama.ai + link to each item's Glama page — applies to task.md output too.** glama.ai/mcp/api
- **Smithery** ✓ `api.smithery.ai/servers?q=` and `/skills` (semantic search, 20,759 servers) — docs say key required, currently answers without; no published limits; ToS not found (UNVERIFIED).
- **skills.sh** ✓ `skills.sh/api/v1/skills?view=all-time|trending|hot&per_page≤500`, `/skills/search`, `/skills/{id}`, `/skills/audit/{id}` — needs **Vercel OIDC token**; 600 req/min; terms allow caching; skill content keeps authors' licences. skills.sh/docs/api
- **ClawHub** ✓ `clawhub.ai/api/v1/skills?cursor=`, `/search`, `/packages`, `/plugins` — no auth; 3,000 reads/min/IP; MIT. github.com/openclaw/clawhub/blob/main/docs/http-api.md
- **Hermes Skills Hub** — no API; aggregates skills.sh, ClawHub, LobeHub, `browse.sh/api/skills` ✓, openai/anthropics/huggingface/NVIDIA `skills` repos, `/.well-known/skills/index.json` sites. Crawl those directly.
- **Hugging Face** ✓ `huggingface.co/api/{models,datasets,spaces}?search=&sort=trendingScore` — 1,000 req/5 min with free token (500 without); licences per repo.
- **GitHub** ✓ topic counts today: mcp-server 41,375 · agent-skills 40,528 · claude-skills 14,824 · claude-code-plugin 14,320. Search 30 req/min, ≤1,000 results/query → split by `created:` range. PAT 5,000 req/h; GITHUB_TOKEN 1,000/h. AUP bans excessive bulk automation.
- **npm** ✓ `registry.npmjs.org/-/v1/search?text=keywords:mcp-server&size=250` (downloads, dependents; ignore `score.detail`).
- **PyPI** — no search API; `pypi.org/pypi/{name}/json` per package; pypistats/BigQuery for downloads.
- **Claude plugins** ✓ `raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json` — 317 plugins, Apache-2.0.
- **Awesome lists** ✓ punkpeye/awesome-mcp-servers, public-apis/public-apis — MIT; parse raw READMEs.
- **APIs.guru** ✓ `api.apis.guru/v2/list.json` — 2,529 APIs, CC0; last commit Apr 2026 (may be stale).
- **Model catalogs** ✓ `models.dev/api.json` (MIT, 235 providers → AI SDK packages); `openrouter.ai/api/v1/models` (464 models w/ pricing, no auth).
- **Skip:** PulseMCP (v0beta shut; v0.1 partner key via hello@pulsemcp.com) · mcp.so (no API; robots blocks /api/, /search) · Product Hunt (non-commercial only) · There's An AI For That (no API, 403 to bots — UNVERIFIED) · OpenAI plugins retired, no app-directory API (UNVERIFIED) → index `openai/skills` repo.

## 2. Quality signals
- Glama: qualityScore, SPDX licence, tool input schemas, connector `healthy`, `lastTestedAt`
- Smithery: useCount, verified, isDeployed
- skills.sh: installs (all-time/trending/hot), isDuplicate, audits (Socket, Snyk, Gen Agent Trust Hub, Runlayer, ZeroLeaks)
- ClawHub: downloads, installs, stars, isSuspicious, isMalwareBlocked
- HF: downloads, likes, trendingScore · GitHub: stars, pushed_at, archived · MCP Registry: status
- **deps.dev** ✓ no auth; OpenSSF Scorecard, OSV advisories, licences; CC-BY 4.0; caching allowed. docs.deps.dev/api/v3
- Socket API: keyed quota (free allowance UNVERIFIED)

## 3. Scheduler
- **Vercel Hobby:** Cron Jobs (legacy) once/day within the hour, 300 s; Schedules (beta) ≤ every 15 min, 5,000 runs/period. **Hobby = non-commercial only.** vercel.com/docs/schedules/limits
- **Supabase Cron + Edge Functions:** 500K invocations/mo, 150 s wall, **2 s CPU**, 256 MB; free projects pause after 7 idle days (cron stops). supabase.com/docs/guides/functions/limits
- **GitHub Actions (public repo):** free; ≥5 min granularity, may be delayed; schedules disabled after 60 days without repo activity.
- **Recommendation: GitHub Actions daily** (no CPU cap, can run the embedding model); daily DB writes should keep Supabase from pausing (community advice). Pull skills.sh from a small Vercel cron route (OIDC token built in).

## 4. BYOK LLM layer
- **Vercel AI SDK 7** ✓ (`ai@7.0.165`, 2026-06-25, ESM only, Node 22+). Providers: OpenAI, Anthropic, Google/Vertex, Mistral, Cohere, xAI, DeepSeek, Groq, Together, Fireworks, Cerebras, DeepInfra, Hugging Face, Baseten, Bedrock, OpenAI-compatible. OpenRouter via `@openrouter/ai-sdk-provider`.
- **Key never hits DB:** create provider per request in the route handler, e.g. `createAnthropic({ apiKey })` from a request header; never stored or logged.
- **OpenRouter OAuth PKCE** gives one-click user keys billed to their account.
- **Skip LiteLLM** (Python SDK/proxy, own server). vercel.com/changelog/ai-sdk-7 · openrouter.ai/docs/guides/overview/auth/oauth

## 5. Embeddings
- **Don't embed with users' keys** (incompatible vector spaces per model; Anthropic has no embedding model).
- **Use gte-small** (384-d, MIT, English, 512-token truncation) via `Supabase.ai.Session('gte-small')` — no external key; counts as Edge invocations; free-ness not explicit. Backfill in Actions with Transformers.js (`Supabase/gte-small`) after confirming vector parity.
- Paid fallback: OpenAI text-embedding-3-small $0.02/1M tokens.
- Store `embedding_model` column; consider `halfvec` for the 500 MB limit.

## 6. Hybrid search ✓ supabase.com/docs/guides/ai/hybrid-search
`hybrid_search()` fusing FTS + vector with RRF (`rrf_k`=50); GIN on tsvector, HNSW on embeddings; swap to gte-small 384-d.

## Recommended stack
Hosting Vercel Hobby (Pro if commercial) · Search: pgvector HNSW + FTS + RRF · Crawler: GitHub Actions daily + Vercel cron for skills.sh · Sources: MCP Registry, Smithery, ClawHub, skills.sh, Glama (attributed), HF, GitHub topics, npm, Claude marketplace, awesome lists, models.dev · Quality: source metrics + deps.dev + skills.sh audits + ClawHub verdicts · LLM: AI SDK 7, per-request user keys, OpenRouter PKCE · Embeddings: gte-small; user's LLM only rewrites queries and reranks.
