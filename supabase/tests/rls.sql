-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — Row Level Security proof
--
--  Proves, rather than assumes, that household 2 cannot see household 1.
--  Every assertion raises on failure, so the script either completes silently
--  with NOTICEs or aborts with a message naming the broken policy.
--
--  HOW TO RUN
--    Supabase Studio → SQL Editor → paste → Run.
--    Or:  psql "$DATABASE_URL" -f supabase/tests/rls.sql
--
--  The whole script runs inside a transaction that is ROLLED BACK at the end.
--  It leaves no fixtures behind, and it is safe to run against production
--  (though staging is the polite choice).
--
--  Setup statements run as `postgres`, which has BYPASSRLS. Every assertion
--  first drops to `authenticated` and installs a JWT claim, which is exactly
--  what PostgREST does for a real request.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Fixtures ───────────────────────────────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values
    (a, 'rls-alice@larder.test', jsonb_build_object('display_name', 'Alice')),
    (b, 'rls-bob@larder.test',   jsonb_build_object('display_name', 'Bob'))
  on conflict (id) do nothing;

  -- The on_auth_user_created trigger should have produced both profiles.
  if (select count(*) from public.profiles where id in (a, b)) <> 2 then
    raise exception 'FAIL: handle_new_user trigger did not create profiles for both users';
  end if;
  raise notice 'PASS  profile auto-creation trigger';

  if (select display_name from public.profiles where id = a) <> 'Alice' then
    raise exception 'FAIL: display_name was not taken from sign-up metadata';
  end if;
  raise notice 'PASS  display_name captured from sign-up metadata';
end;
$$;

-- ── Alice creates household 1 ──────────────────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  res jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  res := public.create_household('Alpha House');

  if res ->> 'household_id' is null or res ->> 'list_id' is null or res ->> 'join_code' is null then
    raise exception 'FAIL: create_household returned an incomplete payload: %', res;
  end if;
  if length(res ->> 'join_code') <> 6 then
    raise exception 'FAIL: join_code is not 6 characters: %', res ->> 'join_code';
  end if;
  if (res ->> 'join_code') !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$' then
    raise exception 'FAIL: join_code used an ambiguous character: %', res ->> 'join_code';
  end if;

  insert into public.items (list_id, name, quantity, category)
  values
    ((res ->> 'list_id')::uuid, 'oat milk', '2', 'Dairy'),
    ((res ->> 'list_id')::uuid, 'sourdough', null, 'Bakery');

  raise notice 'PASS  create_household is atomic and returns a usable payload';
end;
$$;

-- ── Bob creates household 2 ────────────────────────────────────────────────
do $$
declare
  b uuid := '00000000-0000-4000-b000-00000000000b';
  res jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  res := public.create_household('Bravo House');
  insert into public.items (list_id, name) values ((res ->> 'list_id')::uuid, 'coffee');
end;
$$;

-- ── No policy recursion ────────────────────────────────────────────────────
-- The canonical failure mode for this schema is
--   ERROR 42P17: infinite recursion detected in policy for relation
--                "household_members"
-- If the definer helpers were replaced with a self-referencing subquery, this
-- block is where the build dies.
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select count(*) into n from public.household_members;
  if n <> 1 then
    raise exception 'FAIL: Alice sees % membership rows, expected exactly her own', n;
  end if;

  select count(*) into n from public.households;
  if n <> 1 then
    raise exception 'FAIL: Alice sees % households, expected 1', n;
  end if;

  raise notice 'PASS  household_members select does not recurse (42P17 not raised)';
end;
$$;

-- ── THE CORE ISOLATION PROOF ───────────────────────────────────────────────
-- Bob, in household 2, must receive exactly zero rows from household 1.
do $$
declare
  b   uuid := '00000000-0000-4000-b000-00000000000b';
  a   uuid := '00000000-0000-4000-a000-00000000000a';
  hid_a uuid;
  lid_a uuid;
  n   int;
begin
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  select l.id into lid_a from public.lists l where l.household_id = hid_a and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.items where list_id = lid_a;
  if n <> 0 then raise exception 'FAIL: Bob read % of household 1''s items', n; end if;

  select count(*) into n from public.items;
  if n <> 1 then raise exception 'FAIL: Bob sees % items in total, expected only his own 1', n; end if;

  select count(*) into n from public.households where id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1'; end if;

  select count(*) into n from public.lists where household_id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1''s lists'; end if;

  select count(*) into n from public.household_members where household_id = hid_a;
  if n <> 0 then raise exception 'FAIL: Bob read household 1''s membership roster'; end if;

  select count(*) into n from public.profiles where id = a;
  if n <> 0 then raise exception 'FAIL: Bob read a profile he shares no household with'; end if;

  raise notice 'PASS  cross-household SELECT isolation (items, households, lists, members, profiles)';
end;
$$;

-- ── Write isolation ────────────────────────────────────────────────────────
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid;
  n     int;
  blocked boolean;
begin
  select l.id into lid_a
  from public.lists l join public.households h on h.id = l.household_id
  where h.name = 'Alpha House' and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  blocked := false;
  begin
    insert into public.items (list_id, name) values (lid_a, 'trojan horse');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: Bob inserted an item into household 1''s list'; end if;

  with upd as (
    update public.items set checked = true where list_id = lid_a returning 1
  ) select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: Bob updated % of household 1''s items', n; end if;

  with del as (
    delete from public.items where list_id = lid_a returning 1
  ) select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: Bob deleted % of household 1''s items', n; end if;

  blocked := false;
  begin
    insert into public.lists (household_id, name)
    select h.id, 'sneaky' from public.households h where h.name = 'Alpha House';
    -- The SELECT itself returns no rows under RLS, so nothing is inserted;
    -- treat a zero-row insert as blocked too.
    if not found then blocked := true; end if;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: Bob created a list inside household 1'; end if;

  raise notice 'PASS  cross-household INSERT / UPDATE / DELETE all denied';
end;
$$;

-- ── Knowing a household's UUID must not be the same as belonging to it ─────
-- Foreign-key checks bypass row security, so the FK on household_id offers no
-- protection here: without the INSERT privilege being revoked, any account
-- holding a household UUID could write itself a membership row, and the join
-- code — and every removal — would be decorative.
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid;
  blocked boolean := false;
  n int;
begin
  select h.id into hid_a from public.households h where h.name = 'Alpha House';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  begin
    insert into public.household_members (household_id, user_id, role)
    values (hid_a, b, 'member');
  exception when insufficient_privilege then
    blocked := true;
  end;

  if not blocked then
    select count(*) into n from public.household_members where household_id = hid_a and user_id = b;
    raise exception
      'FAIL: Bob joined household 1 with a raw INSERT and no join code (% rows written)', n;
  end if;

  raise notice 'PASS  membership cannot be self-granted from a household UUID';
end;
$$;

-- ── An item cannot be smuggled into another household ──────────────────────
do $$
declare
  a     uuid := '00000000-0000-4000-a000-00000000000a';
  lid_b uuid;
  blocked boolean := false;
begin
  select l.id into lid_b
  from public.lists l join public.households h on h.id = l.household_id
  where h.name = 'Bravo House' and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  begin
    update public.items set list_id = lid_b where name = 'oat milk';
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: Alice moved an item into household 2 — items UPDATE is missing a WITH CHECK';
  end if;

  raise notice 'PASS  items UPDATE WITH CHECK blocks cross-household moves';
end;
$$;

-- ── api_tokens are private to their owner ──────────────────────────────────
do $$
declare
  a uuid := '00000000-0000-4000-a000-00000000000a';
  b uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid;
  lid_b uuid;
  n int;
  blocked boolean := false;
begin
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House';
  select l.id into lid_b from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Bravo House';

  insert into public.api_tokens (user_id, list_id, token_hash, label)
  values (a, lid_a, repeat('a', 64), 'Alice Siri');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.api_tokens;
  if n <> 0 then raise exception 'FAIL: Bob can see % API tokens that are not his', n; end if;

  -- Bob must not be able to mint a token bound to a list he cannot reach.
  begin
    insert into public.api_tokens (user_id, list_id, token_hash)
    values (b, lid_a, repeat('b', 64));
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: Bob minted a Siri token pointed at household 1''s list';
  end if;

  raise notice 'PASS  api_tokens are owner-scoped and list-bound';
end;
$$;

-- ── Joining by code ────────────────────────────────────────────────────────
do $$
declare
  b    uuid := '00000000-0000-4000-b000-00000000000b';
  code text;
  hid_a uuid;
  got  uuid;
  n    int;
  raised boolean := false;
begin
  select h.id, h.join_code into hid_a, code from public.households h where h.name = 'Alpha House';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  -- Wrong code is a clean, catchable failure.
  begin
    perform public.join_household_by_code('ZZZZZZ');
  exception when others then
    raised := (sqlerrm = 'INVALID_CODE');
  end;
  if not raised then raise exception 'FAIL: an invalid join code did not raise INVALID_CODE'; end if;

  -- Lowercase and whitespace are tolerated — the code is read aloud.
  got := public.join_household_by_code('  ' || lower(code) || ' ');
  if got is distinct from hid_a then raise exception 'FAIL: join_household_by_code returned the wrong household'; end if;

  select count(*) into n from public.items;
  if n < 3 then raise exception 'FAIL: after joining, Bob sees % items, expected household 1''s 2 plus his own', n; end if;

  -- Idempotent: joining twice is not an error.
  got := public.join_household_by_code(code);
  select count(*) into n from public.household_members where household_id = hid_a and user_id = b;
  if n <> 1 then raise exception 'FAIL: joining twice produced % membership rows', n; end if;

  -- And now that they share a household, attribution works.
  select count(*) into n from public.profiles;
  if n <> 2 then raise exception 'FAIL: household-mate profiles are not visible (attribution would break)'; end if;

  raise notice 'PASS  join_household_by_code: invalid, case-insensitive, idempotent, unlocks the list';
end;
$$;

-- ── A joined member still cannot seize control ─────────────────────────────
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid;
  code  text;
  n     int;
  blocked boolean;
begin
  -- Captured as postgres, before the role switch: once Bob deletes his own
  -- membership row he can no longer SELECT the household to read its code.
  select h.id, h.join_code into hid_a, code from public.households h where h.name = 'Alpha House';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  with upd as (
    update public.household_members set role = 'owner'
    where household_id = hid_a and user_id = b returning 1
  ) select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a plain member promoted themselves to owner'; end if;

  with upd as (
    update public.households set name = 'Hijacked' where id = hid_a returning 1
  ) select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a plain member renamed the household'; end if;

  -- The escalation the UPDATE-only test above cannot see: drop your own
  -- membership row, then write it back as an owner. The first draft of this
  -- schema was wide open to exactly this while still reporting all-pass.
  delete from public.household_members where household_id = hid_a and user_id = b;

  blocked := false;
  begin
    insert into public.household_members (household_id, user_id, role)
    values (hid_a, b, 'owner');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: member escalated to owner by deleting and re-inserting their membership row';
  end if;

  -- Put Bob back the only way that is supposed to work.
  perform public.join_household_by_code(code);
  if (select role from public.household_members where household_id = hid_a and user_id = b) <> 'member' then
    raise exception 'FAIL: rejoining did not restore the plain member role';
  end if;

  raise notice 'PASS  member cannot self-promote by UPDATE, by DELETE+INSERT, or edit household settings';
end;
$$;

-- ── Dual membership must not become a smuggling route ──────────────────────
-- Bob is now in BOTH households. Every USING/WITH CHECK on lists and items
-- asks only "is the caller a member?", which he satisfies on both sides of a
-- move — so only the immutability triggers stand between him and re-parenting
-- household 1's entire list into household 2.
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  hid_b uuid;
  lid_a uuid;
  lid_b uuid;
  blocked boolean;
begin
  select h.id into hid_b from public.households h where h.name = 'Bravo House';
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;
  select l.id into lid_b from public.lists l where l.household_id = hid_b and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  blocked := false;
  begin
    update public.lists set household_id = hid_b where id = lid_a;
  exception when others then
    blocked := (sqlerrm = 'LIST_HOUSEHOLD_IMMUTABLE');
  end;
  if not blocked then
    raise exception 'FAIL: a dual-household member re-parented household 1''s list into household 2';
  end if;

  blocked := false;
  begin
    update public.items set list_id = lid_b where list_id = lid_a;
  exception when others then
    blocked := (sqlerrm = 'ITEM_LIST_IMMUTABLE');
  end;
  if not blocked then
    raise exception 'FAIL: a dual-household member moved items into household 2''s list';
  end if;

  raise notice 'PASS  lists and items cannot be re-parented across households';
end;
$$;

-- ── Attribution is decided by the JWT, not by the request body ─────────────
do $$
declare
  a     uuid := '00000000-0000-4000-a000-00000000000a';
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid;
  iid   uuid;
begin
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  insert into public.items (list_id, name, added_by)
  values (lid_a, 'forged entry', a)
  returning id into iid;

  if (select added_by from public.items where id = iid) <> b then
    raise exception 'FAIL: Bob created an item attributed to Alice';
  end if;

  update public.items set checked = true, checked_by = a where id = iid;
  if (select checked_by from public.items where id = iid) <> b then
    raise exception 'FAIL: Bob checked an item off as Alice';
  end if;

  -- Editing a field unrelated to `checked` must not rewrite who checked it.
  update public.items set quantity = '9', checked_by = a where id = iid;
  if (select checked_by from public.items where id = iid) <> b then
    raise exception 'FAIL: an unrelated edit rewrote the check-off attribution';
  end if;

  delete from public.items where id = iid;

  raise notice 'PASS  added_by / checked_by cannot be forged by a client';
end;
$$;

-- ── token_hash must be a hash ──────────────────────────────────────────────
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid;
  blocked boolean := false;
begin
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  begin
    insert into public.api_tokens (user_id, list_id, token_hash)
    values (b, lid_a, 'larder_thisisaplaintexttokennotahash');
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: a non-SHA-256 value was accepted into api_tokens.token_hash';
  end if;

  -- A legitimate one, which the removal test below expects to find.
  insert into public.api_tokens (user_id, list_id, token_hash, label)
  values (b, lid_a, repeat('c', 64), 'Bob Siri');

  raise notice 'PASS  token_hash is constrained to 64 hex characters';
end;
$$;

-- ── Owner-only member removal ──────────────────────────────────────────────
do $$
declare
  a     uuid := '00000000-0000-4000-a000-00000000000a';
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid;
  n     int;
begin
  select h.id into hid_a from public.households h where h.name = 'Alpha House';

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  with del as (
    delete from public.household_members where household_id = hid_a and user_id = b returning 1
  ) select count(*) into n from del;
  if n <> 1 then raise exception 'FAIL: owner could not remove a member (removed % rows)', n; end if;

  raise notice 'PASS  owner can remove a member';
end;
$$;

-- ── Removal must also cut off the Siri token ───────────────────────────────
-- The edge function redeems tokens as service_role, which bypasses RLS
-- entirely — so a token that outlives its owner's membership is permanent,
-- unrevokable access to a household that thought it had evicted them.
do $$
declare
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  lid_a uuid;
  revoked timestamptz;
begin
  select l.id into lid_a from public.lists l join public.households h on h.id = l.household_id
   where h.name = 'Alpha House' and l.is_default;

  select t.revoked_at into revoked
  from public.api_tokens t
  where t.user_id = b and t.list_id = lid_a;

  if revoked is null then
    raise exception 'FAIL: an evicted member''s Siri token was left live against household 1''s list';
  end if;

  raise notice 'PASS  removal revokes the departing member''s Siri tokens';
end;
$$;

-- ── Triggers and constraints ───────────────────────────────────────────────
do $$
declare
  a     uuid := '00000000-0000-4000-a000-00000000000a';
  hid_a uuid;
  lid_a uuid;
  iid   uuid;
  before_ts timestamptz;
  after_ts  timestamptz;
  blocked boolean := false;
begin
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  select l.id into lid_a from public.lists l where l.household_id = hid_a and l.is_default;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);

  select i.id, i.updated_at into iid, before_ts from public.items i where i.name = 'oat milk';

  update public.items set quantity = '3' where id = iid;
  select i.updated_at into after_ts from public.items i where i.id = iid;
  if after_ts <= before_ts then
    raise exception 'FAIL: items.updated_at was not bumped by the touch trigger';
  end if;

  update public.items set checked = true where id = iid;
  if (select checked_by from public.items where id = iid) is distinct from a then
    raise exception 'FAIL: checked_by was not attributed to the checking user';
  end if;
  if (select checked_at from public.items where id = iid) is null then
    raise exception 'FAIL: checked_at was not stamped';
  end if;

  update public.items set checked = false where id = iid;
  if (select checked_at from public.items where id = iid) is not null then
    raise exception 'FAIL: un-checking did not clear checked_at';
  end if;

  -- name length / blank constraint
  begin
    insert into public.items (list_id, name) values (lid_a, '   ');
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a blank item name was accepted'; end if;

  -- source constraint
  blocked := false;
  begin
    insert into public.items (list_id, name, source) values (lid_a, 'x', 'telepathy');
  exception when check_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: an invalid source value was accepted'; end if;

  raise notice 'PASS  updated_at / checked attribution triggers and item constraints';
end;
$$;

-- ── Exactly one default list per household ─────────────────────────────────
do $$
declare
  hid_a uuid;
  blocked boolean := false;
begin
  select h.id into hid_a from public.households h where h.name = 'Alpha House';
  begin
    insert into public.lists (household_id, name, is_default) values (hid_a, 'Second Default', true);
  exception when unique_violation then
    blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a household accepted a second default list'; end if;
  raise notice 'PASS  one default list per household is enforced';
end;
$$;

-- ── A household is never left without an owner ─────────────────────────────
-- leave_household() handles succession on its own path, but a raw DELETE
-- through PostgREST does not — and a household with zero owners can never be
-- renamed, deleted, or have a member removed again. Runs last: it takes Alice
-- out of household 1, so nothing after it may depend on her membership.
do $$
declare
  a     uuid := '00000000-0000-4000-a000-00000000000a';
  b     uuid := '00000000-0000-4000-b000-00000000000b';
  hid_a uuid;
  code  text;
  role_now text;
begin
  select h.id, h.join_code into hid_a, code from public.households h where h.name = 'Alpha House';

  set local role authenticated;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform public.join_household_by_code(code);

  -- The sole owner drops her own membership row directly, bypassing the RPC.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from public.household_members where household_id = hid_a and user_id = a;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select m.role into role_now
  from public.household_members m
  where m.household_id = hid_a and m.user_id = b;

  if role_now is distinct from 'owner' then
    raise exception 'FAIL: household 1 was left with no owner (remaining member role: %)', coalesce(role_now, 'none');
  end if;

  raise notice 'PASS  last owner leaving promotes the longest-standing member';
end;
$$;

-- ── anon cannot reach the RPCs either ──────────────────────────────────────
-- Revoking from PUBLIC does not remove Supabase's default EXECUTE grant to
-- the `anon` role, so this asserts the explicit revokes actually landed.
do $$
declare
  blocked boolean;
begin
  set local role anon;
  perform set_config('request.jwt.claims', '', true);

  blocked := false;
  begin
    perform public.generate_join_code();
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'FAIL: an unauthenticated caller minted a join code via /rpc/generate_join_code';
  end if;

  blocked := false;
  begin
    perform public.create_household('Anonymous House');
  exception when insufficient_privilege then
    blocked := true;
  when others then
    blocked := (sqlerrm = 'NOT_AUTHENTICATED');
  end;
  if not blocked then
    raise exception 'FAIL: an unauthenticated caller created a household';
  end if;

  raise notice 'PASS  anon cannot execute the RPCs';
end;
$$;

-- ── Anonymous users get nothing ────────────────────────────────────────────
do $$
declare
  n int;
  blocked boolean := false;
begin
  set local role anon;
  begin
    select count(*) into n from public.items;
    if n <> 0 then raise exception 'FAIL: anon read % items', n; end if;
  exception when insufficient_privilege then
    blocked := true;
  end;
  raise notice 'PASS  anon role reads nothing (blocked=%)', blocked;
end;
$$;

-- ── Realtime wiring ────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    raise exception 'FAIL: public.items is not in the supabase_realtime publication';
  end if;

  if (select relreplident from pg_class where oid = 'public.items'::regclass) <> 'f' then
    raise exception 'FAIL: public.items lacks REPLICA IDENTITY FULL — DELETE events will not propagate';
  end if;

  raise notice 'PASS  realtime publication + replica identity full';
end;
$$;

-- ── RLS is enabled everywhere, no exceptions ───────────────────────────────
do $$
declare
  offender text;
begin
  select string_agg(c.relname, ', ')
    into offender
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in ('profiles','households','household_members','lists','items','api_tokens')
    and not c.relrowsecurity;

  if offender is not null then
    raise exception 'FAIL: RLS is not enabled on: %', offender;
  end if;

  -- Every SECURITY DEFINER function must pin its search_path.
  select string_agg(p.proname, ', ')
    into offender
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
      where cfg like 'search_path=%'
    );

  if offender is not null then
    raise exception 'FAIL: SECURITY DEFINER function(s) without a pinned search_path: %', offender;
  end if;

  raise notice 'PASS  RLS enabled on all six tables; every definer function pins search_path';
end;
$$;

do $$ begin raise notice '───────────────────────────────────────────';
             raise notice 'ALL RLS ASSERTIONS PASSED';
             raise notice '───────────────────────────────────────────'; end; $$;

rollback;
