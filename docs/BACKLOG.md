# Build backlog (implementation issues, not framework changes)

Framework improvements go to `RAMAN-TASK.md` R13. This file holds known implementation gaps, found by the adapter verifiers on 2026-11-08 (none blocking).

## Crawler runner
- [ ] **Stale rows:** items that disappear from a source (hidden, moderation-blocked, deleted on ClawHub; removed from awesome-mcp) are never marked `deleted`. Add a post-full-crawl step: rows of that source not seen in this full run → `status = 'deleted'` when no other source lists them.
- [x] Secret regex had no word boundary (`risk-`, `task-`, `desk-` read as keys) → fixed in `crawler/secrets.ts`.
- [x] A full crawl returning 0 records was recorded as `ok` → now fails (`run.ts`).
- [ ] Remove the remaining per-adapter `SECRET_LIKE` workarounds now that the shared regex is fixed (clawhub, mcp-registry), and re-run their try-adapter checks.

## Taxonomy
- [x] `translation-language` matched "language model"; `project-management` matched "tasks"; `memory-knowledge` matched "context" → tightened.
- [ ] Keyword rules are v1. R4 adds Batch-API enrichment for categories and scope tags.

## mcp_registry
- [ ] Full crawls should pass `include_deleted=true` (today only incremental runs see deletions).
- [ ] `publisherOf()` reverses names already in forward domain order (73 cases, e.g. `ac.inference.sh`).
- [ ] PyPI install is written `uvx <pkg>==<ver>`; uv docs use `uvx <pkg>@<ver>` — confirm and fix.
- [ ] Keep `statusMessage` (why a server was deprecated/deleted).
- [ ] Slug rule leaves ~6.5k single-claim GitHub repos under `mcp:<registry name>` (won't merge with other sources). Option: resolve shared repos in SQL after upsert (count registry names per repo).

## awesome_mcp
- [ ] 4 items link to files (`/blob/…/readme.md`) → file name ends up in the slug.
- [ ] ~28 items join badges with "/" (☁️/🏠) → legend lookup misses them.
- [ ] `official` comes from the self-applied 🎖️ badge (462 items) — doesn't match the "publisher matches vendor" meaning; move to `scope_tags`.

## claude_marketplace
- [ ] Top-level `renames` map ignored (the only removal/rename signal).
- [ ] `source_url` 404s for ~7% (claude.com/marketplace page missing).
- [ ] 7 records get no category although the source gives one.

## models_dev
- [ ] Use `?type=all` (62 specialised models missing).
- [ ] `source_url` lacks trailing slash (307 redirect).

## openrouter
- [ ] Some prices (image, audio) stored without a unit.

## Retrieval (hybrid_search smoke test, 2026-11-08, 57k of 144k rows embedded)
- [ ] With 57k rows embedded, keyword and semantic top-3 never overlapped on 3 test queries (at 81k embedded, each query had at least one overlap); official servers (e.g. Slack, Postgres) did not surface. The R6 re-rank must weight curation, quality and usage.
- [ ] RPC latency 1.0–2.5 s on the free tier; measure again once all rows are embedded and the cache is warm.
- [x] Dead tuples reclaimed 2026-11-09 (454 → 408 MB with HNSW rebuilt; procedure in 20261109000012). Remaining: `set_embeddings` still leaves one dead tuple per embedded row, so compaction must be repeated after large embed passes.
- [ ] Once the catalog grows past the 470 MB write cap, crawls stop and the catalog goes stale. Needs a retention rule (drop rows below a quality floor) or a bigger database before then.

## Binder (R6, 2026-11-09)
- [ ] LLM-mode eval not run yet: needs `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_API_KEY` in `.env.local` (`npm run eval:binder -- --llm`). Gates still open: zero wrong binds, cadence trap.
- [ ] `capability.official` is unreliable: it marks registry namespace = repo owner (self-published spam gets `true`; github/github-mcp-server gets `false`). Re-rank ignores it until fixed.
- [ ] Usage and vote signals exist only for ClawHub skills, so the re-rank tilts toward skills over curated MCP servers. Add GitHub stars (awesome-mcp / repo metadata) or normalize per kind.
- [ ] Anthropic's own document skills (pdf, docx, xlsx, pptx from anthropics/skills) are missing from the catalog; only ClawHub copies exist. Add that marketplace (R4).
- [ ] No `platform_feature` / `procedure` rows yet (GitHub Actions schedule, OS cron, Apps Script triggers). Without them a scheduled-host need can only end UNVERIFIED (R4 seed list with vendor-doc URLs).
- [ ] Retrieval miss: "generate an image" ranks video models first (image-generation eval item).
- [ ] Keyword OR fallback (`binder_keyword(p_any => true)`) costs ~3 s for long needs on Nano and is unused; revisit if a stored tsvector fits the budget again.

## Crawl write path (first Actions run, 2026-11-09)
- [x] v1 upsert rewrote every row each crawl → 8 s timeouts (mcp_registry, awesome_mcp) and +9 MB of dead tuples. Fixed: skip unchanged rows, weekly "seen" stamps, 100-row calls (20261109000010).
- [x] Two sources overwrote each other's name/description and nulled embeddings for all 2,175 servers listed in both awesome-mcp and the MCP Registry. Fixed with `text_source` precedence (20261109000011).
- [ ] The embed size guard reads `pg_database_size`, which counts reusable free space; after heavy churn it can block embedding until compaction even when live data fits.

## Engine, API, UI (R7–R11, 2026-11-10)
- [ ] No run with a real provider key has been made. Everything was tested with a scripted model (`evals/mock-llm-server.ts`). First real run: `npm run eval:tasks -- --llm --limit 3`.
- [ ] Run storage is unauthenticated: the run id is the only handle. Anyone can create runs, so history (`similar_runs`, `co_usage`) can be poisoned, and eval runs are not excluded from seeding unless deleted (the eval runner deletes its runs).
- [ ] No retention rule for runs. The database is near its cap (441 MB of 500 MB on 2026-11-10).
- [ ] Rate limit is in memory per server instance: it slows one client, it is not a quota.
- [ ] `publicHttpsUrl` resolves the host once; a DNS answer can change between the check and the fetch (rebinding window).
- [ ] A wrong model key is retried 3 times before the run fails; the UI shows the provider's raw error text.
- [ ] `/api/mcp` and `/api/v1/*` are open (CORS `*`, no auth) by design: they hold no secrets and take no key. Revisit if abuse shows up.
- [ ] Binder `degraded` (a search leg left out after a timeout) is not shown in the node note or the task file.
- [ ] Catalog search is sensitive to cadence words inside a need ("each weekday at 9:00 list Sentry errors" returned email skills). The guide tells the caller to write needs without them; the engine could strip them in code.
- [ ] Agent-path criteria quotes are accepted from 6 characters; short quotes prove little.
- [ ] Packaging: only the Claude Code plugin layout is validated (`claude plugin validate`). Codex / ChatGPT / Cursor packaging (`.agents/skills`, AGENTS.md) is v1.1.

## With/without test (2026-11-10, `evals/ab/RESULTS.md`)
Plans written through the agent path scored lower than plans the same models wrote alone (23 of 24 comparisons) and cost 2.4 to 3.3 times more to write. Fix before any launch, then re-run the same six requests.
- [ ] Rendered file is half to two thirds template. Drop empty sections (no capabilities, nothing to bootstrap, coverage tables with one row) and fixed boilerplate.
- [ ] Step cards are one line. They need the method: endpoint, payload, exact command, schedule line.
- [ ] Section 9 prints "Nothing is open." while section 1 holds unconfirmed decisions (`src/lib/prism/render.ts`, the line that counts only unresolved, low-confidence and gate items). Also: dangling decision references and repeated schedule steps.
- [ ] Unverified facts are not flagged. The file must say at the top what nobody verified.
- [ ] Catalog items are bound where a built-in command or a standard package covers the need (paid analytics MCP server with no fallback, community skills, wrapper servers). Prefer the simple path; always name a fallback.
- [ ] No sign-in or requirement facts for bound items (wrong token variable name for the GitHub plugin; stdio and HTTP sign-in confused for a Sheets server; a skill that needs an undisclosed third-party account).
- [ ] `find` replies are about 14,500 characters each: the largest input cost on the agent path.
- [ ] `embed` Edge Function returned `WORKER_RESOURCE_LIMIT` once when several planners called `find` at the same time.
- [ ] Not tested: executing the plans, non-Claude planners, the web engine with a real key (the Ollama Cloud key has no credit), a human reviewer.
- [ ] `RAMAN_TEST_LOG` and `RAMAN_RATE_LIMIT=off` are local test switches; a deploy check should refuse to start with either set.

## Main page and docs (2026-11-10)
- [ ] The main page is now one prism screen (`src/app/ui/stage.tsx`, `scatter.tsx`); the old studio, spectrum list and connect panel are gone. The per-node detail view (bindings, reasons, alternatives) is no longer shown in the UI, only in task.md.
- [ ] Install commands for the MCP server, API and skill are not shown ("soon"). Verified forms when they return: `claude mcp add --transport http <name> <url>`, `codex mcp add <name> --url <url>`, `.cursor/mcp.json`, `npx skills add owner/repo`.
- [ ] Display name is "AgentRamaN"; slugs, tool names (`raman_*`), storage keys and the repository name are unchanged.

## Checker test (2026-11-10, `evals/ab/CHECK-RESULTS.md`)

- Used as a checker of an existing plan, the agent path added nothing over one line ("verify every factual claim on the web"): same wrong claims (12 and 12 of 120), lower score (7.08 against 7.58), 1.2 to 2 times the cost. Stop rule (written first in `evals/ab/CHECK-TEST.md`) not met on all three parts.
- `check` reports structure only (empty categories, missing rollback, ids not in the catalog). It has no way to say a fact is wrong, and the faults that matter in plans are wrong tool facts.
- Not tested: a stored, dated fact sheet from vendor documentation; execution of the plans.

