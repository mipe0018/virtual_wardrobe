-- Query name: Clothing previews and AI asset versions
-- Store clean clothing thumbnails separately and identify compatible character layers.
-- Existing preview paths remain NULL; existing AI assets remain unversioned/legacy.

alter table public.wardrobe_items
  add column if not exists preview_path text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wardrobe_item_preview_path_owned_by_user'
      and conrelid = 'public.wardrobe_items'::regclass
  ) then
    alter table public.wardrobe_items
      add constraint wardrobe_item_preview_path_owned_by_user
      check (
        preview_path is null
        or split_part(preview_path, '/', 1) = user_id::text
      );
  end if;
end
$$;

alter table public.wardrobe_item_ai_assets
  add column if not exists generation_version smallint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wardrobe_item_ai_asset_generation_version_check'
      and conrelid = 'public.wardrobe_item_ai_assets'::regclass
  ) then
    alter table public.wardrobe_item_ai_assets
      add constraint wardrobe_item_ai_asset_generation_version_check
      check (generation_version is null or generation_version > 0);
  end if;
end
$$;

comment on column public.wardrobe_items.preview_path is
  'Private Storage path for the clean clothing preview; original_path remains the untouched upload.';
comment on column public.wardrobe_item_ai_assets.generation_version is
  'AI-ready layer contract version; NULL marks legacy assets that are not verified as aligned transparent layers.';
