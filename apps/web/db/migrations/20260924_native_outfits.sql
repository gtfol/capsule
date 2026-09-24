-- Explicit native outfit and rendering access; existing grants remain unchanged.
begin;
alter table public.capsule_integration_tokens drop constraint capsule_integration_tokens_scopes_check;
alter table public.capsule_integration_tokens add constraint capsule_integration_tokens_scopes_check check (cardinality(scopes) > 0 and scopes <@ array['items:read','wishlist:write','wardrobe:write','wardrobe:delete','wishlist:delete','outfits:read','outfits:write','outfits:delete']::text[]);
commit;
