-- binder_exact v2 and binder_keyword v2. Measured 2026-11-09 on 144k rows (free-tier Nano):
-- - v1 exact joined on (name = n OR slug suffix OR trigram) → no index usable, 13.2 s. v2: case-insensitive
--   equality (trigram index, ~90 ms) + strict word similarity >= 0.8, top 10 per name → 116 ms.
-- - keyword: AND semantics by default (websearch_to_tsquery). p_any = true ORs the terms for recall; costs
--   ~2 s on common words because ts_rank_cd recomputes capability_fts per match (no stored column since 000004).
drop function if exists public.binder_keyword(text, text[], integer);
create or replace function public.binder_keyword(p_query text, p_kinds text[], p_limit integer, p_any boolean default false)
returns table (id uuid, rank integer)
language sql
stable
set search_path = ''
as $$
  with q as (
    select case when p_any then replace(plainto_tsquery('english', p_query)::text, '&', '|')::tsquery
                else websearch_to_tsquery('english', p_query) end as q
  )
  select c.id, (row_number() over (order by ts_rank_cd(public.capability_fts(c.name, c.description), q.q) desc))::int
  from public.capability c, q
  where public.capability_fts(c.name, c.description) @@ q.q
    and c.status in ('active', 'provisional')
    and (p_kinds is null or c.kind = any(p_kinds))
  order by ts_rank_cd(public.capability_fts(c.name, c.description), q.q) desc
  limit p_limit
$$;

drop function if exists public.binder_exact(text[], integer);
create or replace function public.binder_exact(p_names text[], p_limit integer)
returns table (id uuid, rank integer, proposed text, how text)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform set_config('pg_trgm.strict_word_similarity_threshold', '0.8', true);
  return query
  with hits as (
    select c.id, n as proposed, 'name'::text as how, 1.0::float8 as score
    from unnest(p_names) n join public.capability c on c.name ilike n
    where c.status in ('active', 'provisional')
    union all
    select t.id, n, 'trigram', t.score
    from unnest(p_names) n
    cross join lateral (
      select c.id, extensions.strict_word_similarity(n, c.name)::float8 as score
      from public.capability c
      where c.name operator(extensions.%>>) n and c.status in ('active', 'provisional')
      order by 2 desc limit 10
    ) t
  )
  select h.id, (row_number() over (order by h.score desc))::int, h.proposed, h.how
  from (select distinct on (hits.id) hits.* from hits order by hits.id, hits.score desc) h
  order by h.score desc
  limit p_limit;
end;
$$;

revoke all on function public.binder_keyword(text, text[], integer, boolean) from public, anon, authenticated;
revoke all on function public.binder_exact(text[], integer) from public, anon, authenticated;
