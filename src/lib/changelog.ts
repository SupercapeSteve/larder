/**
 * Release history and What's New notes for Larder.
 *
 * `CURRENT_VERSION` drives the one-time "What's new" sheet: when a user's
 * browser refreshes onto a version newer than `larder.lastSeenVersion`, they get
 * a quick, easily dismissible summary of what changed, and every past release
 * remains readable from Settings → Patch notes.
 */

export const CURRENT_VERSION = '1.2.1'
export const LAST_SEEN_VERSION_KEY = 'lastSeenVersion'

export type ReleaseNote = {
  version: string
  date: string
  title: string
  summary: string
  highlights: readonly string[]
}

export const PATCH_NOTES: readonly ReleaseNote[] = [
  {
    version: '1.2.1',
    date: 'November 2026',
    title: 'Your avatar in the header, live updates & patch notes',
    summary:
      'Personalised top-bar profile button, automatic background version updates, and a full changelog in Settings.',
    highlights: [
      'Your chosen profile photo, emoji or colour avatar now appears right in the top bar — alongside your name on computers with the screen room for it.',
      'Automatic app updates: open tabs and installed home-screen apps now detect new Larder releases and refresh onto the latest version automatically.',
      'Quick "What’s new" card after an update, plus a full Patch notes archive in Settings.',
      'Atomic sub-list creation and cleaner inline dish labels ("for 🌮 Nachos") on main-list items.',
    ],
  },
  {
    version: '1.2.0',
    date: 'November 2026',
    title: 'Sub-lists for recipes & universal screen fit',
    summary:
      'Plan ingredients for specific dinners or trips while keeping your main grocery list sorted by aisle.',
    highlights: [
      'Sub-lists & dishes: create a sub-list (like Taco night or Pasta Carbonara), pick items already on your main list or batch-add recipe ingredients, and filter down to see just what that dish needs.',
      'Shared ingredients stay in sync: checking off an ingredient in a sub-list checks it off on the main list too, and "Shop again" unchecks a favourite meal in one tap.',
      'Fits every device aspect ratio — from compact phones and short landscape screens to multi-column widescreen desktops and tablets.',
      'Offline outbox expanded to cover item edits and clearing checked items, plus authenticated push nudges when housemates add to the list.',
    ],
  },
  {
    version: '1.1.0',
    date: 'August 2026',
    title: 'Offline queue, Buy again, learned aisles & push',
    summary:
      'Built for supermarket dead zones and repeat weekly shops.',
    highlights: [
      'Durable offline queue: adding, checking off or deleting items with no signal saves locally and replays in order once you reconnect.',
      'Buy again: ticked-off regulars are remembered so you can re-add household staples in one tap.',
      'Learned aisle rules: move an item to a different aisle once and Larder files it there automatically next time.',
      'Optional Web Push notifications for installed PWAs, instant list search, account-synced appearance preferences, and one-click JSON data export.',
    ],
  },
  {
    version: '1.0.0',
    date: 'August 2026',
    title: 'Realtime household grocery list',
    summary:
      'Two people in different aisles see each other’s edits in under a second.',
    highlights: [
      'Live multi-user sync with who-added and who-checked attribution.',
      '16 supermarket aisles in walking order, with natural quantity parsing ("2 loaves of bread", "500g flour").',
      'Siri & Apple Shortcuts voice support plus an iOS home-screen widget via Scriptable.',
      'Six-character household invite codes, custom photo & emoji avatars, 10 accent colours, and Owner / Admin / Member / Viewer roles.',
    ],
  },
]
