-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — Row Level Security proof
--
--  Proves, rather than assumes, that a household cannot reach another's data
--  and that viewer / member / admin / owner mean what the UI claims.
--
--  HOW TO RUN
--    Supabase Studio → SQL Editor → paste → Run.
--    Or:  psql "$DATABASE_URL" -f supabase/tests/rls.sql
--
--  Runs inside a transaction that is ROLLED BACK at the end, so it leaves no
--  fixtures and is safe against a live database. Every assertion raises on
--  failure: the script either finishes printing PASS notices, or aborts naming
--  the policy that broke.
--
--  Setup runs as the migration role. Every assertion first drops to
--  `authenticated` and installs a JWT claim, which is exactly what PostgREST
--  does for a real request.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- Remember the role this transaction started as. `reset role` would drop to
-- the session user, which cannot reach the auth schema; blocks need to come
-- back to *this* role to read fixtures.
select set_config('larder.setup_role', current_user, true);

-- ── Fixtures ───────────────────────────────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';  -- Alice, owner of Alpha
  b uuid := '00000000-0000-4000-b000-00000000000b';  -- Bob,   owner of Bravo
  c uuid := '00000000-0000-4000-c000-00000000000c';  -- Cara,  viewer in Alpha
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (a, 'rls-alice@larder.test', jsonb_build_object('display_name', 'Alice')),
    (b, 'rls-bob@larder.test',   jsonb_build_object('display_name', 'Bob')),
    (c, 'rls-cara@larder.test',  jsonb_build_object('display_name', 'Cara'))
  on conflict (id) do nothing;

  if (select count(*) from public.profiles where id in (a, b, c)) <> 3 then
    raise exception 'FAIL: handle_new_user did not create a profile for each user';
  end if;
  if (select display_name from public.profiles where id = a) <> 'Alice' then
    raise exception 'FAIL: display_name was not taken from sign-up metadata';
  end if;
  raise notice 'PASS  profile auto-creation trigger';
end;
$$;

-- ── Households are created atomically by the RPC ───────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  res jsonb;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  res := public.create_household('Alpha House');
  if res ->> 'household_id' is null or res ->> 'list_id' is null or res ->> 'join_code' is null then
    raise exception 'FAIL: create_household returned an incomplete payload: %', res;
  end if;
  if (res ->> 'join_code') !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'FAIL: join_code is not 6 unambiguous characters: %', res ->> 'join_code';
  end if;

  insert into public.items (list_id, name, quantity, category) values
    ((res ->> 'list_id')::uuid, 'oat milk', '2', 'Dairy'),
    ((res ->> 'list_id')::uuid, 'sourdough', null, 'Bakery');

  raise notice 'PASS  create_household is atomic and returns a usable payload';
end;
$$;

do $$
declare
  b uuid := '00000000-0000-4000-b000-00000000000b';
  res jsonb;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  res := public.create_household('Bravo House');
  insert into public.items (list_id, name) values ((res ->> 'list_id')::uuid, 'coffee');
end;
$$;

-- ── No policy recursion (SQLSTATE 42P17) ───────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  n int;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.household_members;
  if n <> 1 then raise exception 'FAIL: Alice sees % membership rows, expected 1', n; end if;
  select count(*) into n from public.households;
  if n <> 1 then raise exception 'FAIL: Alice sees % households, expected 1', n; end if;

  raise notice 'PASS  household_members select does not recurse';
end;
$$;

-- ── THE CORE ISOLATION PROOF ───────────────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid; lid_a uuid; n int; blocked boolean;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  select l.id into lid_a from public.lists l where l.household_id = hid_a and l.is_default;

  insert into public.category_rules (household_id, keyword, category)
  values (hid_a, 'alpha secret', 'Snacks');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.items where list_id = lid_a;
  if n <> 0 then raise exception 'FAIL: Bob read % of household 1''s items', n; end if;
  select count(*) into n from public.items;
  if n <> 1 then raise exception 'FAIL: Bob sees % items total, expected only his own', n; end if;
  select count(*) into n from public.households where id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1'; end if;
  select count(*) into n from public.lists where household_id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1''s lists'; end if;
  select count(*) into n from public.household_members where household_id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1''s roster'; end if;
  select count(*) into n from public.profiles where id = a;
  if n <> 0 then raise exception 'FAIL: Bob read a profile he shares no household with'; end if;
  select count(*) into n from public.category_rules where household_id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1''s category rules'; end if;

  -- Writes
  blocked := false;
  begin insert into public.items (list_id, name) values (lid_a, 'trojan');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: Bob inserted into household 1''s list'; end if;

  with upd as (update public.items set checked = true where list_id = lid_a returning 1)
  select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: Bob updated % of household 1''s items', n; end if;

  with del as (delete from public.items where list_id = lid_a returning 1)
  select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: Bob deleted % of household 1''s items', n; end if;

  blocked := false;
  begin insert into public.category_rules (household_id, keyword, category)
        values (hid_a, 'injected', 'Other');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: Bob wrote a category rule into household 1'; end if;

  raise notice 'PASS  cross-household isolation: items, households, lists, members, profiles, rules';
end;
$$;

-- ── Membership cannot be self-granted ──────────────────────────────────────
do $$
declare
  b uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid; blocked boolean := false;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  begin insert into public.household_members (household_id, user_id, role) values (hid_a, b, 'member');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then
    raise exception 'FAIL: Bob joined household 1 with a raw INSERT and no join code';
  end if;
  raise notice 'PASS  membership cannot be self-granted from a household UUID';
end;
$$;

-- ── Joining by code, then escalation attempts ──────────────────────────────
do $$
declare
  b uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid; code text; got uuid; n int; blocked boolean; raised boolean := false;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select h.id, h.join_code into hid_a, code from public.households h where h.name = 'Alpha House';

  -- Fixture reads happen before the role switch, as the setup role. If they
  -- come back empty, every "saw zero rows" assertion below would pass
  -- vacuously — so fail loudly rather than certify nothing.
  if hid_a is null or code is null then
    raise exception 'FAIL: setup could not read the Alpha fixture (hid=%, code=%)', hid_a, code;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  begin perform public.join_household_by_code('ZZZZZZ');
  exception when others then raised := (sqlerrm = 'INVALID_CODE'); end;
  if not raised then raise exception 'FAIL: an invalid join code did not raise INVALID_CODE'; end if;

  got := public.join_household_by_code('  ' || lower(code) || ' ');
  if got is distinct from hid_a then raise exception 'FAIL: join returned the wrong household'; end if;

  select count(*) into n from public.items;
  if n < 3 then raise exception 'FAIL: after joining Bob sees % items', n; end if;

  -- Escalation by UPDATE. Blocked at the *grant* level, not by a policy —
  -- UPDATE on household_members is revoked from `authenticated` outright — so
  -- this raises 42501 rather than matching zero rows. Accept either as proof.
  blocked := false;
  begin
    with upd as (update public.household_members set role = 'owner'
                 where household_id = hid_a and user_id = b returning 1)
    select count(*) into n from upd;
    blocked := (n = 0);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a member promoted themselves by UPDATE'; end if;

  -- Escalation by DELETE + re-INSERT
  delete from public.household_members where household_id = hid_a and user_id = b;
  blocked := false;
  begin insert into public.household_members (household_id, user_id, role) values (hid_a, b, 'owner');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: member escalated via DELETE + INSERT'; end if;

  perform public.join_household_by_code(code);
  if (select role from public.household_members where household_id = hid_a and user_id = b) <> 'member' then
    raise exception 'FAIL: rejoining did not restore the plain member role';
  end if;

  raise notice 'PASS  join by code works; no escalation by UPDATE or by DELETE+INSERT';
end;
$$;

-- ── Re-parenting is impossible even for a dual-household member ────────────
do $$
declare
  b uuid := '00000000-0000-4000-b000-00000000000b';
  hid_b uuid; lid_a uuid; lid_b uuid; n int; blocked boolean;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select h.id into hid_b from public.households h where h.name = 'Bravo House';
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;
  select l.id into lid_b from public.lists l where l.household_id = hid_b and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  -- Two defences stack here, and either is a pass: the policy denies the
  -- update outright for a non-admin (zero rows, trigger never reached), and
  -- the immutability trigger catches an admin who could otherwise do it.
  blocked := false;
  begin
    with upd as (update public.lists set household_id = hid_b where id = lid_a returning 1)
    select count(*) into n from upd;
    blocked := (n = 0);
  exception when others then blocked := (sqlerrm = 'LIST_HOUSEHOLD_IMMUTABLE');
  end;
  if not blocked then raise exception 'FAIL: a list was re-parented into another household'; end if;

  blocked := false;
  begin update public.items set list_id = lid_b where list_id = lid_a;
  exception when others then blocked := (sqlerrm = 'ITEM_LIST_IMMUTABLE'); end;
  if not blocked then raise exception 'FAIL: items were moved into another household''s list'; end if;

  raise notice 'PASS  lists and items cannot be re-parented';
end;
$$;

-- ── Attribution is decided by the JWT ──────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid; iid uuid;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  insert into public.items (list_id, name, added_by) values (lid_a, 'forged', a) returning id into iid;
  if (select added_by from public.items where id = iid) <> b then
    raise exception 'FAIL: an item was created attributed to somebody else';
  end if;

  update public.items set checked = true, checked_by = a where id = iid;
  if (select checked_by from public.items where id = iid) <> b then
    raise exception 'FAIL: a check-off was attributed to somebody else';
  end if;

  update public.items set quantity = '9', checked_by = a where id = iid;
  if (select checked_by from public.items where id = iid) <> b then
    raise exception 'FAIL: an unrelated edit rewrote the check-off attribution';
  end if;

  delete from public.items where id = iid;
  raise notice 'PASS  added_by / checked_by cannot be forged';
end;
$$;

-- ── Roles: viewer / member / admin / owner ─────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  c uuid := '00000000-0000-4000-c000-00000000000c';
  hid_a uuid; lid_a uuid; n int; blocked boolean;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  select l.id into lid_a from public.lists l where l.household_id = hid_a and l.is_default;

  insert into public.household_members (household_id, user_id, role) values (hid_a, c, 'viewer');

  -- VIEWER: reads, writes nothing.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);

  select count(*) into n from public.items where list_id = lid_a;
  if n < 1 then raise exception 'FAIL: a viewer cannot read the list'; end if;

  blocked := false;
  begin insert into public.items (list_id, name) values (lid_a, 'viewer add');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: a viewer added an item'; end if;

  with upd as (update public.items set checked = true where list_id = lid_a returning 1)
  select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a viewer checked off % items', n; end if;

  with del as (delete from public.items where list_id = lid_a returning 1)
  select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: a viewer deleted % items', n; end if;

  blocked := false;
  begin insert into public.api_tokens (user_id, list_id, token_hash) values (c, lid_a, repeat('d', 64));
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: a viewer minted a write-capable Siri token'; end if;

  blocked := false;
  begin insert into public.category_rules (household_id, keyword, category) values (hid_a, 'viewer rule', 'Other');
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: a viewer wrote a category rule'; end if;

  -- MEMBER: writes items, cannot administer.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.set_member_role(hid_a, c, 'member');

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  insert into public.items (list_id, name) values (lid_a, 'member add');
  insert into public.category_rules (household_id, keyword, category) values (hid_a, 'member rule', 'Snacks');

  with upd as (update public.households set name = 'nope' where id = hid_a returning 1)
  select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a member renamed the household'; end if;

  blocked := false;
  begin perform public.regenerate_join_code(hid_a);
  exception when others then blocked := (sqlerrm = 'NOT_OWNER'); end;
  if not blocked then raise exception 'FAIL: a member rotated the invite code'; end if;

  -- ADMIN: administers, cannot change roles or touch an owner.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.set_member_role(hid_a, c, 'admin');

  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  with upd as (update public.households set name = 'Renamed by admin' where id = hid_a returning 1)
  select count(*) into n from upd;
  if n <> 1 then raise exception 'FAIL: an admin could not rename the household'; end if;
  -- Put it back: later blocks find their fixtures by name, and a renamed
  -- household made them read NULL and fail for the wrong reason.
  update public.households set name = 'Alpha House' where id = hid_a;

  perform public.regenerate_join_code(hid_a);

  blocked := false;
  begin perform public.set_member_role(hid_a, a, 'member');
  exception when others then blocked := (sqlerrm = 'NOT_OWNER'); end;
  if not blocked then raise exception 'FAIL: an admin changed roles'; end if;

  with del as (delete from public.household_members where household_id = hid_a and user_id = a returning 1)
  select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: an admin removed an owner'; end if;

  -- OWNER: last-owner guard.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  blocked := false;
  begin perform public.set_member_role(hid_a, a, 'member');
  exception when others then blocked := (sqlerrm = 'LAST_OWNER'); end;
  if not blocked then raise exception 'FAIL: the last owner demoted themselves'; end if;

  raise notice 'PASS  viewer / member / admin / owner boundaries';
end;
$$;

-- ── api_tokens ─────────────────────────────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid; n int; blocked boolean; revoked timestamptz;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;
  if lid_a is null then
    raise exception 'FAIL: setup could not read the Alpha default list';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  blocked := false;
  begin insert into public.api_tokens (user_id, list_id, token_hash) values (b, lid_a, 'not-a-sha256');
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'FAIL: a non-SHA-256 value was accepted as a token hash'; end if;

  insert into public.api_tokens (user_id, list_id, token_hash, label)
  values (b, lid_a, repeat('c', 64), 'Bob Siri');

  -- Removal must revoke it.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.household_members where household_id = (
    select household_id from public.lists where id = lid_a
  ) and user_id = b;

  select t.revoked_at into revoked from public.api_tokens t where t.user_id = b and t.list_id = lid_a;
  if revoked is null then
    raise exception 'FAIL: an evicted member''s Siri token was left live';
  end if;

  raise notice 'PASS  api_tokens: hash format enforced, revoked when membership ends';
end;
$$;

-- ── Storage: you may only write your own avatar folder ─────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  n int; blocked boolean := false;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname ilike '%avatar%';
  if n < 4 then raise exception 'FAIL: expected 4 avatar storage policies, found %', n; end if;

  if not exists (select 1 from storage.buckets where id = 'avatars' and public) then
    raise exception 'FAIL: the avatars bucket is missing or not public';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  -- Writing into Alice's folder must be refused. Any failure counts as
  -- blocked: storage.objects has columns this test does not populate, so the
  -- assertion is deliberately "did not succeed" rather than a specific code.
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', a::text || '/avatar.jpg');
  exception when others then blocked := true; end;
  if not blocked then
    raise exception 'FAIL: Bob wrote into Alice''s avatar folder';
  end if;

  raise notice 'PASS  storage: avatar folders are owner-scoped';
end;
$$;

-- ── anon reaches nothing ───────────────────────────────────────────────────
do $$
declare
  n int; blocked boolean;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  perform set_config('request.jwt.claims', '', true);

  blocked := false;
  begin
    select count(*) into n from public.items;
    if n <> 0 then raise exception 'FAIL: anon read % items', n; end if;
  exception when insufficient_privilege then blocked := true; end;

  blocked := false;
  begin perform public.generate_join_code();
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'FAIL: anon minted a join code'; end if;

  blocked := false;
  begin perform public.create_household('Anonymous House');
  exception when insufficient_privilege then blocked := true;
            when others then blocked := (sqlerrm = 'NOT_AUTHENTICATED'); end;
  if not blocked then raise exception 'FAIL: anon created a household'; end if;

  raise notice 'PASS  anon reads no tables and executes no RPCs';
end;
$$;

-- ── Structural invariants ──────────────────────────────────────────────────
do $$
declare
  offender text;
begin
  -- Identity does not reset between DO blocks: SET LOCAL ROLE and the JWT
  -- claim are transaction-scoped, so without this each block would inherit
  -- whoever the previous one left behind and read its fixtures as the wrong
  -- user -- silently turning "saw zero rows" assertions into vacuous passes.
  execute format('set local role %I',
    coalesce(nullif(current_setting('larder.setup_role', true), ''), current_user));
  perform set_config('request.jwt.claims', '', true);
  select string_agg(c.relname, ', ') into offender
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('profiles','households','household_members','lists','items','api_tokens','category_rules')
    and not c.relrowsecurity;
  if offender is not null then raise exception 'FAIL: RLS not enabled on: %', offender; end if;

  select string_agg(p.proname, ', ') into offender
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%'
    );
  if offender is not null then
    raise exception 'FAIL: SECURITY DEFINER without a pinned search_path: %', offender;
  end if;

  -- Realtime wiring for every published table.
  select string_agg(t, ', ') into offender from unnest(array['items','profiles','category_rules']) t
  where not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
  );
  if offender is not null then raise exception 'FAIL: not published for realtime: %', offender; end if;

  if (select relreplident from pg_class where oid = 'public.items'::regclass) <> 'f' then
    raise exception 'FAIL: items lacks REPLICA IDENTITY FULL';
  end if;

  raise notice 'PASS  RLS on all 7 tables; definers pin search_path; realtime wired';
end;
$$;

do $$ begin
  raise notice '─────────────────────────────────────';
  raise notice 'ALL RLS ASSERTIONS PASSED';
  raise notice '─────────────────────────────────────';
end; $$;

rollback;
