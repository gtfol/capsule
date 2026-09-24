-- Existing Capsule databases: run in the Supabase SQL editor before merging
-- the wishlist release. Re-running this migration is safe.
begin;
alter table capsule_records
  drop constraint if exists capsule_records_collection_check;
alter table capsule_records
  add constraint capsule_records_collection_check
  check (collection in ('items', 'outfits', 'wishlist'));
commit;
