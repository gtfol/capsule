-- Shared counters for on-demand product imports, prices, and image fetches.
-- Only keyed IP digests are retained; no raw addresses or product URLs.
begin;
create table if not exists public.capsule_request_limits (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  requests integer not null check (requests > 0)
);
create index if not exists capsule_request_limits_window on public.capsule_request_limits (window_start);
alter table public.capsule_request_limits enable row level security;
revoke all on public.capsule_request_limits from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_request_limits from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_request_limits from authenticated;
  end if;
end $$;
commit;

select relname, relrowsecurity from pg_class
where oid = 'public.capsule_request_limits'::regclass;
