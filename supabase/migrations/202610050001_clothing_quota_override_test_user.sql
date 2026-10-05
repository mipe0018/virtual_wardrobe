-- Temporary per-user clothing AI quota override for Phase 2 testing.
--
-- Adds a single, explicitly seeded override for the test account. No global limit
-- changes: character = 3, clothing = 5, tryon = 1 stay exactly as they are, and
-- every other user keeps using ai_generation_limits.free_limit unchanged.
--
-- reserve_ai_generation(text) (character/tryon) is NOT touched.
-- Only reserve_clothing_ai_generation() is redefined, and only to consult this
-- table before falling back to the global limit. All existing behaviour is
-- preserved: used_count, in_progress, started_at, updated_at, the five-minute
-- already_in_progress window, limit_reached, the clock_timestamp() reservation
-- token, the auth.uid()-based scoping and the return shape.
--
-- is_owner is deliberately NOT used for this.

create table if not exists public.ai_generation_limit_overrides (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clothing_free_limit integer not null check (clothing_free_limit > 0),
  created_at timestamptz not null default now()
);

alter table public.ai_generation_limit_overrides enable row level security;

-- No policies are created on purpose: RLS with zero policies denies everything.
-- Only the SECURITY DEFINER quota function and the service role may read it, so a
-- normal user can never grant themselves a higher quota from the browser.
revoke all on public.ai_generation_limit_overrides from anon, authenticated;
grant select on public.ai_generation_limit_overrides to service_role;

insert into public.ai_generation_limit_overrides (user_id, clothing_free_limit)
values ('619b975b-ce2b-4e62-99dc-7bb0ddcb4c80', 100)
on conflict (user_id) do update
  set clothing_free_limit = excluded.clothing_free_limit;

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
  override_limit integer;
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

  -- Per-user override. Placed AFTER the global lookup and its null check, and
  -- applied only when a row exists: a bare "SELECT ... INTO" with zero matching
  -- rows assigns NULL in PL/pgSQL and would wipe the global limit for every user
  -- without an override.
  select override.clothing_free_limit into override_limit
  from public.ai_generation_limit_overrides as override
  where override.user_id = current_user_id;

  if override_limit is not null then
    configured_limit := override_limit;
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