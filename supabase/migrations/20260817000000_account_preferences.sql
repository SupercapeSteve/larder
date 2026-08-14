-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — appearance preferences follow the account
--
--  Accent colour, theme, text size and list options were stored only in
--  localStorage, so they were per-device: pick violet on your phone and the
--  laptop stayed green, and a fresh sign-in started from defaults.
--
--  One jsonb column keeps them with the account. Stored as jsonb rather than
--  a column per setting because this is presentation state that changes shape
--  as the app grows — nothing here is ever queried or joined on.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column if not exists preferences jsonb;

-- Guard against a client writing something that is not an object; the app
-- narrows every field on read, but a bare array or string would be nonsense.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_preferences_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferences_check
      check (preferences is null or jsonb_typeof(preferences) = 'object');
  end if;
end;
$$;

-- profiles already has a self-only UPDATE policy and a SELECT grant for
-- `authenticated`, so no new policy is needed: you can read and write your own
-- preferences and nobody else's.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferences'
  ) then
    raise exception 'FAIL: profiles.preferences was not created';
  end if;

  raise notice 'PASS  profiles.preferences ready';
end;
$$;
