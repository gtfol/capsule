-- One private model photo per account. Null photos retain a revision so older
-- browser/phone copies cannot resurrect a photo removed on another device.
begin;
create table if not exists public.capsule_model_photos (
  user_id text primary key references public."user" (id) on delete cascade,
  image_data text check (image_data is null or (length(image_data) <= 2100000 and image_data like 'data:image/jpeg;base64,%')),
  revision bigint not null default nextval('capsule_sync_revision'),
  updated_at timestamptz not null default now()
);
alter table public.capsule_model_photos enable row level security;
revoke all on public.capsule_model_photos from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on public.capsule_model_photos from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on public.capsule_model_photos from authenticated; end if;
end $$;
commit;
select relname, relrowsecurity from pg_class where oid = 'public.capsule_model_photos'::regclass;
