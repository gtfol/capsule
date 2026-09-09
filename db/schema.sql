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
