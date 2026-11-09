-- upsert_capabilities v2: write a row only when its merged value changes.
-- v1 updated every row on every crawl (verified_on = now(), fetched_at = now()), so a daily run rewrote ~145k
-- capability rows and their capability_source rows. Each new tuple version touched every index (HNSW, GIN
-- expression, trigram): the first Actions run (2026-11-09) hit the 8 s statement timeout on mcp_registry and
-- awesome_mcp batches and grew the DB 441 → 450 MB with unchanged data.
-- v2: ON CONFLICT ... DO UPDATE ... WHERE <merged row differs> OR <last stamp older than 7 days>.
-- Array unions are sorted so an unchanged set compares equal. "Seen" stamps refresh at most weekly, which is
-- enough for stale-row marking (docs/BACKLOG.md).

create or replace function public.upsert_capabilities(p_source text, p_curated boolean, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  r     jsonb;
  cap   uuid;
  n     integer := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    cap := null;
    insert into public.capability as c (
      slug, kind, name, description, publisher, official, homepage_url, repo_url, docs_url,
      categories, scope_tags, clients_supported, runtime_compat, install, auth, pricing,
      signals, quality, licence, tos_notes, status, verified_on, updated_at)
    values (
      r->>'slug', r->>'kind', r->>'name', nullif(r->>'description', ''), r->>'publisher',
      coalesce((r->>'official')::boolean, false), r->>'homepage_url', r->>'repo_url', r->>'docs_url',
      coalesce(array(select x from jsonb_array_elements_text(r->'categories') x order by x), '{}'),
      coalesce(array(select x from jsonb_array_elements_text(r->'scope_tags') x order by x), '{}'),
      coalesce(array(select x from jsonb_array_elements_text(r->'clients_supported') x order by x), '{}'),
      coalesce(array(select x from jsonb_array_elements_text(r->'runtime_compat') x order by x), '{}'),
      coalesce(r->'install', '{}'), coalesce(r->'auth', '{}'), coalesce(r->'pricing', '{}'),
      jsonb_build_object(p_source, coalesce(r->'signals', '{}')),
      coalesce(r->'quality', '{}'), r->>'licence', r->>'tos_notes',
      coalesce(r->>'status', 'active'), now(), now())
    on conflict (slug) do update set
      kind              = excluded.kind,
      name              = excluded.name,
      description       = coalesce(excluded.description, c.description),
      publisher         = coalesce(excluded.publisher, c.publisher),
      official          = c.official or excluded.official,
      homepage_url      = coalesce(excluded.homepage_url, c.homepage_url),
      repo_url          = coalesce(excluded.repo_url, c.repo_url),
      docs_url          = coalesce(excluded.docs_url, c.docs_url),
      categories        = array(select distinct x from unnest(c.categories || excluded.categories) x order by x),
      scope_tags        = array(select distinct x from unnest(c.scope_tags || excluded.scope_tags) x order by x),
      clients_supported = array(select distinct x from unnest(c.clients_supported || excluded.clients_supported) x order by x),
      runtime_compat    = array(select distinct x from unnest(c.runtime_compat || excluded.runtime_compat) x order by x),
      install           = c.install || excluded.install,
      auth              = c.auth || excluded.auth,
      pricing           = c.pricing || excluded.pricing,
      signals           = c.signals || excluded.signals,
      quality           = c.quality || excluded.quality,
      licence           = coalesce(excluded.licence, c.licence),
      tos_notes         = coalesce(excluded.tos_notes, c.tos_notes),
      status            = excluded.status,
      verified_on       = now(),
      updated_at        = now(),
      embedding         = case when c.name is distinct from excluded.name
                                 or c.description is distinct from coalesce(excluded.description, c.description)
                               then null else c.embedding end,
      embedding_model   = case when c.name is distinct from excluded.name
                                 or c.description is distinct from coalesce(excluded.description, c.description)
                               then null else c.embedding_model end
    where c.verified_on is null or c.verified_on < now() - interval '7 days'
       or (c.kind, c.name, c.description, c.publisher, c.official, c.homepage_url, c.repo_url, c.docs_url,
           -- rows written by v1 hold unsorted arrays: compare as sorted sets so they do not all rewrite once
           array(select distinct x from unnest(c.categories) x order by x),
           array(select distinct x from unnest(c.scope_tags) x order by x),
           array(select distinct x from unnest(c.clients_supported) x order by x),
           array(select distinct x from unnest(c.runtime_compat) x order by x),
           c.install, c.auth, c.pricing, c.signals, c.quality, c.licence, c.tos_notes, c.status)
          is distinct from
          (excluded.kind, excluded.name, coalesce(excluded.description, c.description),
           coalesce(excluded.publisher, c.publisher), c.official or excluded.official,
           coalesce(excluded.homepage_url, c.homepage_url), coalesce(excluded.repo_url, c.repo_url),
           coalesce(excluded.docs_url, c.docs_url),
           array(select distinct x from unnest(c.categories || excluded.categories) x order by x),
           array(select distinct x from unnest(c.scope_tags || excluded.scope_tags) x order by x),
           array(select distinct x from unnest(c.clients_supported || excluded.clients_supported) x order by x),
           array(select distinct x from unnest(c.runtime_compat || excluded.runtime_compat) x order by x),
           c.install || excluded.install, c.auth || excluded.auth, c.pricing || excluded.pricing,
           c.signals || excluded.signals, c.quality || excluded.quality,
           coalesce(excluded.licence, c.licence), coalesce(excluded.tos_notes, c.tos_notes), excluded.status)
    returning c.id into cap;

    -- Unchanged row: the WHERE above skipped the update, so RETURNING gave nothing.
    if cap is null then
      select c.id into cap from public.capability c where c.slug = r->>'slug';
    end if;

    insert into public.capability_source as s (source, source_id, capability_id, source_url, curated, raw, fetched_at)
    values (p_source, r->>'source_id', cap, r->>'source_url', p_curated, coalesce(r->'raw', '{}'), now())
    on conflict (source, source_id) do update set
      capability_id = excluded.capability_id,
      source_url    = excluded.source_url,
      curated       = excluded.curated,
      raw           = excluded.raw,
      fetched_at    = excluded.fetched_at
    where s.fetched_at < now() - interval '7 days'
       or (s.capability_id, s.source_url, s.curated, s.raw)
          is distinct from (excluded.capability_id, excluded.source_url, excluded.curated, excluded.raw);

    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.upsert_capabilities(text, boolean, jsonb) from public, anon, authenticated;
