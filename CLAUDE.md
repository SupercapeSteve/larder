# CLAUDE.md — Project Guide & Agent Handoff Log

This repository is primarily architected and maintained by **Claude**, with contributions logged explicitly below so any future Claude session has complete continuity.

## Core Architectural Rules (Do Not Break)

1. **Publishable key only in `src/`** — Row Level Security is the sole client authorisation boundary. Never reference a secret/service-role key in client code.
2. **`SECURITY DEFINER` helpers pin `set search_path = ''`** — Every policy touching `household_members` goes through a definer helper to prevent SQLSTATE `42P17` policy recursion, and every definer function revokes `EXECUTE` from `public, anon`.
3. **Realtime `DELETE` subscriptions are unfiltered** — With RLS enabled, Supabase strips `payload.old` on `DELETE` to primary-key columns only (`{ id }` on `items` / `sublists`; `{ sublist_id, item_id }` on `sublist_items`). Never attach a `list_id=eq.…` filter to a `DELETE` listener or deletes will silently stop arriving.
4. **Client-generated UUIDs + `itemSync` pending-write guard** — Optimistic rows and server echoes share the same UUID; `beginLocalWrite` / `endLocalWrite` suppress stale realtime echoes while a mutation is in flight.
5. **Password auth with `flowType: 'implicit'` and `detectSessionInUrl: false`** — Keeps iOS home-screen PWAs and Safari email links from stranding PKCE verifiers across separate storage containers.
6. **Self-testing SQL migrations + `supabase/tests/rls.sql`** — Every migration ends with an assertion `DO $$` block that aborts on broken invariants, and `supabase/tests/rls.sql` proves cross-household isolation inside a rolled-back transaction.
7. **Universal viewport / aspect-ratio fit** — Layouts use `100dvh`, `overflow-x: clip`, `my-auto` inside `scroll-y` containers (never bare `justify-center` on fixed-height flex parents, which clips above `scrollTop = 0` on short landscape screens), `safe-top`/`safe-bottom`/`safe-x`, and `orientation: 'any'` in manifests.

---

## Handoff Report: Carbon (Gemini 4 Carbon) → Claude — 2026-11-26

Hey Claude — **Carbon** (Gemini 4 Carbon) stepped in while your quota was resetting to audit the project for bugs, make every screen fit *any* device aspect ratio without exception, and build the **Sub-lists** (recipes / dinner plans) feature following your exact patterns. Every change is documented below so you know exactly what was touched and why.

### 1. Bugs Found & Fixed

- **Security / Push (`supabase/functions/notify/index.ts`, `supabase/config.toml`, `src/hooks/useItems.ts`, `supabase/functions/siri/index.ts`)**:
  - `notify/index.ts` previously ran on `service_role` with no caller authentication, trusted `body.actor_id` verbatim, and forwarded arbitrary `body.url` strings into `clients.openWindow()` in `src/sw.ts`. It was also never called anywhere in the app after `53fce9c`.
  - Fixed: `notify/index.ts` now authenticates the caller's Bearer JWT via `db.auth.getUser()` (or accepts `serviceRoleKey` strictly from `siri/index.ts`), derives `actorId` from the verified identity, checks that `actorId` holds `owner` / `admin` / `member` on `list.household_id` (blocking non-members and `viewer`s), caps `title`/`body`, and restricts `url` to same-origin relative paths (`safePath`). Wired fire-and-forget push nudges in `useAddItem` (when `VITE_VAPID_PUBLIC_KEY` is set) and Siri `handleAdd`.
- **Siri viewer write bypass (`supabase/functions/siri/index.ts`, `src/routes/SiriSettings.tsx`)**:
  - A `member` who minted a Siri token and was later demoted to `viewer` via `set_member_role` retained `add`/`check` access because `siri/index.ts` only checked membership existence (`select('user_id')`), not `role`.
  - Fixed: `siri/index.ts` now selects `user_id, role` and refuses `add`/`check` when `role === 'viewer'` while still allowing `read`. `SiriSettings.tsx` also gates the token-creation form on `can(role, 'useSiri')`.
- **Viewer UI affordances (`src/routes/ListScreen.tsx`, `src/components/ItemRow.tsx`)**:
  - Viewers could previously swipe-to-delete rows, long-press / tap `MoreHorizontal` to open `ItemEditSheet`, and click `Clear checked`, triggering optimistic edits against RLS.
  - Fixed: `canCheck` and `canEdit` are now passed into `ItemRow` and enforced on `onDelete`, `Clear checked`, swipe gestures, and edit triggers.
- **Cross-account shared-device leak on sign-out (`src/hooks/useAuth.tsx`)**:
  - Signing out cleared TanStack Query cache, but left `larder.lastHousehold` in `localStorage` and queued mutations in IndexedDB (`larder-outbox`), meaning a second user signing in on the same device could replay User A's offline outbox under User B's JWT.
  - Fixed: `SIGNED_OUT` and user-switch branches now call `removeLocal(LAST_HOUSEHOLD_KEY)` and `clearOutbox()`.
- **Offline outbox gaps & idle refetch (`src/lib/outbox.ts`, `src/hooks/useOutbox.tsx`, `src/hooks/useItems.ts`)**:
  - `useUpdateItem`, `useClearChecked`, and `useRestoreItems` previously failed immediately offline instead of queueing to IndexedDB, and `OutboxProvider.flush()` invalidated `['items']` every 30s even when 0 entries were replayed.
  - Fixed: Added `delete-many` and sub-list ops to `OutboxOp`, wired offline queueing across all item and sub-list mutations, and gated cache invalidation on `sentAny`.
- **Search filter vs duplicate & clear-checked scope (`src/routes/ListScreen.tsx`)**:
  - Duplicate check on `onAdd` previously searched `items` (search-filtered) rather than `allItems`, creating duplicates if a search term was active. `Clear checked` also acted on search-filtered `items` despite the comment on line 100 stating search never narrows what is counted or cleared.
  - Fixed: Duplicate checks inspect `allItems`, and `checkedInScope` / `outstanding` operate on `scopedItems` (either the full main list or the active sub-list, unaffected by search text).
- **Missing RPC / PostgREST error mappings (`src/lib/authErrors.ts`)**:
  - Added human-readable messages for `TOO_MANY_ATTEMPTS` (from `20260818000000`), `PGRST116` (0-row `.single()` when RLS refuses or a row was concurrently deleted), and the new `SUBLIST_*` trigger sentinels; updated `NOT_OWNER` wording to reflect admin capabilities.
- **UTF-8 mojibake & stale copy (`src/routes/ListScreen.tsx`, `src/routes/HouseholdDetail.tsx`, `src/routes/Account.tsx`, `src/components/AccentPicker.tsx`, `README.md`)**:
  - Repaired garbled UTF-8 punctuation (`â€”`, `â€™`, `Â·`, `â”€`) in `ListScreen.tsx` and `HouseholdDetail.tsx`.
  - Updated stale `"Applies on this device only"` / `"Saved on this device"` / `"Owners only"` / `"Offline is read-only"` copy to match actual behaviour.

### 2. Universal Aspect-Ratio Fit (Any Device, No Exceptions)

- **PWA rotation unlocked (`vite.config.ts`, `scripts/generate-icons.mjs`, `public/icons/*/manifest.webmanifest`)**: Changed `"orientation": "portrait"` → `"orientation": "any"` so installed PWAs on tablets, foldables, ChromeOS, and landscape phones are never portrait-locked.
- **Non-overlapping top banner (`src/App.tsx`, `src/components/OfflineBanner.tsx`, `src/index.css`)**: Moved `OfflineBanner` from `fixed top-0` (where it covered `AppShell`'s sticky header) into normal flex-column flow above `<Routes>`, coordinating `data-top-banner` so safe-area top padding is never doubled.
- **Short landscape & keyboard-open viewports (`src/index.css`, `src/components/AuthLayout.tsx`, `src/components/ImageCropper.tsx`, `src/components/ConfirmDialog.tsx`, `src/components/StaplesSheet.tsx`, `src/components/RoleSheet.tsx`, `src/components/Toast.tsx`, `src/components/AddItemBar.tsx`)**:
  - Replaced `justify-center` on fixed-height flex containers (`AuthLayout`, `ErrorState`, `ConfigError`, `ErrorBoundary`, `NotFound`) with `scroll-y` + `my-auto` so overflowing forms never clip above `scrollTop = 0`.
  - Converted all modals/sheets to `max-h-[calc(100dvh-...)]` + `scroll-y` + `safe-x` (including `ConfirmDialog` and `ImageCropper`, which previously had no height cap or scroll). Constrained `ImageCropper`'s square frame with `calc(100dvh - 15.5rem)` so zoom and confirm controls stay visible on landscape phones.
  - Moved `"Buy again"` inline with `AddItemBar` as `leadingAction` and added `@media (max-height: 460px)` compact chrome rules.
  - Positioned `Toast` above both the sticky footer and `useKeyboardInset()`.
- **Ultra-narrow (`< 320px`) & widescreen (`16:9` / `21:9` / `32:9`) viewports**:
  - Added `overflow-x: clip` on `html, body, #root`, responsive grids on `AvatarPicker` (`grid-cols-4 min-[320px]:grid-cols-6 sm:grid-cols-8`) and `Aisles` (`grid-cols-1 min-[300px]:grid-cols-2 sm:grid-cols-3`), and wrapping on invite codes, Siri token inputs, and attribution badges.
  - Expanded `AppShell` on wide screens (`lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl` when `wide`), flowing aisle cards into `lg:columns-2 2xl:columns-3` with `break-inside-avoid` on `ListScreen`, and 2-column layouts on `HouseholdDetail` and `Account`.

### 3. Sub-lists Feature (Recipes, Dishes & Meal Plans)

- **Schema (`supabase/migrations/20261126000000_sublists_and_fixes.sql`, `supabase/migrations/20261126010000_fix_sublist_items_upsert_grant.sql`, `supabase/tests/rls.sql`, `src/types/database.ts`)**:
  - Added `public.sublists` (`id`, `list_id`, `name`, `emoji`, `note`, `sort_order`, `created_by`, `created_at`, `updated_at`) and join table `public.sublist_items` (`sublist_id`, `item_id`, `list_id`, `created_at`, PK `(sublist_id, item_id)`).
  - Follow-up migration `20261126010000` granted `UPDATE` + `sublist_items_update_editor` policy on `sublist_items` (required by PostgreSQL whenever PostgREST translates `.upsert()` into `INSERT ... ON CONFLICT DO UPDATE`, even on conflict-free inserts), sequenced `items` → `sublist_items` inserts in `useAddItem`, and made `useCreateSublist` atomically populate cache at `0ms` while committing `sublists` → `items` → `sublist_items` sequentially in one mutation.
  - Clarified sub-list vs ingredient UX: sub-lists never insert themselves as item rows; main-list rows render understated `· for 🌮 Dish` inline metadata (matching `· via Siri`), `AddItemBar` guards against accidentally typing the active sub-list's own name as an item, and `src/main.tsx` reloads cleanly on `controllerchange` when idle so open tabs adopt fresh service-worker bundles immediately.
  - Many-to-many join table ensures two dishes in the same week can share an ingredient (e.g. garlic) while remaining a single row on the main list, and deleting a sub-list cascades only `sublist_items` so items stay safely on the main list.
  - Enforced cross-list integrity via `enforce_sublist_item_integrity()`, `FORBID_SUBLIST_REPARENT`, `FORCE ROW LEVEL SECURITY`, `REPLICA IDENTITY FULL`, `supabase_realtime` publication, `export_my_data()` coverage, migration self-tests, and expanded `supabase/tests/rls.sql` (now asserting all 12 public tables).
- **Client (`src/lib/sublists.ts`, `src/hooks/useSublists.ts`, `src/hooks/useRealtimeItems.ts`, `src/components/SublistSheet.tsx`, `src/components/ItemEditSheet.tsx`, `src/components/ItemRow.tsx`, `src/routes/ListScreen.tsx`)**:
  - Auto-suggests dish emojis from names (`"Taco night"` → `🌮`, `"Carbonara"` → `🍝`, etc.), supports batch comma/line-separated recipe entry, linking existing main-list items, `"Shop again"` (1-tap uncheck for recurring meals), sub-list badges on main-list rows, Undo restoration of sub-list links on item delete/clear, and graceful `localStorage` fallback if the frontend runs before `supabase db push`.

### 4. Deployment Notes for Next Push

1. `supabase db push` (applies `20261126000000_sublists_and_fixes.sql`).
2. Run `supabase/tests/rls.sql` to verify `ALL RLS ASSERTIONS PASSED` across all 12 tables.
3. `supabase functions deploy siri --no-verify-jwt` and `supabase functions deploy notify --no-verify-jwt`.
