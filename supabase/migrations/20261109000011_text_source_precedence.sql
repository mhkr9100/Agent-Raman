-- Name/description precedence across sources. Before this, two sources listing the same server overwrote each
-- other's name and description on every crawl, and each overwrite nulled the embedding: all 2,175 servers listed
-- by both awesome-mcp-servers and the MCP Registry had lost their vectors by 2026-11-09.
-- Rule: a source may set name/description only if its rank <= the rank of the source that set them last
-- (`text_source`). Curated, human-written listings win over self-published registry text. Embeddings are
-- cleared only when the applied text really changes.
alter table public.capability add column if not exists text_source text;

create or replace function public.text_source_rank(p_source text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_source is null                then 99   -- text never claimed: any source may set it
              when p_source = 'claude_marketplace' then 1
              when p_source = 'awesome_mcp'        then 2
              when p_source = 'mcp_registry'       then 3
              else 5 end
$$;

-- Existing shared rows: awesome_mcp wrote their text last; record it so the registry cannot flip it back.
update public.capability c set text_source = 'awesome_mcp'
where c.text_source is null
  and exists (select 1 from public.capability_source s where s.capability_id = c.id and s.source = 'awesome_mcp');

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
      signals, quality, licence, tos_notes, status, verified_on, updated_at, text_source)
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
      coalesce(r->>'status', 'active'), now(), now(), p_source)
    on conflict (slug) do update set
      kind              = excluded.kind,
      name              = case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                               then excluded.name else c.name end,
      description       = case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                               then coalesce(excluded.description, c.description)
                               else coalesce(c.description, excluded.description) end,
      text_source       = case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                               then p_source else c.text_source end,
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
      embedding         = case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                                    and (c.name is distinct from excluded.name
                                         or c.description is distinct from coalesce(excluded.description, c.description))
                               then null else c.embedding end,
      embedding_model   = case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                                    and (c.name is distinct from excluded.name
                                         or c.description is distinct from coalesce(excluded.description, c.description))
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
          (excluded.kind,
           case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source) then excluded.name else c.name end,
           case when public.text_source_rank(p_source) <= public.text_source_rank(c.text_source)
                then coalesce(excluded.description, c.description) else coalesce(c.description, excluded.description) end,
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
