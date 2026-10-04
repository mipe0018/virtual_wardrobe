-- Query name: 202610040002_character_bound_clothing_assets
-- Preserve original clothing uploads and track AI-ready versions per DRESSED character.
-- Existing processed references are retained and associated with the user's current
-- primary character when one exists, so those assets remain reusable after migration.

alter table public.wardrobe_items
  add column if not exists original_path text;

alter table public.wardrobe_items
  alter column reference_path drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wardrobe_item_original_path_owned_by_user'
      and conrelid = 'public.wardrobe_items'::regclass
  ) then
    alter table public.wardrobe_items
      add constraint wardrobe_item_original_path_owned_by_user
      check (
        original_path is null
        or split_part(original_path, '/', 1) = user_id::text
      );
  end if;
end
$$;

create table if not exists public.wardrobe_item_ai_assets (
  user_id uuid not null,
  item_id text not null,
  character_id uuid not null,
  reference_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, item_id, character_id),
  constraint wardrobe_item_ai_asset_item_owned_by_user
    foreign key (user_id, item_id)
    references public.wardrobe_items(user_id, id)
    on delete cascade,
  constraint wardrobe_item_ai_asset_character_owned_by_user
    foreign key (user_id, character_id)
    references public.dressed_characters(user_id, id)
    on delete cascade,
  constraint wardrobe_item_ai_asset_path_owned_by_user
    check (split_part(reference_path, '/', 1) = user_id::text)
);

comment on column public.wardrobe_items.original_path is
  'Private Storage path for the original user-uploaded clothing image.';
comment on column public.wardrobe_items.reference_path is
  'Legacy/current AI-ready clothing path retained for compatibility; new character-specific variants are stored in wardrobe_item_ai_assets.';
comment on table public.wardrobe_item_ai_assets is
  'Private AI-ready clothing references keyed to a specific saved DRESSED character.';

alter table public.wardrobe_item_ai_assets enable row level security;

drop policy if exists "Users can view their own character clothing assets"
  on public.wardrobe_item_ai_assets;
create policy "Users can view their own character clothing assets"
  on public.wardrobe_item_ai_assets for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own character clothing assets"
  on public.wardrobe_item_ai_assets;
create policy "Users can insert their own character clothing assets"
  on public.wardrobe_item_ai_assets for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and split_part(reference_path, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "Users can update their own character clothing assets"
  on public.wardrobe_item_ai_assets;
create policy "Users can update their own character clothing assets"
  on public.wardrobe_item_ai_assets for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and split_part(reference_path, '/', 1) = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own character clothing assets"
  on public.wardrobe_item_ai_assets;
create policy "Users can delete their own character clothing assets"
  on public.wardrobe_item_ai_assets for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.wardrobe_item_ai_assets from anon, authenticated;
grant select, insert, update, delete on public.wardrobe_item_ai_assets to authenticated;

insert into public.wardrobe_item_ai_assets (
  user_id,
  item_id,
  character_id,
  reference_path
)
select
  item.user_id,
  item.id,
  character.id,
  item.reference_path
from public.wardrobe_items as item
join public.dressed_characters as character
  on character.user_id = item.user_id
 and character.is_primary
where item.reference_path is not null
on conflict (user_id, item_id, character_id) do nothing;
