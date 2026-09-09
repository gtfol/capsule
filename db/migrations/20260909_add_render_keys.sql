-- Saved API keys are encrypted by the application before reaching Postgres.
-- The encryption secret is held separately in Vercel, never in this database.
begin;
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
commit;

-- Verify the table is present with row-level security enabled.
select relname, relrowsecurity from pg_class
where oid = 'public.capsule_render_keys'::regclass;
