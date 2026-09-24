-- Public snapshots are managed using a separate capability token. Only its
-- hash is retained. No account, model-photo original, or API key is shared.
begin;
create table if not exists public.capsule_shares (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb check (snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 4000000)),
  expiry text not null default '7d' constraint capsule_shares_expiry_mode check (expiry in ('7d', '30d', 'never')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capsule_shares_revoked_empty check (revoked_at is null or snapshot is null)
);
-- This also upgrades previews created before expiry mode was stored separately.
-- Snapshot updates preserve the deadline; their updated_at is not an expiry anchor.
alter table public.capsule_shares add column if not exists expiry text;
update public.capsule_shares set expiry = case
  when expires_at is null then 'never'
  when expires_at - updated_at > interval '8 days' then '30d'
  else '7d' end where expiry is null;
alter table public.capsule_shares alter column expiry set default '7d';
alter table public.capsule_shares alter column expiry set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'capsule_shares_expiry_mode' and conrelid = 'public.capsule_shares'::regclass) then
    alter table public.capsule_shares add constraint capsule_shares_expiry_mode check (expiry in ('7d', '30d', 'never'));
  end if;
end $$;
create index if not exists capsule_shares_expiry on public.capsule_shares (expires_at) where snapshot is not null;
create table if not exists public.capsule_share_limits (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  creations integer not null check (creations between 1 and 10)
);
create index if not exists capsule_share_limits_window on public.capsule_share_limits (window_start);
alter table public.capsule_shares enable row level security;
alter table public.capsule_share_limits enable row level security;
revoke all on public.capsule_shares, public.capsule_share_limits from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_shares, public.capsule_share_limits from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_shares, public.capsule_share_limits from authenticated;
  end if;
end $$;
commit;

-- Keep revoked/expired IDs as small tombstones so delayed creation retries
-- cannot resurrect them. The app removes expired snapshot bodies in batches.
select relname, relrowsecurity from pg_class
where oid in ('public.capsule_shares'::regclass, 'public.capsule_share_limits'::regclass);
