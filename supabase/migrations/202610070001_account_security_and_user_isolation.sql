-- 202610070001_account_security_and_user_isolation.sql
-- Account security & user isolation
-- (read-only audit: analysis/dressed-account-security-and-user-isolation-analysis.md)
--
-- NEW FILE ONLY. No existing migration is edited (they are immutable history).
-- Two gaps are closed here:
--   G1: public.profiles had NO row level security policies in version control,
--       while the browser reads/writes it directly with the user's JWT.
--   G2: storage.objects had no owner-scoped upload/download/delete policies in
--       version control (only the system base-form READ policy from 0010).
--       A signed URL is only as safe as the storage SELECT policy, so this is
--       the critical fix for private images.
--
-- End state (verify with pg_policies):
--   public.profiles : SELECT/INSERT/UPDATE own rows only (3 policies)
--   storage.objects : base-form READ (kept) + 8 owner-folder policies
--                     (SELECT/INSERT/UPDATE/DELETE x model-images/profile-images)

-- ============================================================
-- 1) public.profiles — enable RLS and make ownership explicit
-- ============================================================

alter table public.profiles enable row level security;

-- Drop every pre-existing policy on profiles (their content is unknown: the
-- table was created outside this repository — see F4 in the SQL audit). This
-- guarantees a deterministic owner-only end state instead of OR-ing new strict
-- policies with possibly permissive legacy ones.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', policy_record.policyname);
  end loop;
end
$$;

create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- profiles holds no public content: anon gets nothing. Deleting the row is
-- handled server-side (service role) by POST /api/account/delete.
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;

-- ============================================================
-- 2) storage.objects — owner-folder policies for the private buckets
-- ============================================================
-- Ownership model (unchanged, now enforced): every user file lives at
--   {auth.uid()}/...  inside 'model-images' or 'profile-images'.
-- System files live at 'system-reference/...' and are NOT user data.
--
-- NOTE: owner_id is deliberately NOT part of the predicates. Files written by
-- the background AI jobs use the service role and may carry a different or
-- null owner_id, yet they still live under the owning user's folder (the path
-- prefix is enforced by the DB CHECKs and by the job payloads).

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      -- keep the system base-form READ policy created by migration 0010
      and policyname <> 'Authenticated users can read DRESSED system base form files'
  loop
    execute format('drop policy %I on storage.objects', policy_record.policyname);
  end loop;
end
$$;

-- ---------- model-images ----------

create policy "Users can read their own model images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'model-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can upload to their own model images folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'model-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can update their own model images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'model-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'model-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can delete their own model images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'model-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------- profile-images ----------

create policy "Users can read their own profile images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can upload to their own profile images folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can update their own profile images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Users can delete their own profile images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- anon never touches storage: no policy targets it (RLS default = deny).
revoke all on storage.objects from anon;

