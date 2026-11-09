-- Slim capability rows to fit the 500 MB Supabase free tier (decision 2026-11-08: stay free and trim).
-- Measured 2026-11-08 on 144k rows: stored `fts` averaged 190–410 B/row (~36 MB of heap) and duplicates
-- what its GIN index already holds; ClawHub repeated one 175 B terms note on 72.7k rows (~13 MB).
-- 1) fts becomes an index on an immutable expression (same weights, same config) instead of a stored column.
-- 2) Per-source terms notes live once on source_sync.

create or replace function public.capability_fts(p_name text, p_description text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(p_name, '')), 'A') ||
         setweight(to_tsvector('english'::regconfig, coalesce(p_description, '')), 'B')
$$;

alter table public.capability drop column fts;  -- also drops capability_fts_idx
create index capability_fts_idx on public.capability using gin (public.capability_fts(name, description));

alter table public.source_sync add column if not exists tos_notes text;
insert into public.source_sync (source, tos_notes)
values ('clawhub', 'ClawHub public catalog reuse: cache results, link back to the canonical ClawHub listing, do not imply endorsement, do not mirror hidden/private/moderation-blocked content.')
on conflict (source) do update set tos_notes = excluded.tos_notes;
-- Existing rows are cleared by the table rewrite in 20261108000006 (an UPDATE here would add ~100 MB of dead tuples).

-- hybrid_search reads full text through the indexed expression (body otherwise identical to 20261108000003).
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
      select c.id, ts_rank_cd(public.capability_fts(c.name, c.description), websearch_to_tsquery('english', query_text)) as r
      from public.capability c
      where public.capability_fts(c.name, c.description) @@ websearch_to_tsquery('english', query_text)
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

-- Size guard: the crawler stops embedding / writing before the 500 MB free-tier limit.
create or replace function public.catalog_db_bytes()
returns bigint
language sql
stable
set search_path = ''
as $$ select pg_database_size(current_database()) $$;
revoke all on function public.catalog_db_bytes() from public, anon, authenticated;
