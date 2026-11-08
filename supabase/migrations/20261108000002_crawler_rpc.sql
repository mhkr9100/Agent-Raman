-- Crawler write path. Called only with the service role (crawler/db.ts).
-- Multi-source merge rules: signals are namespaced per source; categories/scope_tags union;
-- install/quality/auth merge (newer keys win); description never overwritten with null;
-- an embedding is cleared when name or description changes so the crawler re-embeds it.

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
    insert into public.capability as c (
      slug, kind, name, description, publisher, official, homepage_url, repo_url, docs_url,
      categories, scope_tags, clients_supported, runtime_compat, install, auth, pricing,
      signals, quality, licence, tos_notes, status, verified_on, updated_at)
    values (
      r->>'slug', r->>'kind', r->>'name', nullif(r->>'description', ''), r->>'publisher',
      coalesce((r->>'official')::boolean, false), r->>'homepage_url', r->>'repo_url', r->>'docs_url',
      coalesce(array(select jsonb_array_elements_text(r->'categories')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'scope_tags')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'clients_supported')), '{}'),
      coalesce(array(select jsonb_array_elements_text(r->'runtime_compat')), '{}'),
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
      categories        = array(select distinct unnest(c.categories || excluded.categories)),
      scope_tags        = array(select distinct unnest(c.scope_tags || excluded.scope_tags)),
      clients_supported = array(select distinct unnest(c.clients_supported || excluded.clients_supported)),
      runtime_compat    = array(select distinct unnest(c.runtime_compat || excluded.runtime_compat)),
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
    returning c.id into cap;

    insert into public.capability_source (source, source_id, capability_id, source_url, curated, raw, fetched_at)
    values (p_source, r->>'source_id', cap, r->>'source_url', p_curated, coalesce(r->'raw', '{}'), now())
    on conflict (source, source_id) do update set
      capability_id = excluded.capability_id,
      source_url    = excluded.source_url,
      curated       = excluded.curated,
      raw           = excluded.raw,
      fetched_at    = excluded.fetched_at;

    n := n + 1;
  end loop;
  return n;
end;
$$;

-- p_items: [{ "id": uuid, "embedding": [384 floats] }]
create or replace function public.set_embeddings(p_items jsonb)
returns integer
language sql
set search_path = ''
as $$
  with upd as (
    update public.capability c
    set embedding = (i->>'embedding')::extensions.halfvec(384),
        embedding_model = 'gte-small'
    from jsonb_array_elements(p_items) i
    where c.id = (i->>'id')::uuid
    returning 1
  )
  select count(*)::int from upd;
$$;

-- Curation signal (discovery method 10): number of curated sources listing each capability.
create or replace view public.capability_curation
with (security_invoker = true) as
select capability_id, count(*) filter (where curated) as curated_count, count(*) as source_count
from public.capability_source
group by capability_id;

revoke all on function public.upsert_capabilities(text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.set_embeddings(jsonb) from public, anon, authenticated;
revoke all on public.capability_curation from anon, authenticated;
