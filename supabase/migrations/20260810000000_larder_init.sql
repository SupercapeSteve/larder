-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — initial schema, security and realtime
--  Applies cleanly to a fresh database. Idempotent where Postgres allows it.
--
--  Read the RLS section before editing. Every policy that touches
--  household_members goes through a SECURITY DEFINER helper; writing the
--  "obvious" self-referencing subquery produces:
--      ERROR: infinite recursion detected in policy for relation
--             "household_members"
-- ═══════════════════════════════════════════════════════════════════════════

-- gen_random_uuid() lives in pgcrypto on older Postgres; on 13+ it is core.
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────── PROFILES ──
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────── HOUSEHOLDS ──
create table if not exists public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text not null unique,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────── MEMBERS ──
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_id_idx
  on public.household_members(user_id);

-- ────────────────────────────────────────────────────────────────── LISTS ──
create table if not exists public.lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null default 'Groceries',
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists lists_household_id_idx on public.lists(household_id);

-- Exactly one default list per household, enforced by the database rather than
-- by convention.
create unique index if not exists lists_one_default_per_household_idx
  on public.lists(household_id) where is_default;

-- ────────────────────────────────────────────────────────────────── ITEMS ──
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 200),
  quantity   text,
  category   text,
  note       text,
  checked    boolean not null default false,
  added_by   uuid references auth.users(id) on delete set null,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  source     text not null default 'app' check (source in ('app','siri')),
  sort_order double precision not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_list_id_idx on public.items(list_id);
create index if not exists items_list_checked_idx on public.items(list_id, checked);

-- ───────────────────────────────────────────────────────────── API TOKENS ──
create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  list_id      uuid not null references public.lists(id) on delete cascade,
  -- 64 lowercase hex characters, i.e. a SHA-256 digest and nothing else. The
  -- client does the hashing, so without this constraint a buggy build could
  -- POST the plaintext token into the column and the database would take it.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label        text not null default 'Siri Shortcut',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists api_tokens_user_id_idx on public.api_tokens(user_id);


-- ═══════════════════════════════════════════════════════════════════════════
--  SECURITY DEFINER HELPERS
--
--  These run with the definer's privileges, which means RLS is not re-applied
--  to the tables they read. That is precisely what breaks the policy-recursion
--  cycle on household_members.
--
--  `set search_path = ''` (with fully-qualified names) is mandatory: without a
--  pinned search_path a definer function can be hijacked by a caller-controlled
--  schema shadowing the tables it references.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_household_member(hid uuid)
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
  );
$$;

create or replace function public.is_household_owner(hid uuid)
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
      and m.role = 'owner'
  );
$$;

create or replace function public.can_access_list(lid uuid)
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
  );
$$;

-- Used by the profiles SELECT policy so household-mates can be attributed by
-- name. Without a definer helper this policy would read household_members and
-- recurse in exactly the same way.
create or replace function public.shares_household_with(uid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members me
    join public.household_members them
      on them.household_id = me.household_id
    where me.user_id = (select auth.uid())
      and them.user_id = uid
  );
$$;

-- Lets a household owner see and revoke Siri tokens aimed at their own lists.
-- Without it the token's *minter* is the only person who can revoke it, so a
-- household has no way to audit or cut off access to its own groceries.
create or replace function public.is_list_household_owner(lid uuid)
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
      and m.role = 'owner'
  );
$$;

revoke all on function public.is_list_household_owner(uuid) from public, anon;
grant execute on function public.is_list_household_owner(uuid) to authenticated;

-- Revoking from PUBLIC is not enough. Supabase's default privileges grant ALL
-- on functions to `anon` *by name*, and a grant to a named role survives a
-- revoke from PUBLIC — so every one of these would otherwise be callable
-- unauthenticated over /rest/v1/rpc/.
revoke all on function public.is_household_member(uuid)   from public, anon;
revoke all on function public.is_household_owner(uuid)    from public, anon;
revoke all on function public.can_access_list(uuid)       from public, anon;
revoke all on function public.shares_household_with(uuid) from public, anon;

-- `authenticated` needs EXECUTE because policy expressions are evaluated as
-- the querying role, not as the policy's author.
grant execute on function public.is_household_member(uuid)   to authenticated;
grant execute on function public.is_household_owner(uuid)    to authenticated;
grant execute on function public.can_access_list(uuid)       to authenticated;
grant execute on function public.shares_household_with(uuid) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  JOIN CODES
--  6 chars, uppercase, from an alphabet with no 0/O and no 1/I/L — it gets
--  read aloud over the phone.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.generate_join_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- Nobody but the definer RPCs may mint a code. Revoked from anon explicitly:
-- without that, /rest/v1/rpc/generate_join_code hands a fresh code to an
-- unauthenticated caller.
revoke all on function public.generate_join_code() from public, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════

-- A profile row for every new auth user. display_name comes from the sign-up
-- metadata; the email local-part is the fallback so the column is never empty.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  name text;
begin
  name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if name is null then
    name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if name is null then
    name := 'Someone';
  end if;

  insert into public.profiles (id, display_name)
  values (new.id, left(name, 60))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at maintenance. Assigning to NEW in a BEFORE trigger is the only way
-- to make this authoritative regardless of what the client sends.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists items_touch_updated_at on public.items;
create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();

-- Attribution is decided here, not by the client.
--
-- The first draft used `coalesce(new.checked_by, auth.uid())`, which meant a
-- client-supplied value *won* — so any household member could manufacture a
-- check-off attributed to somebody else, and `added_by` was accepted verbatim
-- with no validation at all. The rule is now: if the request carries a JWT,
-- that user is the actor and nothing they send overrides it. If it does not
-- (auth.uid() is null — the service role, i.e. the Siri endpoint), the caller
-- is trusted to name the actor, because the token *is* the identity there.
create or replace function public.sync_checked_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if actor is not null then
      new.added_by := actor;
    end if;

    if new.checked then
      new.checked_at := coalesce(new.checked_at, now());
      if actor is not null then new.checked_by := actor; end if;
    else
      new.checked_at := null;
      new.checked_by := null;
    end if;
    return new;
  end if;

  -- Who added it is settled at insert and is not renegotiable.
  new.added_by := old.added_by;

  if new.checked is distinct from old.checked then
    if new.checked then
      new.checked_at := now();
      if actor is not null then new.checked_by := actor; end if;
    else
      new.checked_at := null;
      new.checked_by := null;
    end if;
  else
    -- Editing a name or quantity must not silently rewrite who checked it.
    new.checked_at := old.checked_at;
    new.checked_by := old.checked_by;
  end if;

  return new;
end;
$$;

-- ── Ownership of a row is immutable ────────────────────────────────────────
-- `using` and `with check` on lists/items both ask only "is the caller a
-- member?". Someone who belongs to two households satisfies both for a move
-- between them — so they could re-parent household 1's list into household 2
-- and walk off with every item on it, invisibly to household 1. No product
-- feature moves a list or an item between households, so forbid it outright.
create or replace function public.forbid_reparent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'lists' and new.household_id is distinct from old.household_id then
    raise exception 'LIST_HOUSEHOLD_IMMUTABLE';
  end if;
  if tg_table_name = 'items' and new.list_id is distinct from old.list_id then
    raise exception 'ITEM_LIST_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists lists_forbid_reparent on public.lists;
create trigger lists_forbid_reparent
  before update on public.lists
  for each row execute function public.forbid_reparent();

drop trigger if exists items_forbid_reparent on public.items;
create trigger items_forbid_reparent
  before update on public.items
  for each row execute function public.forbid_reparent();

-- ── Losing membership means losing everything, Siri included ───────────────
-- Two invariants that no policy can express, both enforced the moment a
-- membership row disappears — whichever code path removed it:
--
--   1. Any Siri token that member holds against this household's lists is
--      revoked. Without this, an evicted member keeps permanent read/write
--      access: the edge function runs as service_role, which bypasses RLS
--      entirely, so the stale token binding is all the authorisation it needs.
--   2. The household still has an owner. leave_household() handles succession
--      for its own path, but a raw DELETE through PostgREST does not, and a
--      household with zero owners can never be renamed, deleted, or have a
--      member removed again — it is permanently unadministrable.
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

  -- The household itself is already on its way out (cascade). Nothing to do.
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
    select m.user_id into successor
    from public.household_members m
    where m.household_id = old.household_id
    order by m.joined_at asc, m.user_id asc
    limit 1;

    update public.household_members m
    set role = 'owner'
    where m.household_id = old.household_id and m.user_id = successor;
  end if;

  return null;
end;
$$;

drop trigger if exists household_members_after_delete on public.household_members;
create trigger household_members_after_delete
  after delete on public.household_members
  for each row execute function public.handle_member_removed();

drop trigger if exists items_sync_checked on public.items;
create trigger items_sync_checked
  before insert or update on public.items
  for each row execute function public.sync_checked_metadata();


-- ═══════════════════════════════════════════════════════════════════════════
--  RPCs
-- ═══════════════════════════════════════════════════════════════════════════

-- Creating a household is three writes that must succeed or fail together:
-- the household, the owner membership, and the default list. A function body
-- is a single transaction, so this is atomic by construction. It also has to
-- be SECURITY DEFINER — the creator is not yet a member, so the households
-- SELECT policy could not see the row it just wrote.
create or replace function public.create_household(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  hid       uuid;
  lid       uuid;
  code      text;
  attempts  int := 0;
  clean_name text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  clean_name := nullif(trim(coalesce(p_name, '')), '');
  if clean_name is null then
    raise exception 'INVALID_NAME';
  end if;
  clean_name := left(clean_name, 60);

  -- Retry on the astronomically unlikely code collision rather than failing
  -- the user's first action in the app.
  loop
    attempts := attempts + 1;
    code := public.generate_join_code();
    begin
      insert into public.households (name, join_code, created_by)
      values (clean_name, code, uid)
      returning id into hid;
      exit;
    exception when unique_violation then
      if attempts >= 10 then
        raise exception 'JOIN_CODE_EXHAUSTED';
      end if;
    end;
  end loop;

  insert into public.household_members (household_id, user_id, role)
  values (hid, uid, 'owner');

  insert into public.lists (household_id, name, is_default)
  values (hid, 'Groceries', true)
  returning id into lid;

  return jsonb_build_object(
    'household_id', hid,
    'join_code',    code,
    'list_id',      lid
  );
end;
$$;

-- Joining cannot be a plain INSERT policy: the user is not a member yet, so
-- they cannot read the household to discover its id.
create or replace function public.join_household_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select h.id into hid
  from public.households h
  where h.join_code = upper(trim(coalesce(code, '')));

  if hid is null then
    raise exception 'INVALID_CODE';
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (hid, uid, 'member')
  on conflict do nothing;

  return hid;
end;
$$;

-- Leaving is just a delete. Owner succession, token revocation and
-- deleting-the-household-when-empty all live in the handle_member_removed
-- trigger, so they hold no matter which path removed the row — this RPC, an
-- owner removing somebody, or a raw DELETE through PostgREST.
create or replace function public.leave_household(hid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  delete from public.household_members m
  where m.household_id = hid and m.user_id = uid;

  if not found then
    raise exception 'NOT_A_MEMBER';
  end if;
end;
$$;

revoke all on function public.create_household(text)        from public, anon;
revoke all on function public.join_household_by_code(text)  from public, anon;
revoke all on function public.leave_household(uuid)         from public, anon;

grant execute on function public.create_household(text)       to authenticated;
grant execute on function public.join_household_by_code(text) to authenticated;
grant execute on function public.leave_household(uuid)        to authenticated;


-- Touched daily by .github/workflows/keepalive.yml so the free tier does not
-- auto-pause the project after seven idle days. Returns a constant and reads
-- no table, but it is a real round trip through Postgres, which is the point.
-- Executable by anon deliberately: the workflow has only the publishable key.
create or replace function public.keepalive()
returns text
language sql
stable
set search_path = ''
as $$
  select 'ok'::text;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY
--  Enabled on every table. No exceptions.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.lists             enable row level security;
alter table public.items             enable row level security;
alter table public.api_tokens        enable row level security;

-- Belt and braces: even if a policy were dropped by accident, the anon and
-- authenticated roles have no table-level grant beyond what is needed.
alter table public.profiles          force row level security;
alter table public.households        force row level security;
alter table public.household_members force row level security;
alter table public.lists             force row level security;
alter table public.items             force row level security;
alter table public.api_tokens        force row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
drop policy if exists profiles_select_self_or_household on public.profiles;
create policy profiles_select_self_or_household on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_household_with(id));

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ── households ─────────────────────────────────────────────────────────────
drop policy if exists households_select_member on public.households;
create policy households_select_member on public.households
  for select to authenticated
  using (public.is_household_member(id));

drop policy if exists households_insert_own on public.households;
create policy households_insert_own on public.households
  for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists households_update_owner on public.households;
create policy households_update_owner on public.households
  for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

drop policy if exists households_delete_owner on public.households;
create policy households_delete_owner on public.households
  for delete to authenticated
  using (public.is_household_owner(id));

-- ── household_members ──────────────────────────────────────────────────────
drop policy if exists household_members_select_member on public.household_members;
create policy household_members_select_member on public.household_members
  for select to authenticated
  using (public.is_household_member(household_id));

-- Self-insert only, and never as an owner.
--
-- This policy is defence in depth, not the gate. The INSERT privilege is
-- revoked from `authenticated` further down, so membership can only be created
-- by the SECURITY DEFINER RPCs, which are the only code that checks a join
-- code. Left in place because a policy is cheap and a missing one is not.
--
-- Two holes this closes, both of which were live in the first draft:
--   1. `role` unconstrained: delete your own row, re-insert it as 'owner'.
--      The update-only policy below never sees the attack.
--   2. `household_id` unconstrained: possession of a household UUID *was*
--      membership, which made the join code decorative and made removing
--      somebody unenforceable — they just re-insert themselves.
drop policy if exists household_members_insert_self on public.household_members;
create policy household_members_insert_self on public.household_members
  for insert to authenticated
  with check (user_id = (select auth.uid()) and role = 'member');

-- Leave yourself, or — as owner — remove somebody else.
drop policy if exists household_members_delete_self_or_owner on public.household_members;
create policy household_members_delete_self_or_owner on public.household_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_household_owner(household_id));

-- Only an owner changes roles, and nobody may demote or promote via a plain
-- UPDATE that moves a membership to a different household.
drop policy if exists household_members_update_owner on public.household_members;
create policy household_members_update_owner on public.household_members
  for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

-- ── lists ──────────────────────────────────────────────────────────────────
drop policy if exists lists_select_member on public.lists;
create policy lists_select_member on public.lists
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists lists_insert_member on public.lists;
create policy lists_insert_member on public.lists
  for insert to authenticated
  with check (public.is_household_member(household_id));

drop policy if exists lists_update_member on public.lists;
create policy lists_update_member on public.lists
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

drop policy if exists lists_delete_member on public.lists;
create policy lists_delete_member on public.lists
  for delete to authenticated
  using (public.is_household_member(household_id));

-- ── items ──────────────────────────────────────────────────────────────────
-- `using` guards the rows you may read/modify; `with check` guards the row you
-- are writing. Both are required, or a member could move an item into another
-- household's list with an UPDATE.
drop policy if exists items_select_member on public.items;
create policy items_select_member on public.items
  for select to authenticated
  using (public.can_access_list(list_id));

drop policy if exists items_insert_member on public.items;
create policy items_insert_member on public.items
  for insert to authenticated
  with check (public.can_access_list(list_id));

drop policy if exists items_update_member on public.items;
create policy items_update_member on public.items
  for update to authenticated
  using (public.can_access_list(list_id))
  with check (public.can_access_list(list_id));

drop policy if exists items_delete_member on public.items;
create policy items_delete_member on public.items
  for delete to authenticated
  using (public.can_access_list(list_id));

-- ── api_tokens ─────────────────────────────────────────────────────────────
-- Owner-of-the-token only, and the bound list must be one they can reach —
-- otherwise a user could mint a Siri token pointed at a stranger's list.
-- Beyond spec, deliberately: a household owner can also *see* tokens pointed
-- at their lists. A token they cannot see is a token they cannot revoke, and
-- the edge function redeems it with RLS bypassed.
drop policy if exists api_tokens_select_own on public.api_tokens;
create policy api_tokens_select_own on public.api_tokens
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_list_household_owner(list_id));

drop policy if exists api_tokens_insert_own on public.api_tokens;
create policy api_tokens_insert_own on public.api_tokens
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_access_list(list_id));

drop policy if exists api_tokens_update_own on public.api_tokens;
create policy api_tokens_update_own on public.api_tokens
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_access_list(list_id));

-- Deleting the row is a complete revocation, and it is the one destructive
-- action a household owner is allowed to take against somebody else's token.
drop policy if exists api_tokens_delete_own on public.api_tokens;
create policy api_tokens_delete_own on public.api_tokens
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_list_household_owner(list_id));


-- ═══════════════════════════════════════════════════════════════════════════
--  GRANTS
--
--  RLS filters rows; grants decide whether the role may touch the table at
--  all. Both matter, and grants are the layer that is easy to get wrong here.
--
--  Supabase ships
--      alter default privileges in schema public
--        grant all on tables to postgres, anon, authenticated, service_role;
--  so every table above arrives with a table-level ALL grant for all four
--  roles already attached. Two consequences that bit the first draft:
--
--    * A column-scoped `grant update (role)` adds nothing — column privileges
--      are additive, so the inherited table-level UPDATE still applies to
--      user_id, household_id and joined_at.
--    * Revoking from anon alone leaves `authenticated` holding ALL on
--      everything, which is far more than any policy assumes.
--
--  So: strip all three client roles back to nothing, then grant exactly what
--  each one needs. Order matters — this must run after the CREATE TABLEs and
--  before the grants, or it is either a no-op or a self-inflicted wound.
-- ═══════════════════════════════════════════════════════════════════════════

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all tables in schema public from service_role;
revoke all on all sequences in schema public from anon;

-- ── authenticated (the browser, through PostgREST) ─────────────────────────
-- No INSERT on households or household_members: creating a household and
-- joining one both go through SECURITY DEFINER RPCs that validate what the
-- policies cannot. No UPDATE on household_members: role changes are not a
-- product feature, and allowing them re-opens the escalation path.
grant select, insert, update, delete on public.items             to authenticated;
grant select, insert, update, delete on public.lists             to authenticated;
grant select, insert, update, delete on public.api_tokens        to authenticated;
grant select, delete                 on public.household_members to authenticated;
grant select, update                 on public.households        to authenticated;
grant select, update                 on public.profiles          to authenticated;

-- ── service_role (the Siri edge function only) ─────────────────────────────
-- BYPASSRLS skips policy evaluation; it does not confer table privileges. The
-- endpoint would have failed on its first statement with 42501 without these.
-- Least privilege still applies: it can write items, and read just enough to
-- prove the token is still entitled to the list it is bound to.
grant select, insert, update, delete on public.items             to service_role;
grant select                         on public.lists             to service_role;
grant select                         on public.household_members to service_role;
grant select                         on public.profiles          to service_role;
grant select, update                 on public.api_tokens        to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
--  REALTIME
--
--  `replica identity full` is not optional. With the default (primary key
--  only) a DELETE event carries just the id, RLS cannot evaluate the policy
--  against the removed row, and the delete silently never reaches the other
--  client — the item stays on their screen forever.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;
end;
$$;

-- Fail the migration loudly rather than shipping a silently dead realtime
-- feature that only shows up as "the other phone never updates".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    raise exception 'items is not in the supabase_realtime publication — realtime would be dead on arrival';
  end if;

  if (select relreplident from pg_class where oid = 'public.items'::regclass) <> 'f' then
    raise exception 'items does not have REPLICA IDENTITY FULL — DELETE events would not propagate';
  end if;

  -- The SECURITY DEFINER RPCs write rows that the policies deliberately
  -- forbid clients from writing (an owner membership row, a household with no
  -- members yet). That only works because the definer — the role applying this
  -- migration — bypasses RLS. On Supabase `postgres` has BYPASSRLS and this is
  -- a no-op; anywhere else, say so now rather than at the user's first tap.
  if not exists (
    select 1 from pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)
  ) then
    raise warning
      'Applied by % , which lacks BYPASSRLS. FORCE ROW LEVEL SECURITY will then apply to the SECURITY DEFINER RPCs and create_household() will fail. Apply as postgres.',
      current_user;
  end if;
end;
$$;
