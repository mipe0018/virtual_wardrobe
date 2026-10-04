-- Preserve character-bound clothing assets as legacy data and introduce reusable base-type assets.

alter table public.wardrobe_item_ai_assets
  rename to wardrobe_item_ai_assets_legacy;

alter table public.wardrobe_item_ai_assets_legacy
  rename constraint wardrobe_item_ai_assets_pkey
  to wardrobe_item_ai_assets_legacy_pkey;

alter table public.wardrobe_results
  add column if not exists character_id uuid,
  add column if not exists outfit_key text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wardrobe_result_character_owned_by_user'
      and conrelid = 'public.wardrobe_results'::regclass
  ) then
    alter table public.wardrobe_results
      add constraint wardrobe_result_character_owned_by_user
      foreign key (user_id, character_id)
      references public.dressed_characters(user_id, id)
      on delete cascade;
  end if;
end;
$$;

create table public.wardrobe_item_ai_assets (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  base_type text not null check (base_type in ('woman', 'man')),
  reference_path text not null,
  generation_version integer not null check (generation_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id, base_type),
  foreign key (user_id, item_id)
    references public.wardrobe_items(user_id, id)
    on delete cascade,
  check (split_part(reference_path, '/', 1) = user_id::text)
);

alter table public.wardrobe_item_ai_assets enable row level security;

create policy "Users can view their own base-type clothing assets"
  on public.wardrobe_item_ai_assets
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can delete their own base-type clothing assets"
  on public.wardrobe_item_ai_assets
  for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.wardrobe_item_ai_assets from public, anon, authenticated;
grant select, delete on public.wardrobe_item_ai_assets to authenticated;
grant select, insert, update, delete on public.wardrobe_item_ai_assets to service_role;

create table public.dressed_base_forms (
  base_type text primary key check (base_type in ('woman', 'man')),
  storage_path text not null unique check (
    storage_path in (
      'system-reference/base-forms/woman.png',
      'system-reference/base-forms/man.png'
    )
  ),
  created_at timestamptz not null default now()
);

alter table public.dressed_base_forms enable row level security;

create policy "Authenticated users can read DRESSED base form references"
  on public.dressed_base_forms
  for select
  to authenticated
  using (true);

grant select on public.dressed_base_forms to authenticated;
revoke all on public.dressed_base_forms from public, anon;

insert into public.dressed_base_forms (base_type, storage_path)
values
  ('woman', 'system-reference/base-forms/woman.png'),
  ('man', 'system-reference/base-forms/man.png');

create policy "Authenticated users can read DRESSED system base form files"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'model-images'
    and name in (
      'system-reference/base-forms/woman.png',
      'system-reference/base-forms/man.png'
    )
  );

create or replace function public.delete_dressed_character(p_character_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  deleted_model_path text;
  deleted_is_primary boolean;
  replacement_character_id uuid;
  replacement_model_path text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select character.model_path, character.is_primary
    into deleted_model_path, deleted_is_primary
  from public.dressed_characters as character
  where character.user_id = current_user_id
    and character.id = p_character_id
  for update;

  if not found then
    return false;
  end if;

  update public.wardrobe_items as item
  set reference_path = null,
      updated_at = now()
  where item.user_id = current_user_id
    and item.reference_path in (
      select asset.reference_path
      from public.wardrobe_item_ai_assets_legacy as asset
      where asset.user_id = current_user_id
        and asset.character_id = p_character_id
    );

  delete from public.wardrobe_results as result
  where result.user_id = current_user_id
    and result.character_id = p_character_id;

  delete from public.wardrobe_item_ai_assets_legacy as asset
  where asset.user_id = current_user_id
    and asset.character_id = p_character_id;

  select character.id, character.model_path
    into replacement_character_id, replacement_model_path
  from public.dressed_characters as character
  where character.user_id = current_user_id
    and character.id <> p_character_id
  order by character.is_primary desc, character.created_at desc, character.id
  limit 1
  for update;

  if deleted_is_primary then
    update public.dressed_characters as character
    set is_primary = false
    where character.user_id = current_user_id
      and character.is_primary;

    if replacement_character_id is not null then
      update public.dressed_characters as character
      set is_primary = true
      where character.user_id = current_user_id
        and character.id = replacement_character_id;
    end if;

    update public.profiles as profile
    set model_photo_path = replacement_model_path,
        model_generation_status = case
          when replacement_character_id is null then null
          else 'completed'
        end
    where profile.user_id = current_user_id;
  else
    update public.profiles as profile
    set model_photo_path = null,
        model_generation_status = null
    where profile.user_id = current_user_id
      and profile.model_photo_path = deleted_model_path;
  end if;

  delete from public.dressed_characters as character
  where character.user_id = current_user_id
    and character.id = p_character_id;

  return found;
end;
$$;

revoke all on function public.delete_dressed_character(uuid) from public, anon;
grant execute on function public.delete_dressed_character(uuid) to authenticated;
