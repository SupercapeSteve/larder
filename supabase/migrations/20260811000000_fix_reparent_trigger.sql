-- ═══════════════════════════════════════════════════════════════════════════
--  Fix: every UPDATE on public.items failed.
--
--  The re-parenting guard was a single function bound to two tables, branching
--  on tg_table_name:
--
--      if tg_table_name = 'lists' and new.household_id is distinct from ...
--
--  PL/pgSQL evaluates that condition as one SQL expression, and SQL does not
--  guarantee short-circuit evaluation of AND. So `new.household_id` still had
--  to resolve when the trigger fired on `items`, where no such column exists,
--  and the statement aborted with:
--
--      ERROR: record "new" has no field "household_id"
--
--  Every UPDATE on items therefore failed: checking an item off, un-checking
--  it, renaming it, changing its quantity, category or note. INSERT and DELETE
--  were unaffected, because the trigger is BEFORE UPDATE only — which is why
--  adding and deleting looked fine while check-offs reverted a moment later.
--
--  Split into one function per table so each only ever touches columns that
--  exist on the table it is attached to.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.forbid_list_reparent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'LIST_HOUSEHOLD_IMMUTABLE';
  end if;
  return new;
end;
$$;

create or replace function public.forbid_item_reparent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.list_id is distinct from old.list_id then
    raise exception 'ITEM_LIST_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists lists_forbid_reparent on public.lists;
create trigger lists_forbid_reparent
  before update on public.lists
  for each row execute function public.forbid_list_reparent();

drop trigger if exists items_forbid_reparent on public.items;
create trigger items_forbid_reparent
  before update on public.items
  for each row execute function public.forbid_item_reparent();

-- Nothing references it now.
drop function if exists public.forbid_reparent();

-- Prove the fix rather than assume it: round-trip an UPDATE through the
-- trigger on a temporary row and roll it back. If the trigger is still broken
-- this migration fails here instead of shipping a list nobody can tick.
do $$
declare
  hid uuid;
  lid uuid;
  iid uuid;
  ok  boolean;
begin
  insert into public.households (name, join_code, created_by)
  select 'MIGRATION SELF TEST', 'ZZTEST', u.id
  from auth.users u
  limit 1
  returning id into hid;

  if hid is null then
    raise notice 'No auth users yet — skipping the UPDATE self-test.';
    return;
  end if;

  insert into public.lists (household_id, name) values (hid, 'selftest') returning id into lid;
  insert into public.items (list_id, name) values (lid, 'selftest') returning id into iid;

  update public.items set checked = true where id = iid;
  select checked into ok from public.items where id = iid;

  if ok is not true then
    raise exception 'FAIL: UPDATE on public.items did not take effect';
  end if;

  -- And the guard itself still bites.
  begin
    update public.lists set household_id = gen_random_uuid() where id = lid;
    raise exception 'FAIL: lists.household_id is no longer immutable';
  exception when others then
    if sqlerrm <> 'LIST_HOUSEHOLD_IMMUTABLE' then raise; end if;
  end;

  delete from public.households where id = hid;

  raise notice 'PASS  items UPDATE works and re-parenting is still blocked';
end;
$$;
