-- Fixes: column reference "character_id" is ambiguous (SQLSTATE 42702) in save_dressed_outfit.
-- The RETURNS TABLE columns are PL/pgSQL variables that clash with table columns in ON CONFLICT.
-- Only change vs. migration 202610040012: the #variable_conflict directive. Same signature;
-- CREATE OR REPLACE preserves existing grants. No table, data, policy or RLS changes.

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
#variable_conflict use_column
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

