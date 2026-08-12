-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — granular household roles
--
--  owner  → everything, including changing roles and deleting the household
--  admin  → manage the list, rename, rotate the code, remove members
--  member → add / check / edit / delete items
--  viewer → read the list, nothing else
--
--  Enforced in RLS, not in the UI. A viewer who calls PostgREST directly gets
--  the same answer as one who taps a hidden button: no.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Widen the allowed roles ────────────────────────────────────────────────
alter table public.household_members
  drop constraint if exists household_members_role_check;

alter table public.household_members
  add constraint household_members_role_check
  check (role in ('owner', 'admin', 'member', 'viewer'));


-- ── Helpers ────────────────────────────────────────────────────────────────
-- Admin-or-owner. Used for the household-management surface.
create or replace function public.is_household_admin(hid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = hid
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

-- May this user *change* the list? Everyone except a viewer.
-- can_access_list() stays as the read gate; this is the write gate.
create or replace function public.can_edit_list(lid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.lists l
    join public.household_members m on m.household_id = l.household_id
    where l.id = lid
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.is_household_admin(uuid) from public, anon;
revoke all on function public.can_edit_list(uuid) from public, anon;
grant execute on function public.is_household_admin(uuid) to authenticated;
grant execute on function public.can_edit_list(uuid) to authenticated;


-- ── items: read for all members, write for everyone but viewers ────────────
drop policy if exists items_insert_member on public.items;
create policy items_insert_member on public.items
  for insert to authenticated
  with check (public.can_edit_list(list_id));

drop policy if exists items_update_member on public.items;
create policy items_update_member on public.items
  for update to authenticated
  using (public.can_edit_list(list_id))
  with check (public.can_edit_list(list_id));

drop policy if exists items_delete_member on public.items;
create policy items_delete_member on public.items
  for delete to authenticated
  using (public.can_edit_list(list_id));


-- ── lists: same split ──────────────────────────────────────────────────────
drop policy if exists lists_insert_member on public.lists;
create policy lists_insert_member on public.lists
  for insert to authenticated
  with check (public.is_household_member(household_id) and public.is_household_admin(household_id));

drop policy if exists lists_update_member on public.lists;
create policy lists_update_member on public.lists
  for update to authenticated
  using (public.is_household_admin(household_id))
  with check (public.is_household_admin(household_id));

drop policy if exists lists_delete_member on public.lists;
create policy lists_delete_member on public.lists
  for delete to authenticated
  using (public.is_household_admin(household_id));


-- ── households: admins rename, only owners delete ──────────────────────────
drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
  for update to authenticated
  using (public.is_household_admin(id))
  with check (public.is_household_admin(id));

-- DELETE stays owner-only; households_delete_owner is unchanged.


-- ── membership removal ─────────────────────────────────────────────────────
-- Yourself always. An owner may remove anyone. An admin may remove members and
-- viewers, but not another admin and not an owner — otherwise "admin" would be
-- indistinguishable from "owner" in one step.
drop policy if exists household_members_delete_self_or_owner on public.household_members;
create policy household_members_delete_self_or_owner on public.household_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_household_owner(household_id)
    or (public.is_household_admin(household_id) and role in ('member', 'viewer'))
  );


-- ── api_tokens: a viewer must not mint a token that can write ──────────────
-- The Siri endpoint runs as service_role and bypasses RLS, so the token itself
-- is the authorisation. Gate minting on write access, not merely membership.
drop policy if exists api_tokens_insert_own on public.api_tokens;
create policy api_tokens_insert_own on public.api_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_edit_list(list_id));

drop policy if exists api_tokens_update_own on public.api_tokens;
create policy api_tokens_update_own on public.api_tokens
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_list_household_owner(list_id))
  with check (user_id = (select auth.uid()) and public.can_edit_list(list_id));


-- ── Rotating the code is an admin power now ────────────────────────────────
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
    where m.household_id = hid and m.user_id = uid and m.role in ('owner', 'admin')
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


-- ── Role changes stay owner-only, now across four roles ────────────────────
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

  if new_role not in ('owner', 'admin', 'member', 'viewer') then
    raise exception 'INVALID_ROLE';
  end if;

  -- Deliberately owner-only: an admin who could grant admin could promote a
  -- confederate and collectively take the household.
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


-- ── Succession prefers an admin ────────────────────────────────────────────
create or replace function public.handle_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining int;
  owners    int;
  successor uuid;
begin
  update public.api_tokens t
     set revoked_at = now()
    from public.lists l
   where t.list_id = l.id
     and l.household_id = old.household_id
     and t.user_id = old.user_id
     and t.revoked_at is null;

  if not exists (select 1 from public.households h where h.id = old.household_id) then
    return null;
  end if;

  select count(*) into remaining
  from public.household_members m
  where m.household_id = old.household_id;

  if remaining = 0 then
    delete from public.households h where h.id = old.household_id;
    return null;
  end if;

  select count(*) into owners
  from public.household_members m
  where m.household_id = old.household_id and m.role = 'owner';

  if owners = 0 then
    -- An admin is the closest thing to an owner already; a viewer is the last
    -- resort, since a household with nobody able to administer it is worse
    -- than promoting somebody who was only meant to look.
    select m.user_id into successor
    from public.household_members m
    where m.household_id = old.household_id
    order by
      case m.role when 'admin' then 0 when 'member' then 1 else 2 end,
      m.joined_at asc,
      m.user_id asc
    limit 1;

    update public.household_members m
    set role = 'owner'
    where m.household_id = old.household_id and m.user_id = successor;
  end if;

  return null;
end;
$$;


-- ── Self-test ──────────────────────────────────────────────────────────────
-- The fixture is created inside a subtransaction that is then deliberately
-- aborted, so every write it made is rolled back automatically. That avoids
-- needing a DELETE at the end — the role that applies migrations does not hold
-- one on public.households, and cleaning up as `authenticated` fails too.
do $$
declare
  a uuid;
  b uuid;
  hid uuid;
  lid uuid;
  n int;
  blocked boolean;
begin
  select id into a from auth.users order by created_at limit 1;
  select id into b from auth.users where id <> a order by created_at limit 1;
  if a is null or b is null then
    raise notice 'Need two auth users for the role self-test — skipping.';
    return;
  end if;

  begin
  insert into public.households (name, join_code, created_by)
  values ('ROLE SELF TEST', 'ZZROLE', a) returning id into hid;
  insert into public.household_members (household_id, user_id, role) values (hid, a, 'owner');
  insert into public.household_members (household_id, user_id, role) values (hid, b, 'viewer');
  insert into public.lists (household_id, name, is_default) values (hid, 'Groceries', true)
    returning id into lid;
  insert into public.items (list_id, name) values (lid, 'existing item');

  -- Viewer: can read, cannot write.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  select count(*) into n from public.items where list_id = lid;
  if n <> 1 then raise exception 'FAIL: a viewer cannot see the list (% rows)', n; end if;

  blocked := false;
  begin
    insert into public.items (list_id, name) values (lid, 'viewer should not add this');
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a viewer added an item'; end if;

  with upd as (update public.items set checked = true where list_id = lid returning 1)
  select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a viewer checked off % items', n; end if;

  with del as (delete from public.items where list_id = lid returning 1)
  select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: a viewer deleted % items', n; end if;

  blocked := false;
  begin
    insert into public.api_tokens (user_id, list_id, token_hash) values (b, lid, repeat('d', 64));
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'FAIL: a viewer minted a write-capable Siri token'; end if;

  -- Promote to member: writing now works.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.set_member_role(hid, b, 'member');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  insert into public.items (list_id, name) values (lid, 'member can add');

  -- A member still cannot rename the household.
  with upd as (update public.households set name = 'nope' where id = hid returning 1)
  select count(*) into n from upd;
  if n <> 0 then raise exception 'FAIL: a member renamed the household'; end if;

  -- Promote to admin: rename works, changing roles does not.
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform public.set_member_role(hid, b, 'admin');

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  with upd as (update public.households set name = 'Renamed by admin' where id = hid returning 1)
  select count(*) into n from upd;
  if n <> 1 then raise exception 'FAIL: an admin could not rename the household'; end if;

  blocked := false;
  begin
    perform public.set_member_role(hid, a, 'member');
  exception when others then blocked := (sqlerrm = 'NOT_OWNER');
  end;
  if not blocked then raise exception 'FAIL: an admin changed roles'; end if;

  -- An admin cannot remove an owner.
  with del as (delete from public.household_members where household_id = hid and user_id = a returning 1)
  select count(*) into n from del;
  if n <> 0 then raise exception 'FAIL: an admin removed an owner'; end if;

    -- Everything asserted. Abort the subtransaction to undo the fixture.
    raise exception 'LARDER_SELFTEST_ROLLBACK';
  exception when others then
    -- A real assertion failure must still fail the migration.
    if sqlerrm <> 'LARDER_SELFTEST_ROLLBACK' then raise; end if;
  end;

  raise notice 'PASS  viewer/member/admin/owner boundaries all enforced by RLS';
end;
$$;
