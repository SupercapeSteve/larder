-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — purchase history, join rate limiting, account deletion/export,
--           push subscriptions
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Purchase history ───────────────────────────────────────────────────────
-- "Clear checked" hard-deletes, so the household had no record of what it
-- actually buys — which makes one-tap re-adding of regulars impossible. This
-- records a purchase the moment an item is ticked, not when it is deleted, so
-- the history survives however the item leaves the list.
create table if not exists public.purchase_history (
  household_id uuid not null references public.households(id) on delete cascade,
  -- Lowercased name, so "Oat Milk" and "oat milk" are the same staple.
  name_key     text not null check (length(trim(name_key)) between 1 and 200),
  name         text not null,
  category     text,
  quantity     text,
  times_bought integer not null default 1,
  last_bought_at timestamptz not null default now(),
  primary key (household_id, name_key)
);

create index if not exists purchase_history_household_idx
  on public.purchase_history(household_id, times_bought desc, last_bought_at desc);

create or replace function public.record_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  hid uuid;
  key text;
begin
  -- Only on the false → true transition. An edit to a already-checked item
  -- must not inflate the count.
  if tg_op = 'UPDATE' and not (new.checked and not old.checked) then
    return null;
  end if;
  if tg_op = 'INSERT' and not new.checked then
    return null;
  end if;

  key := lower(trim(new.name));
  if key = '' then return null; end if;

  select l.household_id into hid from public.lists l where l.id = new.list_id;
  if hid is null then return null; end if;

  insert into public.purchase_history (household_id, name_key, name, category, quantity, times_bought, last_bought_at)
  values (hid, key, new.name, new.category, new.quantity, 1, now())
  on conflict (household_id, name_key) do update
  set times_bought   = public.purchase_history.times_bought + 1,
      last_bought_at = now(),
      name           = excluded.name,
      category       = coalesce(excluded.category, public.purchase_history.category),
      quantity       = excluded.quantity;

  return null;
end;
$$;

drop trigger if exists items_record_purchase on public.items;
create trigger items_record_purchase
  after insert or update of checked on public.items
  for each row execute function public.record_purchase();

alter table public.purchase_history enable row level security;
alter table public.purchase_history force row level security;

drop policy if exists purchase_history_select_member on public.purchase_history;
create policy purchase_history_select_member on public.purchase_history
  for select to authenticated
  using (public.is_household_member(household_id));

-- Writes come from the definer trigger; clients may only forget an entry.
drop policy if exists purchase_history_delete_editor on public.purchase_history;
create policy purchase_history_delete_editor on public.purchase_history
  for delete to authenticated
  using (public.can_edit_household(household_id));

revoke all on public.purchase_history from anon, authenticated;
grant select, delete on public.purchase_history to authenticated;


-- ── Join-code rate limiting ────────────────────────────────────────────────
-- 31^6 is survivable for a targeted guess but not for a grinding attacker, and
-- a hit grants full read/write to a stranger's household. Ten failures an hour
-- per account turns an online brute force into a non-starter.
create table if not exists public.join_attempts (
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded    boolean not null default false
);

create index if not exists join_attempts_user_time_idx
  on public.join_attempts(user_id, attempted_at desc);

alter table public.join_attempts enable row level security;
alter table public.join_attempts force row level security;
-- No policies at all: only the SECURITY DEFINER RPC touches this table.
revoke all on public.join_attempts from anon, authenticated;

create or replace function public.join_household_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := (select auth.uid());
  hid      uuid;
  failures int;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select count(*) into failures
  from public.join_attempts a
  where a.user_id = uid
    and not a.succeeded
    and a.attempted_at > now() - interval '1 hour';

  if failures >= 10 then
    raise exception 'TOO_MANY_ATTEMPTS';
  end if;

  select h.id into hid
  from public.households h
  where h.join_code = upper(trim(coalesce(code, '')));

  if hid is null then
    insert into public.join_attempts (user_id, succeeded) values (uid, false);
    raise exception 'INVALID_CODE';
  end if;

  insert into public.join_attempts (user_id, succeeded) values (uid, true);

  insert into public.household_members (household_id, user_id, role)
  values (hid, uid, 'member')
  on conflict do nothing;

  return hid;
end;
$$;

revoke all on function public.join_household_by_code(text) from public, anon;
grant execute on function public.join_household_by_code(text) to authenticated;


-- ── Export your data ───────────────────────────────────────────────────────
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  out jsonb;
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'households', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', h.name,
        'role', m.role,
        'joined_at', m.joined_at,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', i.name, 'quantity', i.quantity, 'category', i.category,
            'checked', i.checked, 'created_at', i.created_at
          )), '[]'::jsonb)
          from public.items i
          join public.lists l on l.id = i.list_id
          where l.household_id = h.id
        ),
        'history', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', ph.name, 'times_bought', ph.times_bought, 'last_bought_at', ph.last_bought_at
          )), '[]'::jsonb)
          from public.purchase_history ph where ph.household_id = h.id
        )
      )), '[]'::jsonb)
      from public.household_members m
      join public.households h on h.id = m.household_id
      where m.user_id = uid
    ),
    'siri_tokens', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', t.label, 'created_at', t.created_at, 'last_used_at', t.last_used_at
      )), '[]'::jsonb)
      from public.api_tokens t where t.user_id = uid
    )
  ) into out;

  return out;
end;
$$;


-- ── Delete your account ────────────────────────────────────────────────────
-- Removing the auth.users row cascades to profiles, memberships and tokens.
-- The membership deletes fire handle_member_removed, which promotes a
-- successor or deletes a household left empty — so leaving is handled without
-- special-casing it here.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  -- Explicit, so succession runs per household before the cascade.
  delete from public.household_members where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.export_my_data() from public, anon;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.delete_my_account() to authenticated;


-- ── Push subscriptions ─────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
-- The sender runs as service_role and needs every household-mate's endpoint.
grant select on public.push_subscriptions to service_role;
grant select on public.household_members to service_role;


-- ── Structural checks ──────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('purchase_history','join_attempts','push_subscriptions')
     and c.relrowsecurity;
  if n <> 3 then raise exception 'FAIL: RLS missing on one of the new tables (% of 3)', n; end if;

  if not exists (select 1 from pg_trigger where tgname = 'items_record_purchase') then
    raise exception 'FAIL: items_record_purchase trigger missing';
  end if;

  raise notice 'PASS  history, rate limiting, privacy RPCs and push tables ready';
end;
$$;
