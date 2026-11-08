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
