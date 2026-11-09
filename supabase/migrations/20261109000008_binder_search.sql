-- Binder retrieval primitives (FRAMEWORK §7, RAMAN-TASK R6). Each returns one ranked list; the Binder
-- (src/lib/binder) fuses lists from many methods and phrasings with RRF (k = 50) in code, then re-ranks
-- with usage / curation / co-usage signals. All server-only (service role); revoked from anon/authenticated.

-- Method 1: keyword (Postgres FTS over the indexed capability_fts expression).
create or replace function public.binder_keyword(p_query text, p_kinds text[], p_limit integer)
returns table (id uuid, rank integer)
language sql
stable
set search_path = ''
as $$
  select c.id, (row_number() over (order by ts_rank_cd(public.capability_fts(c.name, c.description), q) desc))::int
  from public.capability c, websearch_to_tsquery('english', p_query) q
  where public.capability_fts(c.name, c.description) @@ q
    and c.status in ('active', 'provisional')
    and (p_kinds is null or c.kind = any(p_kinds))
  order by ts_rank_cd(public.capability_fts(c.name, c.description), q) desc
  limit p_limit
$$;

-- Method 2: semantic (gte-small, inner product on normalized vectors, HNSW).
create or replace function public.binder_semantic(p_embedding extensions.halfvec(384), p_kinds text[], p_limit integer)
returns table (id uuid, rank integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  -- Function-level SET of hnsw.* is refused for non-superusers (42501); set transaction-locally instead.
  perform set_config('hnsw.ef_search', greatest(p_limit, 40)::text, true);
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);
  return query
  select s.id, (row_number() over (order by s.d))::int
  from (
    select c.id, c.embedding operator(extensions.<#>) p_embedding as d
    from public.capability c
    where c.embedding is not null
      and c.status in ('active', 'provisional')
      and (p_kinds is null or c.kind = any(p_kinds))
    order by c.embedding operator(extensions.<#>) p_embedding
    limit p_limit
  ) s;
end;
$$;

-- Propose-and-verify, step 1: exact name / slug-tail match for names the prism LLM proposed, then trigram.
create or replace function public.binder_exact(p_names text[], p_limit integer)
returns table (id uuid, rank integer, proposed text, how text)
language sql
stable
set search_path = ''
as $$
  with hits as (
    select c.id, n as proposed,
           case when lower(c.name) = lower(n) then 'name'
                when c.slug ilike '%/' || lower(n) or c.slug ilike '%:' || lower(n) then 'slug'
                else 'trigram' end as how,
           case when lower(c.name) = lower(n) then 1.0
                when c.slug ilike '%/' || lower(n) or c.slug ilike '%:' || lower(n) then 0.95
                else extensions.similarity(c.name, n) end as score
    from unnest(p_names) n
    join public.capability c
      on (lower(c.name) = lower(n)
          or c.slug ilike '%/' || lower(n) or c.slug ilike '%:' || lower(n)
          or c.name operator(extensions.%) n)
    where c.status in ('active', 'provisional')
  )
  select h.id, (row_number() over (order by h.score desc))::int, h.proposed, h.how
  from (select distinct on (id) * from hits order by id, score desc) h
  where h.score >= 0.5
  order by h.score desc
  limit p_limit
$$;

-- Method 8: historical runs. Items bound in the nearest past runs (by request embedding).
create or replace function public.binder_history(p_embedding extensions.halfvec(384), p_runs integer, p_limit integer)
returns table (id uuid, rank integer)
language sql
stable
set search_path = ''
as $$
  with near as (
    select r.id from public.run r
    where r.request_embedding is not null and r.status = 'done'
    order by r.request_embedding operator(extensions.<#>) p_embedding
    limit p_runs
  ), hits as (
    select b.capability_id, count(*) as n, min(b.rank) as best
    from near join public.node nd on nd.run_id = near.id
    join public.binding b on b.node_id = nd.id
    group by b.capability_id
  )
  select capability_id, (row_number() over (order by n desc, best))::int
  from hits order by n desc, best limit p_limit
$$;

-- Candidate cards: everything the re-rank and the coverage judgment need, plus curation and co-usage counts.
create or replace function public.binder_cards(p_ids uuid[])
returns table (
  id uuid, slug text, kind text, name text, description text, publisher text, official boolean,
  homepage_url text, repo_url text, docs_url text, categories text[], scope_tags text[],
  clients_supported text[], runtime_compat text[], install jsonb, auth jsonb, pricing jsonb,
  signals jsonb, quality jsonb, licence text, tos_notes text, verified_on timestamptz,
  curated_count integer, source_count integer, sources text[], co_usage integer
)
language sql
stable
set search_path = ''
as $$
  select c.id, c.slug, c.kind, c.name, c.description, c.publisher, c.official,
         c.homepage_url, c.repo_url, c.docs_url, c.categories, c.scope_tags,
         c.clients_supported, c.runtime_compat, c.install, c.auth, c.pricing,
         c.signals, c.quality, c.licence, coalesce(c.tos_notes, ss.tos_notes), c.verified_on,
         coalesce(src.curated_count, 0), coalesce(src.source_count, 0), coalesce(src.sources, '{}'),
         coalesce(cu.n, 0)
  from public.capability c
  left join lateral (
    select count(*) filter (where s.curated)::int as curated_count, count(*)::int as source_count,
           array_agg(s.source order by s.source) as sources
    from public.capability_source s where s.capability_id = c.id
  ) src on true
  left join lateral (
    select ss.tos_notes from public.source_sync ss where ss.source = any(src.sources) and ss.tos_notes is not null limit 1
  ) ss on true
  left join lateral (
    select sum(u.count)::int as n from public.co_usage u where u.a = c.id or u.b = c.id
  ) cu on true
  where c.id = any(p_ids)
$$;

revoke all on function public.binder_keyword(text, text[], integer) from public, anon, authenticated;
revoke all on function public.binder_semantic(extensions.halfvec, text[], integer) from public, anon, authenticated;
revoke all on function public.binder_exact(text[], integer) from public, anon, authenticated;
revoke all on function public.binder_history(extensions.halfvec, integer, integer) from public, anon, authenticated;
revoke all on function public.binder_cards(uuid[]) from public, anon, authenticated;
