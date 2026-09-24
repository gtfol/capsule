-- Null expiry means a token remains valid until revoked. Existing expiries stay intact.
begin;
alter table public.capsule_integration_tokens alter column expires_at drop not null;
commit;
