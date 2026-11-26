-- ═══════════════════════════════════════════════════════════════════════════
--  LARDER — fix `permission denied for table sublist_items` on PostgREST upsert
--  Authored by Carbon (Gemini 4 Carbon).
--
--  Why adding an item into a sub-list failed with 42501 ("You don't have
--  permission to do that"):
--
--    PostgREST translates `.from('sublist_items').upsert(...)` into
--      INSERT INTO public.sublist_items (...) VALUES (...)
--      ON CONFLICT (sublist_id, item_id) DO UPDATE SET ...
--
--    PostgreSQL checks table-level UPDATE privilege and UPDATE RLS policies at
--    plan/execution time for any `INSERT ... ON CONFLICT DO UPDATE`, even when
--    no conflict occurs and zero rows are updated. Migration 20261126000000
--    granted only `SELECT, INSERT, DELETE` on `sublist_items`, so every client
--    upsert was rejected with 42501 before touching a row.
--
--    Granting UPDATE alongside `sublist_items_update_editor` (while keeping the
--    `enforce_sublist_item_integrity` BEFORE UPDATE trigger that forbids
--    changing `sublist_id`, `item_id` or `list_id`) makes idempotent upserts
--    succeed for editors while remaining read-only for viewers.
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists sublist_items_update_editor on public.sublist_items;
create policy sublist_items_update_editor on public.sublist_items
  for update to authenticated
  using (public.can_edit_list(list_id))
  with check (public.can_edit_list(list_id));

grant update on public.sublist_items to authenticated;
grant update on public.sublist_items to service_role;

-- ── Self-test ──────────────────────────────────────────────────────────────
do $$
declare
  n int;
begin
  if not has_table_privilege('authenticated', 'public.sublist_items', 'UPDATE') then
    raise exception 'FAIL: authenticated still lacks UPDATE on public.sublist_items';
  end if;

  select count(*) into n from pg_policies
  where schemaname = 'public' and tablename = 'sublist_items';
  if n <> 4 then
    raise exception 'FAIL: expected 4 policies on sublist_items, found %', n;
  end if;

  raise notice 'PASS  sublist_items UPDATE grant and editor policy active';
end;
$$;
