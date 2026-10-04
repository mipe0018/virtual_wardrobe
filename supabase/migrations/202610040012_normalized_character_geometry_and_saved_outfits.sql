-- Mark newly generated characters as geometry-contract compliant and add persistent
-- browser-composed outfits without invoking AI or consuming generation quota.

alter table public.dressed_characters
  add column if not exists geometry_contract_version text;

update public.dressed_characters
set geometry_contract_version = 'legacy'
where geometry_contract_version is null;

alter table public.dressed_characters
  alter column geometry_contract_version set default 'normalized-v1',
  alter column geometry_contract_version set not null;

alter table public.dressed_characters
  add constraint dressed_character_geometry_contract_version_check
  check (geometry_contract_version in ('legacy', 'normalized-v1'));

create table public.saved_dressed_outfits (
  user_id uuid not null,
  id uuid not null default gen_random_uuid(),
  character_id uuid not null,
  base_type text not null check (base_type in ('woman', 'man')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  outfit_key text not null,
  item_ids text[] not null check (cardinality(item_ids) between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, character_id, outfit_key),
  foreign key (user_id, character_id)
    references public.dressed_characters(user_id, id)
    on delete cascade
);

alter table public.saved_dressed_outfits enable row level security;

create policy "Users can view their own saved DRESSED outfits"
  on public.saved_dressed_outfits
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can delete their own saved DRESSED outfits"
  on public.saved_dressed_outfits
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.saved_dressed_outfits from public, anon, authenticated;
grant select, delete on public.saved_dressed_outfits to authenticated;

create or replace function public.save_dressed_outfit(
  p_name text,
  p_item_ids text[]
)
returns table (
  outfit_id uuid,
  character_id uuid,
  base_type text,
  outfit_name text,
  item_ids text[],
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  active_character_id uuid;
  active_base_type text;
  normalized_item_key text;
  saved_outfit_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 then
    raise exception 'An outfit name between 1 and 80 characters is required.';
  end if;
  if p_item_ids is null
     or cardinality(p_item_ids) not between 1 and 5
     or exists (
       select 1
       from unnest(p_item_ids) as selected(item_id)
       where selected.item_id is null or btrim(selected.item_id) = ''
     )
     or cardinality(p_item_ids) <> (
       select count(distinct selected.item_id)
       from unnest(p_item_ids) as selected(item_id)
     ) then
    raise exception 'Select between one and five distinct clothing items.';
  end if;

  select character.id, character.gender
    into active_character_id, active_base_type
  from public.dressed_characters as character
  where character.user_id = current_user_id
    and character.is_primary
    and character.geometry_contract_version = 'normalized-v1'
  for update;
  if active_character_id is null then
    raise exception 'A primary character using the normalized geometry contract is required.';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as selected(item_id)
    where not exists (
      select 1
      from public.wardrobe_items as item
      where item.user_id = current_user_id
        and item.id = selected.item_id
    )
  ) then
    raise exception 'Every saved outfit item must belong to the current user.';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as selected(item_id)
    where not exists (
      select 1
      from public.wardrobe_item_ai_assets as asset
      where asset.user_id = current_user_id
        and asset.item_id = selected.item_id
        and asset.base_type = active_base_type
        and asset.generation_version = 3
    )
  ) then
    raise exception 'Every saved outfit item must have a current compatible AI-ready asset.';
  end if;

  select jsonb_agg(selected.item_id order by selected.item_id)::text
    into normalized_item_key
  from unnest(p_item_ids) as selected(item_id);
  normalized_item_key := active_base_type || ':' || normalized_item_key;

  insert into public.saved_dressed_outfits (
    user_id, character_id, base_type, name, outfit_key, item_ids
  )
  values (
    current_user_id, active_character_id, active_base_type,
    btrim(p_name), normalized_item_key, p_item_ids
  )
  on conflict (user_id, character_id, outfit_key)
  do update set
    name = excluded.name,
    item_ids = excluded.item_ids,
    updated_at = now()
  returning public.saved_dressed_outfits.id into saved_outfit_id;

  return query
  select outfit.id, outfit.character_id, outfit.base_type,
         outfit.name, outfit.item_ids, outfit.updated_at
  from public.saved_dressed_outfits as outfit
  where outfit.user_id = current_user_id
    and outfit.id = saved_outfit_id;
end;
$$;

revoke all on function public.save_dressed_outfit(text, text[]) from public, anon;
grant execute on function public.save_dressed_outfit(text, text[]) to authenticated;

create or replace function public.remove_saved_outfits_for_deleted_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.saved_dressed_outfits as outfit
  where outfit.user_id = old.user_id
    and outfit.item_ids @> array[old.id];
  return old;
end;
$$;

revoke all on function public.remove_saved_outfits_for_deleted_item() from public, anon, authenticated;

create trigger wardrobe_item_removes_saved_dressed_outfits
after delete on public.wardrobe_items
for each row
execute function public.remove_saved_outfits_for_deleted_item();

create or replace function public.publish_dressed_character(
  p_model_path text,
  p_gender text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_character_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_gender not in ('woman', 'man')
     or split_part(p_model_path, '/', 1) <> current_user_id::text then
    raise exception 'Invalid DRESSED character type or path.';
  end if;
  if not exists (
    select 1
    from storage.objects as object
    where object.bucket_id = 'model-images'
      and object.name = p_model_path
      and object.owner_id::text = current_user_id::text
  ) then
    raise exception 'The generated character image is not stored in the user-owned private bucket.';
  end if;
  if not exists (
    select 1
    from public.profiles as profile
    where profile.user_id = current_user_id
      and profile.gender = p_gender
  ) then
    raise exception 'The character model type does not match the locked profile type.';
  end if;

  update public.dressed_characters
  set is_primary = false
  where user_id = current_user_id
    and is_primary;

  insert into public.dressed_characters (
    user_id, model_path, gender, is_primary, geometry_contract_version
  )
  values (
    current_user_id, p_model_path, p_gender, true, 'normalized-v1'
  )
  returning id into new_character_id;

  update public.profiles
  set model_photo_path = p_model_path,
      model_generation_status = 'completed'
  where user_id = current_user_id;
  if not found then
    raise exception 'The user profile could not be updated.';
  end if;
  return new_character_id;
end;
$$;

revoke all on function public.publish_dressed_character(text, text) from public, anon;
grant execute on function public.publish_dressed_character(text, text) to authenticated;
