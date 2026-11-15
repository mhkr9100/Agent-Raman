-- Prism engine state (RAMAN-TASK R7, R10). One node batch per request: the run row carries the phase, the
-- request "beam" (verbatim spans, criteria, decisions, environment profile) and the engine counters.
-- All server-only: RLS stays on (no policies), functions revoked from anon/authenticated.

alter table public.run
  add column if not exists phase text not null default 'intake'
    check (phase in ('intake','decisions','expand','obstacles','critic','finalize','done')),
  add column if not exists provider text,
  add column if not exists source text not null default 'web' check (source in ('web','mcp','eval')),
  add column if not exists beam jsonb not null default '{}',
  add column if not exists state jsonb not null default '{}',
  add column if not exists keep_text boolean not null default false,
  add column if not exists locked_until timestamptz;

-- Leaf kinds the framework names but the first schema lacked: "build it" leaves (§3 rule 6) and human steps.
alter table public.node drop constraint if exists node_status_check;
alter table public.node add constraint node_status_check
  check (status in ('pending','bound','split','low_confidence','unresolved','unverified','build','human'));
alter table public.node add column if not exists key text not null default '';
create index if not exists node_run_idx on public.node (run_id);

-- One step at a time per run. Returns true when the caller now holds the lock.
create or replace function public.claim_run(p_run uuid, p_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare ok boolean;
begin
  update public.run set locked_until = now() + make_interval(secs => p_seconds)
  where id = p_run and status = 'running' and (locked_until is null or locked_until < now())
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

create or replace function public.release_run(p_run uuid)
returns void
language sql
set search_path = ''
as $$ update public.run set locked_until = null where id = p_run $$;

-- Spectral Library reuse (FRAMEWORK §8): nearest finished runs to a request embedding.
create or replace function public.similar_runs(p_embedding extensions.halfvec(384), p_exclude uuid, p_limit integer)
returns table (id uuid, similarity real, request_hash text, created_at timestamptz, executor text, coverage jsonb, state jsonb)
language sql
stable
set search_path = ''
as $$
  select r.id, (-(r.request_embedding operator(extensions.<#>) p_embedding))::real, r.request_hash, r.created_at,
         r.executor, r.coverage, r.state
  from public.run r
  where r.request_embedding is not null and r.status = 'done' and r.id <> p_exclude
  order by r.request_embedding operator(extensions.<#>) p_embedding
  limit least(p_limit, 10)
$$;

-- Co-usage signal: every pair of capabilities bound in one finished run (a < b).
create or replace function public.bump_co_usage(p_ids uuid[])
returns integer
language plpgsql
set search_path = ''
as $$
declare n integer;
begin
  insert into public.co_usage as c (a, b, count)
  select x.id, y.id, 1
  from (select distinct unnest(p_ids) as id) x
  join (select distinct unnest(p_ids) as id) y on x.id < y.id
  on conflict (a, b) do update set count = c.count + 1;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.claim_run(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_run(uuid) from public, anon, authenticated;
revoke all on function public.similar_runs(extensions.halfvec, uuid, integer) from public, anon, authenticated;
revoke all on function public.bump_co_usage(uuid[]) from public, anon, authenticated;
