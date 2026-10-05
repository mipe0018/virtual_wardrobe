-- Server-side finalization for character/tryon generations that run in a Netlify
-- Background Function. Mirrors finish_clothing_ai_generation_server: callable only by
-- the service role, and only for the reservation token that started the generation.
-- A failed generation credits back the reserved use. No schema, policy or data changes.

create or replace function public.finish_ai_generation_server(
  p_user_id uuid,
  p_generation_type text,
  p_reservation_started_at timestamptz,
  p_succeeded boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  released boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only trusted server code can finalize AI generations.'
      using errcode = '42501';
  end if;

  if p_generation_type not in ('character', 'tryon') then
    raise exception 'Unsupported generation type.' using errcode = '22023';
  end if;

  update public.ai_generation_usage
  set
    in_progress = false,
    started_at = null,
    used_count = case
      when p_succeeded then used_count
      else greatest(used_count - 1, 0)
    end,
    updated_at = now()
  where user_id = p_user_id
    and generation_type = p_generation_type
    and in_progress
    and started_at = p_reservation_started_at;

  released := found;
  return released;
end;
$$;

revoke all on function public.finish_ai_generation_server(uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_ai_generation_server(uuid, text, timestamptz, boolean)
  to service_role;
