-- pending_embeddings (20261108000005) sorted ~84k rows per call and still exceeded PostgREST's 8 s timeout on
-- free-tier compute when the cache was cold (2026-11-08). Ranking moved to crawler/embed.ts (rankedPending),
-- which pages by id. publisher_flag and capability_publisher_key stay; the crawler mirrors the key logic.
drop function if exists public.pending_embeddings(integer);
