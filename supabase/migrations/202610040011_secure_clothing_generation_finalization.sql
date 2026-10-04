-- Restrict clothing quota finalization to the trusted server-side generation flow.

revoke all on function public.finish_clothing_ai_generation(timestamptz, boolean)
  from public, anon, authenticated;

create or replace function public.finish_clothing_ai_generation_server(
  p_user_id uuid,
  p_reservation_started_at timestamptz,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Trusted server access is required.';
  end if;
  if p_user_id is null
     or p_reservation_started_at is null
     or p_succeeded is null then
    raise exception 'A user, reservation token, and completion result are required.';
  end if;

  update public.ai_generation_usage as usage
  set used_count = usage.used_count + case when p_succeeded then 1 else 0 end,
      in_progress = false,
      started_at = null,
      updated_at = now()
  where usage.user_id = p_user_id
    and usage.generation_type = 'clothing'
    and usage.in_progress
    and usage.started_at = p_reservation_started_at;

  return found;
end;
$$;

revoke all on function public.finish_clothing_ai_generation_server(uuid, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_clothing_ai_generation_server(uuid, timestamptz, boolean)
  to service_role;
