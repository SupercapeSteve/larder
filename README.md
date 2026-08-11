# Larder

A realtime, multi-user, household-scoped grocery list. Installable as a PWA on iOS and
Android, controllable by voice through Apple Shortcuts and Siri. No App Store, no server
to run, no hosting bill.

Two people in different aisles see each other's edits in under a second, with correct
attribution, without refreshing.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  iPhone (PWA, standalone)          Android / desktop (PWA or browser)    │
│  ┌────────────────────────┐        ┌────────────────────────┐            │
│  │ React 18 + Vite 6      │        │ React 18 + Vite 6      │            │
│  │ TanStack Query cache   │        │ TanStack Query cache   │            │
│  │ service worker (shell) │        │ service worker (shell) │            │
│  └───────────┬────────────┘        └───────────┬────────────┘            │
└──────────────┼──────────────────────────────────┼────────────────────────┘
               │ publishable key only             │
               │ (RLS is the authorisation)       │
               ▼                                  ▼
      ┌──────────────────────────────────────────────────────┐
      │                     S U P A B A S E                  │
      │                                                      │
      │   PostgREST  ──►  Postgres + Row Level Security       │
      │       ▲              │                               │
      │       │              ├─ SECURITY DEFINER helpers      │
      │       │              │    (break the RLS recursion)   │
      │       │              ├─ RPCs: create_household,       │
      │       │              │    join_household_by_code,     │
      │       │              │    leave_household             │
      │       │              └─ triggers: profile, updated_at,│
      │       │                   attribution, reparent guard,│
      │       │                   member-removal cleanup      │
      │       │                                              │
      │   Realtime  ◄── WAL ──┘  items only, REPLICA IDENTITY │
      │       │                  FULL, filtered by list_id    │
      │       │                                              │
      │   Edge Function /siri  (service_role, verify_jwt off) │
      └───────────────────────────▲──────────────────────────┘
                                  │ Bearer larder_<32 hex>
                                  │
                        ┌─────────┴─────────┐
                        │  Apple Shortcuts  │
                        │       / Siri      │
                        └───────────────────┘
```

**The security model in one sentence:** the browser holds only the publishable key, so
every read and write is filtered by Row Level Security; the Siri endpoint holds the
service role, which bypasses RLS entirely, so *it* re-checks membership by hand on every
call and treats the token's `list_id` as the authorisation boundary.

### Why some things are the way they are

| Decision | Reason |
| --- | --- |
| Password auth, never magic links | A magic link opens in Safari on iOS. The session lands in a different storage container from the installed home-screen app, and the user appears permanently signed out. |
| `flowType: 'implicit'` | PKCE stores its verifier in the browser that *started* the flow. A reset email opened in Safari, when the flow began in the PWA, has no verifier. Implicit puts tokens in the fragment and works anywhere. There is no OAuth here, so nothing is lost. |
| `SECURITY DEFINER` helpers | A policy on `household_members` that queries `household_members` recurses: `ERROR 42P17: infinite recursion detected in policy`. Definer functions bypass RLS internally and break the cycle. |
| `REPLICA IDENTITY FULL` on `items` | Realtime only honours filters on non-primary-key columns when it is set, and INSERT/UPDATE are filtered on `list_id`. It does **not** make DELETE payloads complete — see below. |
| DELETE subscribed unfiltered | With RLS enabled, Supabase reduces a DELETE's old record to its primary key, because deletes are broadcast without a per-row policy check. `list_id` is therefore absent, a `list_id` filter can never match, and the event is never delivered — deletes appear only after a manual refresh. The client subscribes to DELETE separately, unfiltered, and reconciles by id. |
| Client-generated item UUIDs | The optimistic row and the realtime echo share an id, so the echo *replaces* the optimistic row instead of appearing beside it. No double-render flicker. |
| Reconcile on `visibilitychange` | iOS suspends WebSockets when the app backgrounds and drops everything that happened meanwhile. Without this you background the app in the car park and shop from a stale list. |
| No client `INSERT` on `household_members` | Its policy could not constrain `household_id`, so possession of a household UUID would equal membership — making the join code decorative and removal unenforceable. Joining goes through the definer RPC, which is the only code that checks a code. |

---

## Environment

Create `.env.local` in the project root:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both names must keep the `VITE_` prefix — Vite only exposes prefixed variables to the
client, and anything else is silently `undefined` at build time. Restart the dev server
after editing; Vite reads the file once at startup. If either is missing the app renders
an explanation instead of a blank page.

`.env.local` is gitignored. No secret or service-role key appears anywhere under `src/` —
the edge function reads `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env` at runtime, where
Supabase injects it automatically. Do not try to set it with `supabase secrets set`; the
`SUPABASE_` prefix is reserved and the command will reject it.

---

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run icons
```

`npm run icons` regenerates every PWA icon from one inline SVG in
`scripts/generate-icons.mjs`, including the 180×180 `apple-touch-icon` — without which
iOS uses a screenshot of the page as the home-screen icon.

---

## Deploy — run these in order

PowerShell note: these are separate invocations. `&&` is not a valid statement separator
in Windows PowerShell 5.1.

### 1. Push the schema

```bash
supabase db push
```

Applies `supabase/migrations/20260810000000_larder_init.sql`. The migration asserts its
own realtime wiring at the end and aborts loudly if `items` is not in the
`supabase_realtime` publication or lacks `REPLICA IDENTITY FULL`.

### 2. Prove RLS actually holds

Paste `supabase/tests/rls.sql` into the Supabase SQL Editor and run it, or:

```bash
psql "$DATABASE_URL" -f supabase/tests/rls.sql
```

It runs inside a transaction and rolls back, leaving no fixtures. Every assertion raises
on failure, so it either prints `ALL RLS ASSERTIONS PASSED` or aborts naming the broken
policy. **Run it before trusting the deployment** — it is the only thing standing between
you and a list that leaks between households.

### 3. Deploy the Siri endpoint

```bash
supabase functions deploy siri --no-verify-jwt
```

The `--no-verify-jwt` flag *and* the `[functions.siri] verify_jwt = false` entry in
`supabase/config.toml` are both needed. Siri sends a `larder_…` token, not a Supabase
JWT; with verification on, the platform rejects the request before the function runs and
every Shortcut invocation returns an opaque 401.

No `supabase secrets set` step is required — the function reads only `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, both injected by the platform.

### 4. Set the auth redirect URL

In the Supabase dashboard → Authentication → URL Configuration, add your production
origin and `https://<your-domain>/update-password` to the redirect allow-list, or
password reset links will bounce.

### 5. Ship the frontend

```bash
git push
```

Import the repo in Vercel, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
as environment variables, and deploy. `vercel.json` contains the SPA rewrite — without
it, a hard refresh on `/h/<id>` 404s.

### 6. Keep the project awake

Add two repository secrets in GitHub (Settings → Secrets and variables → Actions):

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

`.github/workflows/keepalive.yml` then pings `public.keepalive()` daily, so the free tier
does not auto-pause after seven idle days.

---

## Install on a phone

**Install first, then sign in.** On iOS the home-screen app and Safari keep separate
storage, so a session created in Safari does not carry across. Signing in inside the
installed app avoids ever noticing that.

1. Open the deployed URL in **Safari** (iOS) or **Chrome** (Android).
2. iOS: Share → **Add to Home Screen**. Android: menu → **Install app**.
3. Open Larder from the home screen.
4. Create an account, then create a household or join one with a six-character code.

The app shows the iOS instructions by itself, once, to Safari users who are not already
in standalone mode — Apple provides no `beforeinstallprompt`, so that prompt has to be
built by hand.

---

## Siri setup

Settings → **Siri & Shortcuts** inside the app generates a token and shows the setup
steps with your real endpoint URL filled in. In short:

1. Shortcuts → new shortcut → **Get Contents of URL**
2. URL: `https://<project-ref>.supabase.co/functions/v1/siri`
3. Method `POST`
4. Headers: `Authorization: Bearer larder_…` and `Content-Type: application/json`
5. Body (JSON): `action` = `add`, `text` = a *Dictated Text* or *Ask Each Time* variable
6. **Get Dictionary Value** for key `spoken` → **Speak Text**
7. Name it something you would actually say — that phrase becomes the Siri trigger

### Endpoint contract

| Request | Response |
| --- | --- |
| `{"action":"add","text":"milk, eggs, and two loaves of bread"}` | `{"ok":true,"spoken":"Added 3 items: milk, eggs, and 2 loaves of bread.","added":[…]}` |
| `{"action":"read"}` | `{"ok":true,"spoken":"You have 4 items: milk, eggs, bread, and butter.","items":[…]}` |
| `{"action":"check","text":"milk"}` | `{"ok":true,"spoken":"Checked off milk."}` |

Every response is HTTP 200, including failures — a non-200 makes Shortcuts throw its own
opaque error instead of speaking the explanation. Failure is `ok: false` plus a spoken
sentence. The plaintext token is shown exactly once at generation and only its SHA-256
hash is ever stored.

---

## Home screen widget (iOS)

iOS gives web apps **no widget API** — WidgetKit requires a native app extension, so a
PWA cannot ship a home screen widget at all. The workaround is
[Scriptable](https://apps.apple.com/us/app/scriptable/id1405459188), which renders real
WidgetKit widgets from JavaScript. `scripts/larder-widget.js` is that widget, and it reads
the list through the same `/siri` endpoint, so there is nothing extra to deploy.

1. Install **Scriptable** (free, App Store)
2. In Larder: Household settings → **Siri & Shortcuts** → generate a token and copy it
3. Scriptable → **+** → paste the contents of `scripts/larder-widget.js` → name it `Larder`
4. Replace the `TOKEN` line at the top with your token
5. Home Screen → long-press → **+** → **Scriptable** → choose a size
6. Long-press the placed widget → **Edit Widget** → Script: `Larder`

| Size | Shows |
| --- | --- |
| Small | Item count and the first four |
| Medium | Six items with aisle icons |
| Large | Grouped by aisle, up to fourteen |

Tapping it opens the app. It caches the last successful response, so a refresh with no
signal shows the previous list marked `· offline` rather than an error. iOS decides when
widgets refresh — `refreshAfterDate` is a hint, not a schedule, so expect minutes of lag
rather than the sub-second sync you get inside the app.

## Project layout

```
src/
  lib/          supabase client, env guard, auth, parsing, categories, sync
  hooks/        auth, households, items, api tokens, realtime
  components/   shell, rows, sheets, toasts, boundaries
  routes/       one file per screen
  types/        database types (mirrors the migration)
supabase/
  migrations/   the schema, RLS, triggers, RPCs, realtime wiring
  functions/    the Siri edge function (Deno)
  tests/        rls.sql — the isolation proof
scripts/        icon generation
```

---

## Known limits

- **Join codes are permanent and shared.** Six characters from a 31-character alphabet is
  ~8.9×10⁸ combinations, and `join_household_by_code` has no rate limit, so an
  authenticated attacker can grind against it. This is the data model the project
  specifies — a code you read aloud over the phone. If that trade stops being acceptable,
  the fix is single-use expiring invites, not a longer code.
- **Offline is read-only.** The service worker caches the app shell so Larder opens
  without signal, but mutations are not queued — an offline banner says so rather than
  pretending the tap worked.
- **Last write wins.** Two people editing the same item in the same second: one of them
  loses. For a grocery list that is the correct amount of machinery.
- **Undo re-attributes.** `added_by` and `checked_by` are set by the database from the
  JWT and ignore whatever the client sends — that is what stops one member forging a
  check-off in another's name. The side effect is that undoing a delete of somebody
  else's item credits it to whoever pressed Undo.
