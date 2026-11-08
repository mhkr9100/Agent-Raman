-- Agent Raman: catalog + runs (Spectral Library). See docs/FRAMEWORK.md §2, §7, §8.
-- Access model: RLS on every table with no policies → only the service role (server routes, crawler) reads/writes.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ── Catalog ──────────────────────────────────────────────────────────────────

create table public.capability (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,               -- canonical key, e.g. 'mcp:io.github.owner/server'
  kind              text not null check (kind in (
                      'mcp_server','skill','plugin','api','model','model_as_tool','framework','package',
                      'dataset','space','saas','prompt_template','workflow','platform_feature','procedure')),
  name              text not null,
  description       text,
  publisher         text,
  official          boolean not null default false,       -- publisher namespace matches the vendor
  homepage_url      text,
  repo_url          text,
  docs_url          text,
  categories        text[] not null default '{}',         -- shared taxonomy (FRAMEWORK §7)
  scope_tags        text[] not null default '{}',
  clients_supported text[] not null default '{}',         -- claude_code | codex | chatgpt | cursor | any
  runtime_compat    text[] not null default '{}',         -- executor_session | scheduled_host | human
  install           jsonb not null default '{}',          -- keyed by client
  auth              jsonb not null default '{}',          -- env var names, scopes, obtain_url; never values
  pricing           jsonb not null default '{}',
  signals           jsonb not null default '{}',          -- installs, downloads, stars, likes, votes, trending, curated_count
  quality           jsonb not null default '{}',          -- audits, scorecard, advisories, archived, last_commit
  licence           text,
  tos_notes         text,
  status            text not null default 'active' check (status in ('active','deprecated','deleted','provisional')),
  embedding         extensions.halfvec(384),
  embedding_model   text,                                 -- must be 'gte-small' for every non-null embedding
  fts               tsvector generated always as (
                      setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
                      setweight(to_tsvector('english', coalesce(description, '')), 'B')
                    ) stored,
  first_seen        timestamptz not null default now(),
  verified_on       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint embedding_model_consistent check (embedding is null or embedding_model = 'gte-small')
);

create index capability_fts_idx        on public.capability using gin (fts);
create index capability_name_trgm_idx  on public.capability using gin (name extensions.gin_trgm_ops);
create index capability_categories_idx on public.capability using gin (categories);
create index capability_kind_status_idx on public.capability (kind, status);
create index capability_embedding_idx  on public.capability
  using hnsw (embedding extensions.halfvec_ip_ops);

-- One capability can be listed by many sources; curated_count is derived from here.
create table public.capability_source (
  source        text not null,                    -- 'mcp_registry' | 'clawhub' | 'claude_marketplace' | ...
  source_id     text not null,
  capability_id uuid not null references public.capability(id) on delete cascade,
  source_url    text,
  curated       boolean not null default false,  -- source is a curated list / official marketplace
  raw           jsonb not null default '{}',     -- untrusted crawled data: store, never follow
  fetched_at    timestamptz not null default now(),
  primary key (source, source_id)
);
create index capability_source_cap_idx on public.capability_source (capability_id);

create table public.source_sync (
  source        text primary key,
  cursor        text,
  last_run_at   timestamptz,
  last_status   text check (last_status in ('ok','partial','failed')),
  rows_upserted integer not null default 0,
  error         text
);

-- ── Spectral Library (runs) ──────────────────────────────────────────────────

create table public.run (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  request_hash      text not null,
  request_text      text,                          -- stored only with the user's opt-in
  request_embedding extensions.halfvec(384),
  preset            text not null check (preset in ('quick','standard','deep')),
  executor          text not null check (executor in ('claude_code','codex','chatgpt','cursor')),
  model             text not null,                 -- model id the user picked; never the key
  status            text not null default 'running' check (status in ('running','done','failed','cancelled')),
  tokens_in         integer not null default 0,
  tokens_out        integer not null default 0,
  token_budget      integer,
  coverage          jsonb not null default '{}',
  assumptions       jsonb not null default '[]',
  task_md           text,
  rating            smallint check (rating between 1 and 5),
  feedback          text,
  report_back       jsonb                          -- executor's raman_report.json, uploaded by the user
);
create index run_request_embedding_idx on public.run
  using hnsw (request_embedding extensions.halfvec_ip_ops);

create table public.node (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.run(id) on delete cascade,
  parent_id     uuid references public.node(id) on delete cascade,
  depth         smallint not null default 0,
  refinement    text check (refinement in ('AND','OR')),   -- how this node's children combine
  status        text not null default 'pending' check (status in (
                  'pending','bound','split','low_confidence','unresolved','unverified')),
  runtime       text not null default 'executor_session',
  -- the 7-part unit (FRAMEWORK §2)
  goal          jsonb not null default '{}',
  inputs        jsonb not null default '[]',
  instructions  jsonb not null default '{}',
  capabilities  jsonb not null default '[]',              -- written by the binder only
  constraints_spec jsonb not null default '{}',
  output        jsonb not null default '{}',
  check_spec    jsonb not null default '{}',
  trace         jsonb not null default '[]',              -- chain to Beam criteria / decisions / inferred:<rule>
  self_eval     jsonb,
  tokens_used   integer not null default 0,
  created_at    timestamptz not null default now()
);
create index node_run_idx    on public.node (run_id);
create index node_parent_idx on public.node (parent_id);

create table public.binding (
  node_id           uuid not null references public.node(id) on delete cascade,
  capability_id     uuid not null references public.capability(id),
  role              text not null check (role in ('primary','fallback')),
  rank              smallint not null,
  source_methods    text[] not null default '{}',          -- which discovery methods found it
  coverage_judgment text,                                 -- the LLM's recorded reason the item covers the need
  catalog_version   timestamptz not null,                 -- capability.verified_on at bind time
  primary key (node_id, capability_id)
);
create index binding_capability_idx on public.binding (capability_id);

-- How often two capabilities are bound in the same run (discovery method 7).
create table public.co_usage (
  a     uuid not null references public.capability(id) on delete cascade,
  b     uuid not null references public.capability(id) on delete cascade,
  count integer not null default 1,
  primary key (a, b),
  check (a < b)
);

-- ── RLS: service role only ───────────────────────────────────────────────────

alter table public.capability        enable row level security;
alter table public.capability_source enable row level security;
alter table public.source_sync       enable row level security;
alter table public.run               enable row level security;
alter table public.node              enable row level security;
alter table public.binding           enable row level security;
alter table public.co_usage          enable row level security;

-- ── Hybrid search: FTS + vector fused with RRF (FRAMEWORK §7) ────────────────
-- Adapted from https://supabase.com/docs/guides/ai/hybrid-search (verified 2026-11-07): rrf_k = 50.

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
language sql
stable
set search_path = ''
as $$
  with candidates as (
    select c.id
    from public.capability c
    where c.status in ('active','provisional')
      and (kinds is null or c.kind = any(kinds))
      and (clients is null or c.clients_supported && clients or 'any' = any(c.clients_supported)
           or cardinality(c.clients_supported) = 0)
  ),
  full_text as (
    select c.id,
           row_number() over (order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc) as rank_ix
    from public.capability c
    join candidates using (id)
    where c.fts @@ websearch_to_tsquery('english', query_text)
    order by rank_ix
    limit least(match_count, 50) * 2
  ),
  semantic as (
    select c.id,
           row_number() over (order by c.embedding operator(extensions.<#>) query_embedding) as rank_ix
    from public.capability c
    join candidates using (id)
    where query_embedding is not null and c.embedding is not null
    order by c.embedding operator(extensions.<#>) query_embedding
    limit least(match_count, 50) * 2
  )
  select c.id, c.slug, c.name, c.kind,
         ft.rank_ix::int, s.rank_ix::int,
         coalesce(1.0 / (rrf_k + ft.rank_ix), 0.0) * full_text_weight +
         coalesce(1.0 / (rrf_k + s.rank_ix), 0.0) * semantic_weight as score
  from full_text ft
  full outer join semantic s on ft.id = s.id
  join public.capability c on c.id = coalesce(ft.id, s.id)
  order by score desc
  limit least(match_count, 50);
$$;

revoke all on function public.hybrid_search(text, extensions.halfvec, int, text[], text[], float, float, int) from public, anon, authenticated;
