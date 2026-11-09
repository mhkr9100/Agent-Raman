-- Embedding budget (decision 2026-11-08: stay on the Supabase free tier and trim). Not every row fits as a
-- vector under 500 MB (projected ~600 MB fully embedded at 144k rows), so rows are embedded in priority order
-- until the crawler's size cap (crawler/db.ts EMBED_CAP_BYTES). Rows without a vector stay keyword-searchable.
-- Going over 500 MB risks an org-wide HTTP 402 Fair Use restriction, judged on the average daily size over the
-- billing period: https://supabase.com/docs/guides/platform/database-size (verified 2026-11-08).

-- Mass publishers: one remote host or registry namespace that lists >= 1000 MCP servers (e.g. one server per
-- time zone). Measured 2026-11-08: 5 keys, ~9.1k rows. They stay in the catalog but are not embedded.
create table if not exists public.publisher_flag (
  key        text primary key,
  rows       integer not null,
  reason     text not null,
  flagged_on date not null default current_date
);
alter table public.publisher_flag enable row level security;

-- MCP servers only: remote host if the server is remote, else the registry namespace (never 'github.com').
create or replace function public.capability_publisher_key(p_kind text, p_slug text, p_install jsonb)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_kind <> 'mcp_server' then null
              else coalesce(substring(p_install->>'claude_code' from 'https?://([^/ ]+)'),
                            nullif(split_part(substring(p_slug from 5), '/', 1), 'github.com'))
         end
$$;

create or replace function public.refresh_publisher_flags(p_min_rows integer default 1000)
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  delete from public.publisher_flag where true;
  insert into public.publisher_flag (key, rows, reason)
  select k, count(*), format('mass publisher: >= %s MCP servers under one host or namespace', p_min_rows)
  from (select public.capability_publisher_key(kind, slug, install) as k
        from public.capability where kind = 'mcp_server') x
  where k is not null
  group by k
  having count(*) >= p_min_rows;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Next rows to embed, best first: plugins, curated or official items, models, MCP servers, then skills by installs.
create or replace function public.pending_embeddings(p_limit integer)
returns table (id uuid, name text, description text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.name, c.description
  from public.capability c
  where c.embedding is null
    and c.status in ('active', 'provisional')
    and not exists (select 1 from public.publisher_flag f
                    where f.key = public.capability_publisher_key(c.kind, c.slug, c.install))
  order by
    -- EXISTS instead of joining capability_curation: the view aggregated every source row per call (6.9 s,
    -- over PostgREST's 8 s limit when cold); this form measured 2.1 s on 2026-11-08.
    case when c.kind = 'plugin' or c.official
              or exists (select 1 from public.capability_source s where s.capability_id = c.id and s.curated) then 0
         when c.kind = 'model' then 1
         when c.kind = 'mcp_server' then 2
         else 3 end,
    coalesce((c.signals->'clawhub'->>'installs')::int, 0) desc,
    c.id
  limit p_limit
$$;

revoke all on function public.refresh_publisher_flags(integer) from public, anon, authenticated;
revoke all on function public.pending_embeddings(integer) from public, anon, authenticated;

select public.refresh_publisher_flags(1000);
