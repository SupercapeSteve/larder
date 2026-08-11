// ═══════════════════════════════════════════════════════════════════════════
//  LARDER — iOS home screen widget
//
//  iOS gives web apps no widget API, so this runs in Scriptable, which renders
//  real WidgetKit widgets from JavaScript. It reads your list through the same
//  endpoint Siri uses, so there is nothing new to deploy.
//
//  SETUP
//    1. Install Scriptable from the App Store (free).
//    2. Larder → Household settings → Siri & Shortcuts → generate a token.
//       Copy it — it is shown once.
//    3. Scriptable → + → paste this whole file → name it "Larder".
//    4. Put your token in TOKEN below.
//    5. Home Screen → long-press → + → Scriptable → pick a size.
//    6. Long-press the new widget → Edit Widget → Script: "Larder".
//       Set "When Interacting" to "Run Script" so tapping opens your list.
//
//  Small  — count plus the first few items
//  Medium — a single column, more items
//  Large  — grouped by aisle
// ═══════════════════════════════════════════════════════════════════════════

// ── Configure ──────────────────────────────────────────────────────────────
const TOKEN = 'larder_PASTE_YOUR_TOKEN_HERE'
const ENDPOINT = 'https://hysfurwkmedolzzeabdv.supabase.co/functions/v1/siri'
const APP_URL = 'https://larder-topaz.vercel.app'

// ── Appearance ─────────────────────────────────────────────────────────────
const BG = Color.dynamic(new Color('#f2f8f4'), new Color('#0e2117'))
const CARD = Color.dynamic(new Color('#ffffff'), new Color('#1d3b2b'))
const TEXT = Color.dynamic(new Color('#0e2117'), new Color('#f2f8f4'))
const MUTED = Color.dynamic(new Color('#418a5e'), new Color('#96c7a7'))
const ACCENT = Color.dynamic(new Color('#2f6e49'), new Color('#63a87d'))

const CATEGORY_EMOJI = {
  Produce: '🥬',
  Bakery: '🥖',
  Deli: '🧆',
  Dairy: '🧀',
  Meat: '🥩',
  Seafood: '🐟',
  Frozen: '🧊',
  Pantry: '🥫',
  Snacks: '🍫',
  Drinks: '🧃',
  Alcohol: '🍷',
  Health: '💊',
  Baby: '🍼',
  Pets: '🐾',
  Household: '🧼',
  Other: '🛒',
}

const CATEGORY_ORDER = [
  'Produce', 'Bakery', 'Deli', 'Dairy', 'Meat', 'Seafood', 'Frozen',
  'Pantry', 'Snacks', 'Drinks', 'Alcohol', 'Health', 'Baby', 'Pets',
  'Household', 'Other',
]

// ── Cache ──────────────────────────────────────────────────────────────────
// Widgets get refreshed by iOS on its own schedule and often with no network.
// Showing the last known list beats showing an error.
const fm = FileManager.local()
const CACHE_PATH = fm.joinPath(fm.cacheDirectory(), 'larder-widget-cache.json')

function readCache() {
  try {
    if (!fm.fileExists(CACHE_PATH)) return null
    return JSON.parse(fm.readString(CACHE_PATH))
  } catch (e) {
    return null
  }
}

function writeCache(payload) {
  try {
    fm.writeString(CACHE_PATH, JSON.stringify(payload))
  } catch (e) {
    // Cache is a nicety, never a requirement.
  }
}

// ── Fetch ──────────────────────────────────────────────────────────────────
async function fetchList() {
  const request = new Request(ENDPOINT)
  request.method = 'POST'
  request.headers = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  }
  request.body = JSON.stringify({ action: 'read' })
  request.timeoutInterval = 15

  const response = await request.loadJSON()

  // The endpoint always answers 200 and signals failure in the body, so that
  // Shortcuts can speak the reason. Same contract applies here.
  if (!response || response.ok !== true) {
    throw new Error(response && response.spoken ? response.spoken : 'Larder did not respond.')
  }

  const items = Array.isArray(response.items) ? response.items : []
  const payload = { items, fetchedAt: Date.now() }
  writeCache(payload)
  return payload
}

// ── Rendering ──────────────────────────────────────────────────────────────
function header(widget, count, stale) {
  const row = widget.addStack()
  row.centerAlignContent()

  const title = row.addText('🧺 Larder')
  title.font = Font.semiboldSystemFont(13)
  title.textColor = ACCENT

  row.addSpacer()

  const badge = row.addText(stale ? '· offline' : String(count))
  badge.font = Font.semiboldSystemFont(13)
  badge.textColor = MUTED
}

function itemLine(stack, item, showEmoji) {
  const row = stack.addStack()
  row.centerAlignContent()
  row.spacing = 4

  if (showEmoji) {
    const emoji = row.addText(CATEGORY_EMOJI[item.category] || '🛒')
    emoji.font = Font.systemFont(11)
  }

  const label = row.addText(item.name)
  label.font = Font.systemFont(13)
  label.textColor = TEXT
  label.lineLimit = 1

  if (item.quantity) {
    row.addSpacer(4)
    const qty = row.addText(String(item.quantity))
    qty.font = Font.mediumSystemFont(11)
    qty.textColor = MUTED
    qty.lineLimit = 1
  }
  row.addSpacer()
}

function emptyState(widget) {
  widget.addSpacer()
  const done = widget.addText('Nothing to get')
  done.font = Font.semiboldSystemFont(15)
  done.textColor = TEXT
  const sub = widget.addText('The list is empty.')
  sub.font = Font.systemFont(12)
  sub.textColor = MUTED
  widget.addSpacer()
}

function buildWidget(payload, stale) {
  const family = config.widgetFamily || 'medium'
  const items = payload.items

  const widget = new ListWidget()
  widget.backgroundColor = BG
  widget.setPadding(14, 14, 14, 14)
  widget.url = APP_URL
  // A request, not a schedule. iOS budgets widgets to roughly 40–70 reloads a
  // day (about every 15–60 min) and expects timeline entries no closer than
  // 5 minutes apart, so 5 is the strongest honest hint we can give. Asking for
  // less does not buy more refreshes — it just lets iOS pick sooner when it
  // has budget to spare.
  widget.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000)

  header(widget, items.length, stale)
  widget.addSpacer(8)

  if (items.length === 0) {
    emptyState(widget)
    return widget
  }

  const limits = { small: 4, medium: 6, large: 14 }
  const limit = limits[family] || 6

  if (family === 'large') {
    // Grouped by aisle, in the order you walk a shop.
    const groups = new Map()
    for (const item of items) {
      const key = CATEGORY_ORDER.includes(item.category) ? item.category : 'Other'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }

    const ordered = CATEGORY_ORDER.filter((c) => groups.has(c))
    let shown = 0

    for (const category of ordered) {
      if (shown >= limit) break

      const heading = widget.addText(`${CATEGORY_EMOJI[category]}  ${category}`)
      heading.font = Font.semiboldSystemFont(11)
      heading.textColor = MUTED
      widget.addSpacer(3)

      for (const item of groups.get(category)) {
        if (shown >= limit) break
        itemLine(widget, item, false)
        shown += 1
      }
      widget.addSpacer(7)
    }

    if (items.length > shown) {
      const more = widget.addText(`+${items.length - shown} more`)
      more.font = Font.systemFont(11)
      more.textColor = MUTED
    }
  } else {
    const shown = items.slice(0, limit)
    for (const item of shown) {
      itemLine(widget, item, family !== 'small')
      widget.addSpacer(4)
    }
    if (items.length > shown.length) {
      const more = widget.addText(`+${items.length - shown.length} more`)
      more.font = Font.systemFont(11)
      more.textColor = MUTED
    }
  }

  widget.addSpacer()
  stamp(widget, payload.fetchedAt)
  return widget
}

// Since iOS decides when this reloads, say plainly how old the data is. A
// visible timestamp turns "is this stale?" from a guess into a fact.
function stamp(widget, fetchedAt) {
  if (!fetchedAt) return
  const when = new Date(fetchedAt)
  const hh = String(when.getHours()).padStart(2, '0')
  const mm = String(when.getMinutes()).padStart(2, '0')
  const line = widget.addText(`updated ${hh}:${mm}`)
  line.font = Font.systemFont(9)
  line.textColor = MUTED
}

function errorWidget(message) {
  const widget = new ListWidget()
  widget.backgroundColor = BG
  widget.setPadding(14, 14, 14, 14)
  widget.url = APP_URL

  const title = widget.addText('🧺 Larder')
  title.font = Font.semiboldSystemFont(13)
  title.textColor = ACCENT
  widget.addSpacer(8)

  const body = widget.addText(message)
  body.font = Font.systemFont(12)
  body.textColor = TEXT
  body.lineLimit = 4

  widget.addSpacer()
  return widget
}

// ── Run ────────────────────────────────────────────────────────────────────
let widget

if (TOKEN.indexOf('PASTE_YOUR_TOKEN') !== -1) {
  widget = errorWidget('Add your token to the TOKEN line at the top of this script.')
} else {
  try {
    const payload = await fetchList()
    widget = buildWidget(payload, false)
  } catch (error) {
    const cached = readCache()
    if (cached) {
      // Better a slightly old list than an error card.
      widget = buildWidget(cached, true)
    } else {
      widget = errorWidget(String(error.message || error))
    }
  }
}

if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  // Tapping the script in the app previews it, which is how you debug setup.
  await widget.presentMedium()
}

Script.complete()
