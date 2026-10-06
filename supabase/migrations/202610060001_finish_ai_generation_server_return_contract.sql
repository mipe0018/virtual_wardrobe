-- Restore the return contract of finish_ai_generation_server.
--
-- WHY (verified, see analysis/DRESSED-MODEL-GENERATION-FIX.md):
--   src/lib/server/ai/generation-usage.ts -> finishGenerationServer() reports success
--   strictly as `data === true`, and character-job.ts logs
--     "The character reservation was already released or expired."
--   whenever it is false.
--
--   The deployed function answers HTTP 204 No Content (RETURNS VOID), so PostgREST
--   deserialises the response to null and every finalization is reported as
--   "not released" -- even when the reservation was released successfully.
--   The sibling function finish_clothing_ai_generation_server, defined as
--   `returns boolean` in 202610040011, answers HTTP 200 with `false` on the same
--   instance with the same key, which isolates this to finish_ai_generation_server.
--
--   202610040016_background_ai_generation_finalization.sql already declares
--   `returns boolean`, but PostgreSQL cannot change a function's return type in
--   place, so `create or replace` never took effect on the deployed database.
--
-- WHAT THIS DOES:
--   Drops and recreates finish_ai_generation_server with the EXACT definition of
--   202610040016 (signature, guard, token match, credit-back, grants).
--   No behaviour, security check, quota rule or grant is changed.

drop function if exists public.finish_ai_generation_server(uuid, text, timestamptz, boolean);

create function public.finish_ai_generation_server(
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
