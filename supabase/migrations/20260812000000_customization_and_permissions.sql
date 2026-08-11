-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — profile customisation, household administration, permissions
--
--  Adds:
--    * avatar_emoji / avatar_color on profiles (no storage bucket needed —
--      an emoji and a palette key render everywhere, work offline, and cost
--      nothing to serve)
--    * regenerate_join_code()  — owner rotates a leaked or over-shared code
--    * set_member_role()       — owner promotes/demotes, with the last-owner
--                                invariant enforced in the same transaction
--
--  Renaming a household needs no RPC: `households_update_owner` already gates
--  UPDATE on is_household_owner(), and `authenticated` already holds UPDATE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Avatars ────────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists avatar_emoji text,
  add column if not exists avatar_color text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_avatar_color_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_color_check
      check (
        avatar_color is null or avatar_color in
        ('green','teal','blue','indigo','violet','pink','red','orange','amber','slate')
      );
  end if;

  -- One emoji, not a sentence. Length is a blunt instrument but a correct one
  -- here: it stops the column being used as a second display_name.
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_avatar_emoji_check'
  ) then
    alter table public.profiles
      add constraint profiles_avatar_emoji_check
      check (avatar_emoji is null or length(avatar_emoji) between 1 and 8);
  end if;
end;
$$;


-- ── Rotate the invite code ─────────────────────────────────────────────────
-- The join code is permanent by design and gets read aloud, so it leaks by
-- nature. An owner needs to be able to invalidate one without tearing the
-- household down. generate_join_code() is revoked from clients, so this has to
-- be a definer function.
create or replace function public.regenerate_join_code(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  code     text;
  attempts int := 0;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = uid and m.role = 'owner'
  ) then
    raise exception 'NOT_OWNER';
  end if;

  loop
    attempts := attempts + 1;
    code := public.generate_join_code();
    begin
      update public.households set join_code = code where id = hid;
      exit;
    exception when unique_violation then
      if attempts >= 10 then
        raise exception 'JOIN_CODE_EXHAUSTED';
      end if;
    end;
  end loop;

  return code;
end;
$$;


-- ── Permissions ────────────────────────────────────────────────────────────
-- Clients hold no UPDATE privilege on household_members (granting it re-opens
-- the self-promotion hole), so role changes come through here, where the
-- caller is checked and the last-owner invariant is enforced atomically.
create or replace function public.set_member_role(hid uuid, target uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid          uuid := (select auth.uid());
  owners_after int;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if new_role not in ('owner', 'member') then
    raise exception 'INVALID_ROLE';
  end if;

  if not exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = uid and m.role = 'owner'
  ) then
    raise exception 'NOT_OWNER';
  end if;

  if not exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = target
  ) then
    raise exception 'NOT_A_MEMBER';
  end if;

  -- Count what the household would look like afterwards. Demoting yourself
  -- when you are the only owner would leave it unadministrable forever.
  select count(*) into owners_after
  from public.household_members m
  where m.household_id = hid
    and (
      (m.user_id = target and new_role = 'owner')
      or (m.user_id <> target and m.role = 'owner')
    );

  if owners_after = 0 then
    raise exception 'LAST_OWNER';
  end if;

  update public.household_members
  set role = new_role
  where household_id = hid and user_id = target;
end;
$$;


revoke all on function public.regenerate_join_code(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;

grant execute on function public.regenerate_join_code(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;


-- ── Self-test ──────────────────────────────────────────────────────────────
-- Same principle as the previous migration: prove it rather than assume it.
do $$
declare
  a   uuid;
  b   uuid;
  hid uuid;
  code_before text;
  code_after  text;
  blocked boolean;
begin
  select id into a from auth.users order by created_at limit 1;
  if a is null then
    raise notice 'No auth users yet — skipping the self-test.';
    return;
  end if;
  select id into b from auth.users where id <> a order by created_at limit 1;

  insert into public.households (name, join_code, created_by)
  values ('MIGRATION SELF TEST 2', 'ZZTST2', a)
  returning id into hid;

  insert into public.household_members (household_id, user_id, role) values (hid, a, 'owner');

  select join_code into code_before from public.households where id = hid;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  code_after := public.regenerate_join_code(hid);
  if code_after = code_before or length(code_after) <> 6 then
    raise exception 'FAIL: regenerate_join_code did not produce a new 6-char code';
  end if;
  if code_after !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'FAIL: regenerated code used an ambiguous character: %', code_after;
  end if;

  -- The sole owner must not be able to demote themselves into a dead end.
  blocked := false;
  begin
    perform public.set_member_role(hid, a, 'member');
  exception when others then
    blocked := (sqlerrm = 'LAST_OWNER');
  end;
  if not blocked then
    raise exception 'FAIL: the last owner demoted themselves';
  end if;

  -- With a second member present, promotion and demotion both work.
  if b is not null then
    insert into public.household_members (household_id, user_id, role) values (hid, b, 'member');
    perform public.set_member_role(hid, b, 'owner');
    if (select role from public.household_members where household_id = hid and user_id = b) <> 'owner' then
      raise exception 'FAIL: promotion did not take effect';
    end if;
    perform public.set_member_role(hid, a, 'member');
    if (select role from public.household_members where household_id = hid and user_id = a) <> 'member' then
      raise exception 'FAIL: demotion did not take effect once a second owner existed';
    end if;
  end if;

  -- Avatar columns accept a valid value and reject a bogus colour.
  update public.profiles set avatar_emoji = '🦊', avatar_color = 'violet' where id = a;
  blocked := false;
  begin
    update public.profiles set avatar_color = 'chartreuse' where id = a;
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: an unknown avatar colour was accepted'; end if;
  update public.profiles set avatar_emoji = null, avatar_color = null where id = a;

  delete from public.households where id = hid;

  raise notice 'PASS  invite-code rotation, role changes, last-owner guard, avatar constraints';
end;
$$;
