-- Existing Capsule databases: run in the Supabase SQL editor before merging
-- the share view counter. Re-running this migration is safe.
begin;
alter table public.capsule_shares add column if not exists views bigint not null default 0;
alter table public.capsule_shares add column if not exists last_viewed_at timestamptz;
create table if not exists public.capsule_share_views (
  share_id text not null references public.capsule_shares (id) on delete cascade,
  viewer_hash text not null check (viewer_hash ~ '^[a-f0-9]{64}$'),
  viewed_at timestamptz not null default now(),
  primary key (share_id, viewer_hash)
);
create index if not exists capsule_share_views_viewed on public.capsule_share_views (viewed_at);
alter table public.capsule_share_views enable row level security;
revoke all on public.capsule_share_views from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_share_views from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_share_views from authenticated;
  end if;
end $$;
commit;
