-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — live profile updates
--
--  Avatars and display names were only ever fetched with the members list, and
--  nothing invalidated it: `items` was the sole table in the realtime
--  publication, and the members query does not refetch on focus. So a device
--  that already had the roster cached kept rendering somebody's old avatar
--  until it was cold-started — which looked exactly like uploads "not working
--  on other devices".
--
--  Putting profiles in the publication makes a change to a name or avatar
--  propagate the same way an item does.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$$;

-- Fail loudly rather than ship a feature that silently never fires.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    raise exception 'public.profiles is not in the supabase_realtime publication';
  end if;

  if (select relreplident from pg_class where oid = 'public.profiles'::regclass) <> 'f' then
    raise exception 'public.profiles lacks REPLICA IDENTITY FULL';
  end if;

  raise notice 'PASS  profiles is published for realtime';
end;
$$;
