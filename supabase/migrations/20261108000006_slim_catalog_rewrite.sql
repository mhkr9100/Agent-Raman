-- One-off table rewrite (instead of a 72k-row UPDATE that would add ~100 MB of dead tuples near the 500 MB cap):
-- clears the per-row ClawHub terms note (now on source_sync), drops vectors of the mass publishers flagged in
-- 20261108000005, and compacts dead tuples plus the dropped fts column. Result 2026-11-08: 477 MB -> 356 MB
-- including the rebuilt HNSW index (57 MB, 51,402 vectors).
drop index if exists public.capability_embedding_idx;
alter table public.capability
  alter column tos_notes type text using (
    case when tos_notes = 'ClawHub public catalog reuse: cache results, link back to the canonical ClawHub listing, do not imply endorsement, do not mirror hidden/private/moderation-blocked content.'
         then null else tos_notes end),
  alter column embedding type extensions.halfvec(384) using (
    case when public.capability_publisher_key(kind, slug, install) in (
           'agent-observatory-sensor.nolimit-observatory.workers.dev', 'gateway.pipeworx.io',
           'io.github.mrfentmen', 'api.mcp.ai')
         then null else embedding end);

-- Free-tier Nano compute: the default timeout cancels the build, and parallel workers cannot get shared memory.
set local statement_timeout = '15min';
set local max_parallel_maintenance_workers = 0;
create index capability_embedding_idx on public.capability using hnsw (embedding extensions.halfvec_ip_ops);
