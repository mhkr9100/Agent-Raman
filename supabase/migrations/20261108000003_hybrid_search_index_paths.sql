-- hybrid_search v2: same signature and output, but each branch is a flat, filtered, ordered scan so the
-- planner uses the HNSW and GIN indexes. v1 joined a `candidates` CTE and ranked with a window over the
-- whole table, which forced a full distance scan: 8 s statement timeout at 57k embedded rows (2026-11-08).
-- pgvector 0.8 iterative scans keep filtered HNSW queries from returning too few rows, and ef_search must
-- be >= the branch limit (default 40 would cap results at 40).
-- Docs, verified 2026-11-08: https://github.com/pgvector/pgvector#iterative-index-scans
--                            https://supabase.com/docs/guides/ai/hybrid-search
create or replace function public.hybrid_search(
  query_text       text,
  query_embedding  extensions.halfvec(384),
  match_count      int     default 20,
  kinds            text[]  default null,
  clients          text[]  default null,
  full_text_weight float   default 1,
  semantic_weight  float   default 1,
  rrf_k            int     default 50
)
returns table (id uuid, slug text, name text, kind text, fts_rank int, semantic_rank int, score float)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
begin
  -- Function-level SET of hnsw.* is refused for non-superusers (42501), so set them transaction-locally.
  perform set_config('hnsw.ef_search', '100', true);
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  return query
  with full_text as (
    select ft.id, row_number() over (order by ft.r desc) as rank_ix
    from (
      select c.id, ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) as r
      from public.capability c
      where c.fts @@ websearch_to_tsquery('english', query_text)
        and c.status in ('active','provisional')
        and (kinds is null or c.kind = any(kinds))
        and (clients is null or c.clients_supported && clients or 'any' = any(c.clients_supported)
             or cardinality(c.clients_supported) = 0)
      order by r desc
      limit least(match_count, 50) * 2
    ) ft
  ),
  semantic as (
    select s.id, row_number() over (order by s.d) as rank_ix
    from (
      select c.id, c.embedding operator(extensions.<#>) query_embedding as d
      from public.capability c
      where query_embedding is not null
        and c.embedding is not null
        and c.status in ('active','provisional')
        and (kinds is null or c.kind = any(kinds))
        and (clients is null or c.clients_supported && clients or 'any' = any(c.clients_supported)
             or cardinality(c.clients_supported) = 0)
      order by c.embedding operator(extensions.<#>) query_embedding
      limit least(match_count, 50) * 2
    ) s
  )
  select c.id, c.slug, c.name, c.kind,
         ft.rank_ix::int, s.rank_ix::int,
         (coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
          coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight)::float as score
  from full_text ft
  full outer join semantic s on ft.id = s.id
  join public.capability c on c.id = coalesce(ft.id, s.id)
  order by score desc
  limit least(match_count, 50);
end;
$$;

revoke all on function public.hybrid_search(text, extensions.halfvec, int, text[], text[], float, float, int) from public, anon, authenticated;
