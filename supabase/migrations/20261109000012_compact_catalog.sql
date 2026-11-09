-- Compaction after the v1 upsert churn (2026-11-09): 454 MB → 380 MB before the HNSW rebuild.
-- VACUUM FULL cannot run inside a migration transaction, so it was run as standalone statements between the
-- two steps below. Repeat this sequence whenever dead tuples hold the DB above the crawler's caps:
--   1) drop the HNSW index (rebuilding it inside VACUUM FULL exceeds free-tier memory and time)
--   2) VACUUM FULL public.capability;  VACUUM FULL public.capability_source;   (standalone)
--   3) rebuild HNSW with the settings below
drop index if exists public.capability_embedding_idx;

set local statement_timeout = '15min';
set local max_parallel_maintenance_workers = 0;
create index capability_embedding_idx on public.capability using hnsw (embedding extensions.halfvec_ip_ops);
