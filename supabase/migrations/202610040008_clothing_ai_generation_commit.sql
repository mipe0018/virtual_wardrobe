-- Query name: Clothing AI-ready quota commit and rollback
-- Count clothing quota only after a current-version AI-ready asset is saved.

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

  if usage_row.used_count >= configured_limit then
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

create or replace function public.finish_clothing_ai_generation(
  p_reservation_started_at timestamptz,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;
  if p_reservation_started_at is null or p_succeeded is null then
    raise exception 'A clothing reservation token and completion result are required.';
  end if;

  update public.ai_generation_usage as usage
  set used_count = usage.used_count + case when p_succeeded then 1 else 0 end,
      in_progress = false,
      started_at = null,
      updated_at = now()
  where usage.user_id = current_user_id
    and usage.generation_type = 'clothing'
    and usage.in_progress
    and usage.started_at = p_reservation_started_at;

  return found;
end;
$$;

revoke all on function public.reserve_clothing_ai_generation() from public, anon;
revoke all on function public.finish_clothing_ai_generation(timestamptz, boolean) from public, anon;
grant execute on function public.reserve_clothing_ai_generation() to authenticated;
grant execute on function public.finish_clothing_ai_generation(timestamptz, boolean) to authenticated;
