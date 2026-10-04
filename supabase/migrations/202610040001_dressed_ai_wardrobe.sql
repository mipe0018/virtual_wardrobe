-- Query name: 202610040001_dressed_ai_wardrobe
-- Additive profile, private wardrobe-reference, result, and AI-quota structures.
-- source_photo_path, model_photo_path, and model_generation_status already exist on profiles.

alter table public.profiles
  add column if not exists gender text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_gender_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_gender_check
      check (gender is null or gender in ('woman', 'man'));
  end if;
end
$$;

create or replace function public.prevent_profile_gender_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.gender is not null and new.gender is distinct from old.gender then
    raise exception 'Profile gender is locked after it is first set.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_gender_is_locked on public.profiles;
create trigger profiles_gender_is_locked
before update of gender on public.profiles
for each row execute function public.prevent_profile_gender_change();

create table if not exists public.dressed_characters (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  model_path text not null,
  gender text not null check (gender in ('woman', 'man')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint dressed_character_path_owned_by_user
    check (split_part(model_path, '/', 1) = user_id::text)
);

create unique index if not exists dressed_characters_one_primary_per_user
  on public.dressed_characters (user_id)
  where is_primary;

alter table public.dressed_characters enable row level security;
drop policy if exists "Users can view their own DRESSED characters" on public.dressed_characters;
create policy "Users can view their own DRESSED characters"
  on public.dressed_characters for select
  to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.dressed_characters from anon, authenticated;
grant select on public.dressed_characters to authenticated;

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
    select 1 from storage.objects as object
    where object.bucket_id = 'model-images'
      and object.name = p_model_path
      and object.owner_id::text = current_user_id::text
  ) then
    raise exception 'The generated character image is not stored in the user-owned private bucket.';
  end if;
  if not exists (
    select 1 from public.profiles as profile
    where profile.user_id = current_user_id
      and profile.gender = p_gender
  ) then
    raise exception 'The character model type does not match the locked profile type.';
  end if;

  update public.dressed_characters
  set is_primary = false
  where user_id = current_user_id
    and is_primary;

  insert into public.dressed_characters (user_id, model_path, gender, is_primary)
  values (current_user_id, p_model_path, p_gender, true)
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

create or replace function public.set_primary_dressed_character(p_character_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  selected_path text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  select character.model_path into selected_path
  from public.dressed_characters as character
  join public.profiles as profile
    on profile.user_id = character.user_id
   and profile.gender = character.gender
  where character.user_id = current_user_id
    and character.id = p_character_id;
  if selected_path is null then
    raise exception 'The saved character is not available for this profile.';
  end if;
  if not exists (
    select 1 from storage.objects as object
    where object.bucket_id = 'model-images'
      and object.name = selected_path
      and object.owner_id::text = current_user_id::text
  ) then
    raise exception 'The saved character image is not available in private storage.';
  end if;

  update public.dressed_characters
  set is_primary = false
  where user_id = current_user_id;
  update public.dressed_characters
  set is_primary = true
  where user_id = current_user_id
    and id = p_character_id;
  update public.profiles
  set model_photo_path = selected_path,
      model_generation_status = 'completed'
  where user_id = current_user_id;
  return selected_path;
end;
$$;

create table if not exists public.wardrobe_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) between 1 and 100),
  category text not null check (category in (
    'tops', 'shirts', 'sweaters', 'jackets', 'dresses', 'skirts', 'pants',
    'shorts', 'shoes', 'bags', 'jewelry', 'necklaces', 'earrings', 'bracelets',
    'watches', 'glasses', 'sunglasses', 'hats', 'hair-accessories',
    'accessories', 'other'
  )),
  reference_path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint wardrobe_item_path_owned_by_user
    check (split_part(reference_path, '/', 1) = user_id::text)
);

alter table public.wardrobe_items enable row level security;
drop policy if exists "Users can view their own wardrobe items" on public.wardrobe_items;
create policy "Users can view their own wardrobe items"
  on public.wardrobe_items for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own wardrobe items" on public.wardrobe_items;
create policy "Users can insert their own wardrobe items"
  on public.wardrobe_items for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and split_part(reference_path, '/', 1) = (select auth.uid())::text
  );
drop policy if exists "Users can update their own wardrobe items" on public.wardrobe_items;
create policy "Users can update their own wardrobe items"
  on public.wardrobe_items for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and split_part(reference_path, '/', 1) = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own wardrobe items" on public.wardrobe_items;
create policy "Users can delete their own wardrobe items"
  on public.wardrobe_items for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.wardrobe_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  item_ids text[] not null check (cardinality(item_ids) between 1 and 5),
  result_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint wardrobe_result_path_owned_by_user
    check (split_part(result_path, '/', 1) = user_id::text)
);

alter table public.wardrobe_results enable row level security;
drop policy if exists "Users can view their own wardrobe results" on public.wardrobe_results;
create policy "Users can view their own wardrobe results"
  on public.wardrobe_results for select
  to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "Users can insert their own wardrobe results" on public.wardrobe_results;
create policy "Users can insert their own wardrobe results"
  on public.wardrobe_results for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and split_part(result_path, '/', 1) = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own wardrobe results" on public.wardrobe_results;
create policy "Users can delete their own wardrobe results"
  on public.wardrobe_results for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.ai_generation_limits (
  generation_type text primary key
    check (generation_type in ('character', 'clothing', 'tryon')),
  free_limit integer not null check (free_limit >= 0)
);

insert into public.ai_generation_limits (generation_type, free_limit)
values ('character', 3), ('clothing', 3), ('tryon', 3)
on conflict (generation_type) do nothing;

create table if not exists public.ai_generation_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  generation_type text not null references public.ai_generation_limits(generation_type),
  used_count integer not null default 0 check (used_count >= 0),
  in_progress boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, generation_type)
);

alter table public.ai_generation_limits enable row level security;
drop policy if exists "Authenticated users can read AI generation limits" on public.ai_generation_limits;
create policy "Authenticated users can read AI generation limits"
  on public.ai_generation_limits for select
  to authenticated
  using (true);
alter table public.ai_generation_usage enable row level security;
drop policy if exists "Users can read their own AI generation usage" on public.ai_generation_usage;
create policy "Users can read their own AI generation usage"
  on public.ai_generation_usage for select
  to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.reserve_ai_generation(p_generation_type text)
returns table (allowed boolean, used_count integer, free_limit integer, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  usage_row public.ai_generation_usage%rowtype;
  configured_limit integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select limits.free_limit into configured_limit
  from public.ai_generation_limits as limits
  where limits.generation_type = p_generation_type;
  if configured_limit is null then
    raise exception 'Unsupported AI generation type.';
  end if;

  insert into public.ai_generation_usage (user_id, generation_type)
  values (current_user_id, p_generation_type)
  on conflict (user_id, generation_type) do nothing;

  select usage.* into usage_row
  from public.ai_generation_usage as usage
  where usage.user_id = current_user_id
    and usage.generation_type = p_generation_type
  for update;

  if usage_row.in_progress
     and usage_row.started_at > now() - interval '5 minutes' then
    return query select false, usage_row.used_count, configured_limit, 'already_in_progress'::text;
    return;
  end if;

  if usage_row.in_progress then
    update public.ai_generation_usage as usage
    set in_progress = false, started_at = null
    where usage.user_id = current_user_id
      and usage.generation_type = p_generation_type;
  end if;

  if usage_row.used_count >= configured_limit then
    return query select false, usage_row.used_count, configured_limit, 'limit_reached'::text;
    return;
  end if;

  update public.ai_generation_usage as usage
  set used_count = usage.used_count + 1,
      in_progress = true,
      started_at = now(),
      updated_at = now()
  where usage.user_id = current_user_id
    and usage.generation_type = p_generation_type
  returning usage.used_count into usage_row.used_count;

  return query select true, usage_row.used_count, configured_limit, null::text;
end;
$$;

create or replace function public.finish_ai_generation(p_generation_type text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;
  update public.ai_generation_usage
  set in_progress = false, started_at = null, updated_at = now()
  where user_id = auth.uid()
    and generation_type = p_generation_type;
end;
$$;

create or replace function public.get_ai_generation_usage()
returns table (generation_type text, used_count integer, free_limit integer, in_progress boolean)
language sql
security definer
set search_path = ''
as $$
  select limits.generation_type,
         coalesce(usage.used_count, 0),
         limits.free_limit,
         coalesce(usage.in_progress, false)
  from public.ai_generation_limits as limits
  left join public.ai_generation_usage as usage
    on usage.generation_type = limits.generation_type
   and usage.user_id = auth.uid()
  where auth.uid() is not null;
$$;

revoke all on function public.reserve_ai_generation(text) from public, anon;
revoke all on function public.finish_ai_generation(text) from public, anon;
revoke all on function public.get_ai_generation_usage() from public, anon;
grant execute on function public.reserve_ai_generation(text) to authenticated;
grant execute on function public.finish_ai_generation(text) to authenticated;
grant execute on function public.get_ai_generation_usage() to authenticated;
revoke all on function public.publish_dressed_character(text, text) from public, anon;
revoke all on function public.set_primary_dressed_character(uuid) from public, anon;
grant execute on function public.publish_dressed_character(text, text) to authenticated;
grant execute on function public.set_primary_dressed_character(uuid) to authenticated;

revoke all on public.ai_generation_limits from anon, authenticated;
grant select on public.ai_generation_limits to authenticated;
revoke all on public.ai_generation_usage from anon, authenticated;
grant select on public.ai_generation_usage to authenticated;
revoke all on public.wardrobe_items from anon, authenticated;
grant select, insert, update, delete on public.wardrobe_items to authenticated;
revoke all on public.wardrobe_results from anon, authenticated;
grant select, insert, delete on public.wardrobe_results to authenticated;
