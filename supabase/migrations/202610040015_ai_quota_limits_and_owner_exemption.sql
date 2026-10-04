-- Normal users: character 1, clothing 3, tryon 1.
-- Owner exemption: accounts whose Supabase Auth app_metadata has is_owner = true
-- (writable only with the service role) skip the limit rejection. Usage is still
-- recorded and the in-progress lock still applies. Signatures and grants are unchanged.

update public.ai_generation_limits set free_limit = 1 where generation_type in ('character', 'tryon');
update public.ai_generation_limits set free_limit = 3 where generation_type = 'clothing';
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
  is_owner boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_owner') = 'true', false);
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

  if usage_row.used_count >= configured_limit and not is_owner then
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

create or replace function public.reserve_clothing_ai_generation()
returns table (
  allowed boolean,
  used_count integer,
  free_limit integer,
  reason text,
  reservation_started_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  usage_row public.ai_generation_usage%rowtype;
  configured_limit integer;
  new_reservation_started_at timestamptz;
  is_owner boolean := coalesce((auth.jwt() -> 'app_metadata' ->> 'is_owner') = 'true', false);
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  select limits.free_limit into configured_limit
  from public.ai_generation_limits as limits
  where limits.generation_type = 'clothing';
  if configured_limit is null then
    raise exception 'Clothing AI generation is not configured.';
  end if;

  insert into public.ai_generation_usage (user_id, generation_type)
  values (current_user_id, 'clothing')
  on conflict (user_id, generation_type) do nothing;

  select usage.* into usage_row
  from public.ai_generation_usage as usage
  where usage.user_id = current_user_id
    and usage.generation_type = 'clothing'
  for update;

  if usage_row.in_progress
     and usage_row.started_at > now() - interval '5 minutes' then
    return query
      select false, usage_row.used_count, configured_limit,
             'already_in_progress'::text, usage_row.started_at;
    return;
  end if;

  if usage_row.in_progress then
    update public.ai_generation_usage as usage
    set in_progress = false, started_at = null
    where usage.user_id = current_user_id
      and usage.generation_type = 'clothing';
  end if;

  if usage_row.used_count >= configured_limit and not is_owner then
    return query
      select false, usage_row.used_count, configured_limit,
             'limit_reached'::text, null::timestamptz;
    return;
  end if;

  new_reservation_started_at := clock_timestamp();
  update public.ai_generation_usage as usage
  set in_progress = true,
      started_at = new_reservation_started_at,
      updated_at = now()
  where usage.user_id = current_user_id
    and usage.generation_type = 'clothing';

  return query
    select true, usage_row.used_count, configured_limit,
           null::text, new_reservation_started_at;
end;
$$;
