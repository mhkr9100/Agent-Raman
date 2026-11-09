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
- [ ] 29.6k dead tuples (~40 MB) left by `set_embeddings` updates hold the DB at the 440 MB embedding cap with 81k of 144k rows embedded (2026-11-08). A table rewrite (see 20261108000006) would free room for roughly 15-20k more vectors. Longer term: write embeddings in the same upsert as the row, or move to a larger free Postgres (`docs/research/free-db-options.md`).
- [ ] Once the catalog grows past the 470 MB write cap, crawls stop and the catalog goes stale. Needs a retention rule (drop rows below a quality floor) or a bigger database before then.

## Binder (R6, 2026-11-09)
- [ ] LLM-mode eval not run yet: needs `EVAL_PROVIDER`, `EVAL_MODEL`, `EVAL_API_KEY` in `.env.local` (`npm run eval:binder -- --llm`). Gates still open: zero wrong binds, cadence trap.
- [ ] `capability.official` is unreliable: it marks registry namespace = repo owner (self-published spam gets `true`; github/github-mcp-server gets `false`). Re-rank ignores it until fixed.
- [ ] Usage and vote signals exist only for ClawHub skills, so the re-rank tilts toward skills over curated MCP servers. Add GitHub stars (awesome-mcp / repo metadata) or normalize per kind.
- [ ] Anthropic's own document skills (pdf, docx, xlsx, pptx from anthropics/skills) are missing from the catalog; only ClawHub copies exist. Add that marketplace (R4).
- [ ] No `platform_feature` / `procedure` rows yet (GitHub Actions schedule, OS cron, Apps Script triggers). Without them a scheduled-host need can only end UNVERIFIED (R4 seed list with vendor-doc URLs).
- [ ] Retrieval miss: "generate an image" ranks video models first (image-generation eval item).
- [ ] Keyword OR fallback (`binder_keyword(p_any => true)`) costs ~3 s for long needs on Nano and is unused; revisit if a stored tsvector fits the budget again.
