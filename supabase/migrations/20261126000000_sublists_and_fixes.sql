-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — sub-lists (dishes, recipes & meal plans) + export completeness
--  Authored by Carbon (Gemini 4 Carbon) following Claude's schema conventions.
--
--  Why two tables (`sublists` + `sublist_items`) rather than a second row in
--  `lists` or a single `sublist_id` column on `items`:
--
--    1. Items in a sub-list MUST still live on the household's main list so a
--       shopper walking the Produce aisle sees everything needed in one pass,
--       and ticking off "garlic" once ticks it everywhere. A second `lists`
--       row would split the shop in two.
--    2. Two dinner plans in the same week routinely share ingredients (garlic,
--       lemons, butter, herbs). A single `sublist_id` foreign key on `items`
--       would silently steal "garlic" from Monday's pasta when Wednesday's
--       stir-fry claims it. A join table lets one item belong to several plans
--       while remaining one row on the main list, with real foreign keys and
--       ON DELETE CASCADE in both directions:
--         * delete a sub-list → links vanish, items stay on the main list
--         * delete an item    → links vanish with it
--    3. `list_id` is carried on `sublist_items` and enforced to match both
--       endpoints by a BEFORE trigger. That lets Realtime filter INSERT/UPDATE
--       by `list_id=eq.<id>` and stops a dual-household member from linking one
--       household's sub-list to another household's item.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.sublists (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references public.lists(id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 80),
  emoji      text check (emoji is null or length(emoji) between 1 and 8),
  note       text check (note is null or length(note) <= 200),
  sort_order double precision not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sublists_list_id_idx
  on public.sublists(list_id, sort_order, created_at);

create table if not exists public.sublist_items (
  sublist_id uuid not null references public.sublists(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  list_id    uuid not null references public.lists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sublist_id, item_id)
);

create index if not exists sublist_items_list_id_idx
  on public.sublist_items(list_id);

create index if not exists sublist_items_item_id_idx
  on public.sublist_items(item_id);


-- ── Triggers ───────────────────────────────────────────────────────────────
drop trigger if exists sublists_touch_updated_at on public.sublists;
create trigger sublists_touch_updated_at
  before update on public.sublists
  for each row execute function public.touch_updated_at();

create or replace function public.forbid_sublist_reparent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.list_id is distinct from old.list_id then
    raise exception 'SUBLIST_LIST_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists sublists_forbid_reparent on public.sublists;
create trigger sublists_forbid_reparent
  before update on public.sublists
  for each row execute function public.forbid_sublist_reparent();

create or replace function public.sync_sublist_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if actor is not null then
      new.created_by := actor;
    end if;
    return new;
  end if;

  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists sublists_sync_creator on public.sublists;
create trigger sublists_sync_creator
  before insert or update on public.sublists
  for each row execute function public.sync_sublist_creator();

-- Enforces that `sublist_id`, `item_id` and `list_id` all belong to the exact
-- same list, and that links are never re-pointed by UPDATE. SECURITY DEFINER
-- because RLS is already checked on the caller; this trigger is a cross-table
-- integrity invariant.
create or replace function public.enforce_sublist_item_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sublist_list uuid;
  item_list    uuid;
begin
  if tg_op = 'UPDATE' then
    if new.sublist_id is distinct from old.sublist_id
       or new.item_id is distinct from old.item_id
       or new.list_id is distinct from old.list_id then
      raise exception 'SUBLIST_ITEM_IMMUTABLE';
    end if;
    return new;
  end if;

  select s.list_id into sublist_list from public.sublists s where s.id = new.sublist_id;
  select i.list_id into item_list    from public.items i    where i.id = new.item_id;

  if sublist_list is null or item_list is null then
    raise exception 'SUBLIST_ITEM_NOT_FOUND';
  end if;

  if sublist_list <> new.list_id or item_list <> new.list_id then
    raise exception 'SUBLIST_ITEM_LIST_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_sublist_item_integrity() from public, anon, authenticated;

drop trigger if exists sublist_items_integrity on public.sublist_items;
create trigger sublist_items_integrity
  before insert or update on public.sublist_items
  for each row execute function public.enforce_sublist_item_integrity();


-- ── Row Level Security & Grants ────────────────────────────────────────────
alter table public.sublists      enable row level security;
alter table public.sublists      force row level security;
alter table public.sublist_items enable row level security;
alter table public.sublist_items force row level security;

drop policy if exists sublists_select_member on public.sublists;
create policy sublists_select_member on public.sublists
  for select to authenticated
  using (public.can_access_list(list_id));

drop policy if exists sublists_insert_editor on public.sublists;
create policy sublists_insert_editor on public.sublists
  for insert to authenticated
  with check (public.can_edit_list(list_id));

drop policy if exists sublists_update_editor on public.sublists;
create policy sublists_update_editor on public.sublists
  for update to authenticated
  using (public.can_edit_list(list_id))
  with check (public.can_edit_list(list_id));

drop policy if exists sublists_delete_editor on public.sublists;
create policy sublists_delete_editor on public.sublists
  for delete to authenticated
  using (public.can_edit_list(list_id));

drop policy if exists sublist_items_select_member on public.sublist_items;
create policy sublist_items_select_member on public.sublist_items
  for select to authenticated
  using (public.can_access_list(list_id));

drop policy if exists sublist_items_insert_editor on public.sublist_items;
create policy sublist_items_insert_editor on public.sublist_items
  for insert to authenticated
  with check (public.can_edit_list(list_id));

drop policy if exists sublist_items_delete_editor on public.sublist_items;
create policy sublist_items_delete_editor on public.sublist_items
  for delete to authenticated
  using (public.can_edit_list(list_id));

revoke all on public.sublists      from anon, authenticated, service_role;
revoke all on public.sublist_items from anon, authenticated, service_role;

grant select, insert, update, delete on public.sublists      to authenticated;
grant select, insert, delete         on public.sublist_items to authenticated;
grant select, insert, update, delete on public.sublists      to service_role;
grant select, insert, delete         on public.sublist_items to service_role;


-- ── Realtime ───────────────────────────────────────────────────────────────
-- Both tables carry `list_id`, so INSERT/UPDATE are server-filtered by list.
-- On `sublist_items`, the primary key IS `(sublist_id, item_id)`, so even an
-- RLS-stripped DELETE payload still delivers both halves of the link.
alter table public.sublists      replica identity full;
alter table public.sublist_items replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'sublists'
  ) then
    alter publication supabase_realtime add table public.sublists;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'sublist_items'
  ) then
    alter publication supabase_realtime add table public.sublist_items;
  end if;
end;
$$;


-- ── Update export_my_data() to include item notes & sub-lists ──────────────
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
            'note', i.note, 'checked', i.checked, 'created_at', i.created_at
          )), '[]'::jsonb)
          from public.items i
          join public.lists l on l.id = i.list_id
          where l.household_id = h.id
        ),
        'sublists', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', s.name,
            'emoji', s.emoji,
            'note', s.note,
            'created_at', s.created_at,
            'items', (
              select coalesce(jsonb_agg(i.name), '[]'::jsonb)
              from public.sublist_items si
              join public.items i on i.id = si.item_id
              where si.sublist_id = s.id
            )
          )), '[]'::jsonb)
          from public.sublists s
          join public.lists l on l.id = s.list_id
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

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;


-- ── Self-test ──────────────────────────────────────────────────────────────
do $$
declare
  n int;
begin
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
     and c.relname in ('sublists', 'sublist_items')
     and c.relrowsecurity
     and c.relforcerowsecurity;
  if n <> 2 then
    raise exception 'FAIL: RLS / FORCE RLS missing on sublists or sublist_items (% of 2)', n;
  end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'sublists';
  if n <> 4 then
    raise exception 'FAIL: expected 4 policies on sublists, found %', n;
  end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'sublist_items';
  if n <> 3 then
    raise exception 'FAIL: expected 3 policies on sublist_items, found %', n;
  end if;

  select count(*) into n from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public'
    and tablename in ('sublists', 'sublist_items');
  if n <> 2 then
    raise exception 'FAIL: sublists or sublist_items missing from supabase_realtime (% of 2)', n;
  end if;

  if (select relreplident from pg_class where oid = 'public.sublists'::regclass) <> 'f'
     or (select relreplident from pg_class where oid = 'public.sublist_items'::regclass) <> 'f' then
    raise exception 'FAIL: REPLICA IDENTITY FULL missing on sublists or sublist_items';
  end if;

  raise notice 'PASS  sublists and sublist_items: RLS forced, policies wired, realtime published';
end;
$$;
