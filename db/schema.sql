-- Run once in the Supabase SQL editor for the Capsule database.
-- The application connects through DATABASE_URL; no browser database keys.
create table if not exists "user" (
  "id" text primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);
create table if not exists "session" (
  "id" text primary key,
  "expiresAt" timestamp not null,
  "token" text not null unique,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade
);
create index if not exists session_user_id on "session" ("userId");
create table if not exists "account" (
  "id" text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamp,
  "refreshTokenExpiresAt" timestamp,
  "scope" text,
  "password" text,
  "createdAt" timestamp not null default now(),
  "updatedAt" timestamp not null default now()
);
create index if not exists account_user_id on "account" ("userId");
create table if not exists "verification" (
  "id" text primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamp not null,
  "createdAt" timestamp default now(),
  "updatedAt" timestamp default now()
);
create index if not exists verification_identifier on "verification" ("identifier");

create sequence if not exists capsule_sync_revision;
create table if not exists capsule_records (
  user_id text not null references "user" (id) on delete cascade,
  collection text not null check (collection in ('items', 'outfits', 'wishlist')),
  id uuid not null,
  record jsonb not null,
  revision bigint not null default nextval('capsule_sync_revision'),
  primary key (user_id, collection, id)
);
create index if not exists capsule_records_user_revision on capsule_records (user_id, revision);

-- Only the server's direct Postgres connection can access these tables.
-- Enabling RLS without browser policies closes Supabase's public data API.
alter table "user" enable row level security;
alter table "session" enable row level security;
alter table "account" enable row level security;
alter table "verification" enable row level security;
alter table capsule_records enable row level security;

-- Saved API keys are encrypted by the application before reaching Postgres.
-- The encryption secret is held separately in Vercel, never in this database.
create table if not exists public.capsule_render_keys (
  user_id text primary key references public."user" (id) on delete cascade,
  encrypted_key text not null check (length(encrypted_key) between 1 and 900),
  updated_at timestamptz not null default now()
);
alter table public.capsule_render_keys enable row level security;
revoke all on public.capsule_render_keys from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_render_keys from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_render_keys from authenticated;
  end if;
end $$;

-- Share links expose only explicit public snapshots. Management tokens and
-- IP addresses are stored only as cryptographic digests.
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
-- View counts belong to the link, so they survive snapshot updates and are
-- readable only by the owner, who holds the token.
alter table public.capsule_shares add column if not exists views bigint not null default 0;
alter table public.capsule_shares add column if not exists last_viewed_at timestamptz;
-- One row per viewer per link, holding a salted hash rather than an address.
-- A repeat open inside the dedupe window refreshes the row without counting.
create table if not exists public.capsule_share_views (
  share_id text not null references public.capsule_shares (id) on delete cascade,
  viewer_hash text not null check (viewer_hash ~ '^[a-f0-9]{64}$'),
  viewed_at timestamptz not null default now(),
  primary key (share_id, viewer_hash)
);
create index if not exists capsule_share_views_viewed on public.capsule_share_views (viewed_at);
create table if not exists public.capsule_share_limits (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  creations integer not null check (creations between 1 and 10)
);
create index if not exists capsule_share_limits_window on public.capsule_share_limits (window_start);
alter table public.capsule_shares enable row level security;
alter table public.capsule_share_limits enable row level security;
alter table public.capsule_share_views enable row level security;
revoke all on public.capsule_shares, public.capsule_share_limits, public.capsule_share_views from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_shares, public.capsule_share_limits, public.capsule_share_views from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_shares, public.capsule_share_limits, public.capsule_share_views from authenticated;
  end if;
end $$;
