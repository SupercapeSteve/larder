-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — learned category rules
--
--  The built-in keyword map will always be wrong about something: "Red Tortilla
--  Chips" landed in Bakery because `tortilla` is a bread keyword. Correcting an
--  item should teach the household, not just fix that one row — otherwise you
--  re-correct it every single shop.
--
--  A rule is per household, so one household calling tortilla chips a snack
--  does not impose that on anyone else.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.category_rules (
  household_id uuid not null references public.households(id) on delete cascade,
  -- Lowercased, trimmed. Matched against the item name.
  keyword      text not null check (length(trim(keyword)) between 1 and 100),
  category     text not null,
  created_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  primary key (household_id, keyword)
);

create index if not exists category_rules_household_idx
  on public.category_rules(household_id);


-- Everyone but a viewer may teach the household a rule.
create or replace function public.can_edit_household(hid uuid)
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
      and m.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.can_edit_household(uuid) from public, anon;
grant execute on function public.can_edit_household(uuid) to authenticated;


alter table public.category_rules enable row level security;
alter table public.category_rules force row level security;

drop policy if exists category_rules_select_member on public.category_rules;
create policy category_rules_select_member on public.category_rules
  for select to authenticated
  using (public.is_household_member(household_id));

drop policy if exists category_rules_insert_editor on public.category_rules;
create policy category_rules_insert_editor on public.category_rules
  for insert to authenticated
  with check (public.can_edit_household(household_id));

drop policy if exists category_rules_update_editor on public.category_rules;
create policy category_rules_update_editor on public.category_rules
  for update to authenticated
  using (public.can_edit_household(household_id))
  with check (public.can_edit_household(household_id));

drop policy if exists category_rules_delete_editor on public.category_rules;
create policy category_rules_delete_editor on public.category_rules
  for delete to authenticated
  using (public.can_edit_household(household_id));

revoke all on public.category_rules from anon;
grant select, insert, update, delete on public.category_rules to authenticated;

-- Rules change rarely, but when they do every device should follow.
alter table public.category_rules replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'category_rules'
  ) then
    alter publication supabase_realtime add table public.category_rules;
  end if;
end;
$$;


-- ── Structural checks ──────────────────────────────────────────────────────
-- Deliberately no fixtures: the role that applies migrations holds no DELETE
-- on households, so a fixture cannot be cleaned up here.
do $$
declare
  n int;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'category_rules' and c.relrowsecurity
  ) then
    raise exception 'FAIL: RLS is not enabled on category_rules';
  end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'category_rules';
  if n <> 4 then
    raise exception 'FAIL: expected 4 policies on category_rules, found %', n;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'category_rules'
  ) then
    raise exception 'FAIL: category_rules is not published for realtime';
  end if;

  raise notice 'PASS  category_rules: RLS on, 4 policies, realtime published';
end;
$$;
