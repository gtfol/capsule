-- Scoped integration credentials and permanent idempotency receipts.
begin;
create table if not exists public.capsule_integration_tokens (
  id uuid primary key,
  user_id text not null references public."user" (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text unique not null check (token_hash ~ '^[a-f0-9]{64}$'),
  prefix text not null,
  scopes text[] not null check (cardinality(scopes) > 0 and scopes <@ array['items:read','wishlist:write','wardrobe:write']::text[]),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index if not exists capsule_integration_tokens_user on public.capsule_integration_tokens (user_id);
create table if not exists public.capsule_integration_receipts (
  user_id text not null references public."user" (id) on delete cascade,
  key text not null check (length(key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.capsule_integration_tokens enable row level security;
alter table public.capsule_integration_receipts enable row level security;
revoke all on public.capsule_integration_tokens, public.capsule_integration_receipts from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.capsule_integration_tokens, public.capsule_integration_receipts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.capsule_integration_tokens, public.capsule_integration_receipts from authenticated;
  end if;
end $$;
commit;
