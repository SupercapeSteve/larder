-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — uploaded profile pictures
--
--  Adds a storage bucket for avatars and the column that points at one.
--
--  Emoji avatars stay: they need no network, never fail to load, and are the
--  fallback whenever an image is absent or broken. An upload simply takes
--  precedence when present.
--
--  The bucket is PUBLIC-read on purpose. Avatars are shown to household mates
--  and embedded in <img> tags; signed URLs would expire mid-session, break
--  browser caching, and need refreshing on every render. Paths are keyed by
--  user id, so nothing is enumerable without already knowing the uuid, and no
--  filename is ever chosen by the user.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists avatar_url text;

-- Sanity-check the shape so a malformed value cannot be written straight into
-- an <img src>. Must be an https URL on the project's own storage host.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_avatar_url_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_url_check
      check (
        avatar_url is null
        or avatar_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/avatars/'
      );
  end if;
end;
$$;


-- ── Bucket ─────────────────────────────────────────────────────────────────
-- 2 MB ceiling and an image-only mime allow-list, enforced by storage itself
-- rather than trusted from the client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];


-- ── Storage policies ───────────────────────────────────────────────────────
-- Everyone may read; you may only write inside a folder named after your own
-- user id. storage.foldername() splits the object path, so ...[1] is the first
-- segment — the uuid.
drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "users replace their own avatar" on storage.objects;
create policy "users replace their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ── Self-test ──────────────────────────────────────────────────────────────
do $$
declare
  a uuid;
  blocked boolean := false;
begin
  select id into a from auth.users order by created_at limit 1;
  if a is null then
    raise notice 'No auth users yet — skipping the self-test.';
    return;
  end if;

  if not exists (select 1 from storage.buckets where id = 'avatars' and public) then
    raise exception 'FAIL: the avatars bucket is missing or not public';
  end if;

  -- A well-formed URL is accepted.
  update public.profiles
  set avatar_url = 'https://hysfurwkmedolzzeabdv.supabase.co/storage/v1/object/public/avatars/'
                   || a::text || '/avatar.jpg'
  where id = a;

  -- Anything else is not.
  begin
    update public.profiles set avatar_url = 'javascript:alert(1)' where id = a;
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: a non-storage URL was accepted into profiles.avatar_url';
  end if;

  update public.profiles set avatar_url = null where id = a;

  raise notice 'PASS  avatars bucket, storage policies, avatar_url constraint';
end;
$$;
