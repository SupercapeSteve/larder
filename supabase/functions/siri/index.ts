/**
 * Larder — Siri / Apple Shortcuts endpoint.
 *
 *   POST /functions/v1/siri
 *   Authorization: Bearer larder_<32 hex chars>
 *   Content-Type: application/json
 *
 *   { "action": "add",   "text": "milk, eggs, and two loaves of bread" }
 *   { "action": "read"  }
 *   { "action": "check", "text": "milk" }
 *
 * Design rules that are not negotiable here:
 *
 *  - Every response is HTTP 200, including failures. A non-200 makes Shortcuts
 *    throw its own opaque error instead of speaking the explanation, so the
 *    user hears nothing useful. Failure is signalled by `ok: false` plus a
 *    `spoken` sentence.
 *  - `spoken` is read aloud by Siri. It is ordinary English — never JSON, never
 *    an id, never "Successfully inserted 3 records".
 *  - The token is the authorisation boundary. This runs on the service role,
 *    which bypasses RLS entirely, so every query is scoped to the token's
 *    list_id by hand and membership is re-verified on each call.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

/* ── Types ────────────────────────────────────────────────────────────────── */

type Action = 'add' | 'read' | 'check'

type SiriRequest = {
  action: Action
  text?: string
}

type ItemRow = {
  id: string
  name: string
  quantity: string | null
  category: string | null
  checked: boolean
}

type TokenRow = {
  id: string
  user_id: string
  list_id: string
  revoked_at: string | null
}

/* ── CORS ─────────────────────────────────────────────────────────────────── */

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function speak(spoken: string, extra: Record<string, unknown> = {}, ok = true): Response {
  return new Response(JSON.stringify({ ok, spoken, ...extra }), {
    // Always 200. See the header comment.
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/* ── Parsing ──────────────────────────────────────────────────────────────── */

const SPELLED: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
  a: '1', an: '1', couple: '2', dozen: '12',
}

const UNITS = [
  'kg', 'kgs', 'g', 'gram', 'grams', 'lb', 'lbs', 'oz', 'l', 'litre', 'litres',
  'liter', 'liters', 'ml', 'cl', 'pack', 'packs', 'pk', 'punnet', 'punnets',
  'bunch', 'bunches', 'tin', 'tins', 'can', 'cans', 'jar', 'jars', 'box',
  'boxes', 'bottle', 'bottles', 'bag', 'bags', 'dozen', 'doz',
].join('|')

const NUMBER_WITH_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNITS})\\b\\s*(?:of\\s+)?`, 'i')
const BARE_NUMBER = /^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+/i
// Alternation order matters: `a dozen` must be tried before bare `a`, or
// "a dozen eggs" parses as one "dozen eggs". The bare article is included
// because dictation produces "a loaf of bread" constantly.
const SPELLED_LEADING = new RegExp(
  '^(?:half\\s+a\\s+dozen|(?:a|an)\\s+(?:couple|dozen)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an|a)\\b\\s*(?:of\\s+)?',
  'i',
)

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseItem(raw: string): { name: string; quantity: string | null } {
  const input = tidy(raw)
  if (input.length === 0) return { name: '', quantity: null }

  const withUnit = NUMBER_WITH_UNIT.exec(input)
  if (withUnit) {
    const rest = tidy(input.slice(withUnit[0].length))
    if (rest.length > 0) {
      const unit = withUnit[2].toLowerCase()
      const amount = withUnit[1].replace(',', '.')
      return { quantity: `${amount}${unit.length <= 2 ? '' : ' '}${unit}`, name: rest }
    }
  }

  const spelled = SPELLED_LEADING.exec(input)
  if (spelled) {
    const rest = tidy(input.slice(spelled[0].length))
    if (rest.length > 0) {
      const phrase = spelled[0].trim().toLowerCase()
      if (phrase === 'a' || phrase === 'an') return { quantity: null, name: rest }
      if (phrase.startsWith('half')) return { quantity: '6', name: rest }
      const words = phrase.replace(/\s+of$/, '').split(/\s+/)
      return { quantity: SPELLED[words[words.length - 1]] ?? '1', name: rest }
    }
  }

  const bare = BARE_NUMBER.exec(input)
  if (bare) {
    const rest = tidy(input.slice(bare[0].length))
    if (rest.length > 0) return { quantity: bare[1].replace(',', '.'), name: rest }
  }

  return { quantity: null, name: input }
}

/** "milk, eggs, and two loaves of bread" → three phrases. */
function splitPhrases(raw: string): string[] {
  return raw
    .split(/\r?\n|,|;|\band\b|&|\+/i)
    .map(tidy)
    .filter((part) => part.length > 0)
}

/* ── Categories (mirrors src/lib/categories.ts) ───────────────────────────── */

// Mirrors src/lib/categories.ts. Kept as a flat list rather than imported
// because this runs in Deno with no access to the app bundle. Sorted
// longest-first at module load so "sweet potato" beats "potato" and
// "cat food" beats "food" without hand-ordering the table.
const KEYWORDS: Array<[string, string]> = [
  // Produce
  ['sweet potato', 'Produce'], ['spring onion', 'Produce'], ['potato', 'Produce'],
  ['tomato', 'Produce'], ['banana', 'Produce'], ['lettuce', 'Produce'], ['carrot', 'Produce'],
  ['spinach', 'Produce'], ['broccoli', 'Produce'], ['onion', 'Produce'], ['apple', 'Produce'],
  ['salad', 'Produce'], ['lemon', 'Produce'], ['lime', 'Produce'], ['fruit', 'Produce'],
  ['pepper', 'Produce'], ['garlic', 'Produce'], ['avocado', 'Produce'], ['cucumber', 'Produce'],
  ['mushroom', 'Produce'], ['courgette', 'Produce'], ['cabbage', 'Produce'], ['grape', 'Produce'],
  ['berries', 'Produce'], ['strawberr', 'Produce'], ['orange', 'Produce'], ['veg', 'Produce'],
  // Bakery
  ['sourdough', 'Bakery'], ['croissant', 'Bakery'], ['baguette', 'Bakery'], ['loaves', 'Bakery'],
  ['bread', 'Bakery'], ['bagel', 'Bakery'], ['loaf', 'Bakery'], ['roll', 'Bakery'],
  ['cake', 'Bakery'], ['pastr', 'Bakery'], ['muffin', 'Bakery'], ['tortilla', 'Bakery'],
  ['crumpet', 'Bakery'], ['pitta', 'Bakery'],
  // Deli
  ['prosciutto', 'Deli'], ['charcuterie', 'Deli'], ['pepperoni', 'Deli'], ['chorizo', 'Deli'],
  ['hummus', 'Deli'], ['houmous', 'Deli'], ['salami', 'Deli'], ['olive', 'Deli'], ['deli', 'Deli'],
  ['coleslaw', 'Deli'], ['sushi', 'Deli'],
  // Dairy
  ['creme fraiche', 'Dairy'], ['mozzarella', 'Dairy'], ['parmesan', 'Dairy'],
  ['mascarpone', 'Dairy'], ['halloumi', 'Dairy'], ['oat milk', 'Dairy'], ['soy milk', 'Dairy'],
  ['yoghurt', 'Dairy'], ['yogurt', 'Dairy'], ['cheddar', 'Dairy'], ['ricotta', 'Dairy'],
  ['cheese', 'Dairy'], ['butter', 'Dairy'], ['cream', 'Dairy'], ['milk', 'Dairy'],
  ['egg', 'Dairy'], ['feta', 'Dairy'], ['brie', 'Dairy'],
  // Meat
  ['chicken', 'Meat'], ['sausage', 'Meat'], ['bacon', 'Meat'], ['mince', 'Meat'],
  ['steak', 'Meat'], ['beef', 'Meat'], ['pork', 'Meat'], ['lamb', 'Meat'], ['turkey', 'Meat'],
  ['gammon', 'Meat'], ['burger', 'Meat'], ['ham', 'Meat'], ['duck', 'Meat'], ['meat', 'Meat'],
  // Seafood
  ['seafood', 'Seafood'], ['mackerel', 'Seafood'], ['sardine', 'Seafood'], ['scallop', 'Seafood'],
  ['haddock', 'Seafood'], ['salmon', 'Seafood'], ['mussel', 'Seafood'], ['shrimp', 'Seafood'],
  ['oyster', 'Seafood'], ['prawn', 'Seafood'], ['trout', 'Seafood'], ['tuna', 'Seafood'],
  ['crab', 'Seafood'], ['cod', 'Seafood'], ['fish', 'Seafood'],
  // Frozen
  ['oven chips', 'Frozen'], ['ice cream', 'Frozen'], ['ice lolly', 'Frozen'],
  ['frozen', 'Frozen'], ['sorbet', 'Frozen'], ['gelato', 'Frozen'], ['peas', 'Frozen'],
  // Pantry
  ['peanut butter', 'Pantry'], ['baking powder', 'Pantry'], ['stock cube', 'Pantry'],
  ['mayonnaise', 'Pantry'], ['soy sauce', 'Pantry'], ['couscous', 'Pantry'], ['lentil', 'Pantry'],
  ['vinegar', 'Pantry'], ['chickpea', 'Pantry'], ['granola', 'Pantry'], ['ketchup', 'Pantry'],
  ['mustard', 'Pantry'], ['noodle', 'Pantry'], ['quinoa', 'Pantry'], ['cereal', 'Pantry'],
  ['muesli', 'Pantry'], ['honey', 'Pantry'], ['pasta', 'Pantry'], ['flour', 'Pantry'],
  ['sugar', 'Pantry'], ['sauce', 'Pantry'], ['pesto', 'Pantry'], ['beans', 'Pantry'],
  ['bean', 'Pantry'], ['rice', 'Pantry'], ['soup', 'Pantry'], ['salt', 'Pantry'],
  ['oats', 'Pantry'], ['oat', 'Pantry'], ['oil', 'Pantry'], ['jam', 'Pantry'],
  // Snacks
  ['chocolate', 'Snacks'], ['crackers', 'Snacks'], ['popcorn', 'Snacks'], ['biscuit', 'Snacks'],
  ['pretzel', 'Snacks'], ['sweets', 'Snacks'], ['crisp', 'Snacks'], ['snack', 'Snacks'],
  ['candy', 'Snacks'], ['nuts', 'Snacks'],
  // Drinks
  ['sparkling water', 'Drinks'], ['energy drink', 'Drinks'], ['lemonade', 'Drinks'],
  ['kombucha', 'Drinks'], ['smoothie', 'Drinks'], ['cordial', 'Drinks'], ['coffee', 'Drinks'],
  ['juice', 'Drinks'], ['water', 'Drinks'], ['soda', 'Drinks'], ['cola', 'Drinks'],
  ['tea', 'Drinks'],
  // Alcohol
  ['prosecco', 'Alcohol'], ['whiskey', 'Alcohol'], ['tequila', 'Alcohol'], ['whisky', 'Alcohol'],
  ['brandy', 'Alcohol'], ['spirits', 'Alcohol'], ['cider', 'Alcohol'], ['lager', 'Alcohol'],
  ['vodka', 'Alcohol'], ['beer', 'Alcohol'], ['wine', 'Alcohol'], ['gin', 'Alcohol'],
  ['rum', 'Alcohol'], ['ale', 'Alcohol'],
  // Health
  ['paracetamol', 'Health'], ['multivitamin', 'Health'], ['ibuprofen', 'Health'],
  ['sunscreen', 'Health'], ['supplement', 'Health'], ['bandage', 'Health'], ['plaster', 'Health'],
  ['tampon', 'Health'], ['vitamin', 'Health'], ['aspirin', 'Health'], ['condom', 'Health'],
  // Baby
  ['baby wipe', 'Baby'], ['baby food', 'Baby'], ['formula', 'Baby'], ['nappies', 'Baby'],
  ['nappy', 'Baby'], ['dummy', 'Baby'],
  // Pets
  ['cat litter', 'Pets'], ['dog treat', 'Pets'], ['cat food', 'Pets'], ['dog food', 'Pets'],
  ['pet food', 'Pets'], ['kibble', 'Pets'], ['litter', 'Pets'],
  // Household
  ['toilet paper', 'Household'], ['kitchen roll', 'Household'], ['toothpaste', 'Household'],
  ['toothbrush', 'Household'], ['washing up', 'Household'], ['dishwasher', 'Household'],
  ['detergent', 'Household'], ['deodorant', 'Household'], ['clingfilm', 'Household'],
  ['lightbulb', 'Household'], ['shower gel', 'Household'], ['shampoo', 'Household'],
  ['bin liner', 'Household'], ['conditioner', 'Household'], ['bin bag', 'Household'],
  ['cleaner', 'Household'], ['laundry', 'Household'], ['tissue', 'Household'],
  ['toilet', 'Household'], ['sponge', 'Household'], ['bleach', 'Household'],
  ['razor', 'Household'], ['wipes', 'Household'], ['soap', 'Household'], ['foil', 'Household'],
]

const SORTED_KEYWORDS = [...KEYWORDS].sort((a, b) => b[0].length - a[0].length)

function categorise(name: string): string {
  const haystack = name.toLowerCase()
  for (const [keyword, category] of SORTED_KEYWORDS) {
    if (haystack.includes(keyword)) return category
  }
  return 'Other'
}

/* ── Spoken-English helpers ───────────────────────────────────────────────── */

/** "milk, eggs, and bread" — an Oxford-comma list Siri reads naturally. */
function listToSentence(parts: readonly string[]): string {
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

function spokenItem(item: { name: string; quantity: string | null }): string {
  return item.quantity ? `${item.quantity} ${item.name}` : item.name
}

/* ── Token handling ───────────────────────────────────────────────────────── */

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

async function handleAdd(
  db: SupabaseClient,
  token: TokenRow,
  text: string | undefined,
): Promise<Response> {
  if (!text || tidy(text).length === 0) {
    return speak('I didn’t catch what to add. Try saying it again with the items.', {}, false)
  }

  const phrases = splitPhrases(text)
  const drafts = phrases
    .map(parseItem)
    .filter((item) => item.name.length > 0)
    .map((item) => ({ ...item, name: item.name.slice(0, 200) }))

  if (drafts.length === 0) {
    return speak('I didn’t catch what to add. Try saying it again with the items.', {}, false)
  }

  const base = Date.now()
  const { data, error } = await db
    .from('items')
    .insert(
      drafts.map((draft, index) => ({
        list_id: token.list_id,
        name: draft.name,
        quantity: draft.quantity,
        category: categorise(draft.name),
        source: 'siri',
        // No JWT on this request, so the trigger leaves added_by alone and
        // trusts what we send — the token's owner is the actor.
        added_by: token.user_id,
        sort_order: base + index,
      })),
    )
    .select('id, name, quantity, category, checked')

  if (error) {
    console.error('siri/add insert failed', error)
    return speak('I couldn’t add that to your list just now. Try again in a moment.', {}, false)
  }

  const added = (data ?? []) as ItemRow[]
  const names = added.map((item) => spokenItem(item))

  return speak(
    `Added ${added.length} ${plural(added.length, 'item', 'items')}: ${listToSentence(names)}.`,
    { added: added.map((item) => ({ name: item.name, quantity: item.quantity })) },
  )
}

async function handleRead(db: SupabaseClient, token: TokenRow): Promise<Response> {
  const { data, error } = await db
    .from('items')
    .select('id, name, quantity, category, checked')
    .eq('list_id', token.list_id)
    .eq('checked', false)
    .order('sort_order', { ascending: true })
    .limit(100)

  if (error) {
    console.error('siri/read select failed', error)
    return speak('I couldn’t reach your list just now. Try again in a moment.', {}, false)
  }

  const items = (data ?? []) as ItemRow[]
  if (items.length === 0) {
    return speak('Your list is empty. Nothing to pick up.', { items: [] })
  }

  const names = items.map((item) => spokenItem(item))
  return speak(
    `You have ${items.length} ${plural(items.length, 'item', 'items')}: ${listToSentence(names)}.`,
    {
      count: items.length,
      // `category` is here for the Scriptable home-screen widget, which groups
      // by aisle. Additive, so existing Shortcuts are unaffected.
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        category: item.category,
      })),
    },
  )
}

async function handleCheck(
  db: SupabaseClient,
  token: TokenRow,
  text: string | undefined,
): Promise<Response> {
  if (!text || tidy(text).length === 0) {
    return speak('I didn’t catch what to check off.', {}, false)
  }

  const { data, error } = await db
    .from('items')
    .select('id, name, quantity, category, checked')
    .eq('list_id', token.list_id)
    .eq('checked', false)
    .limit(200)

  if (error) {
    console.error('siri/check select failed', error)
    return speak('I couldn’t reach your list just now. Try again in a moment.', {}, false)
  }

  const items = (data ?? []) as ItemRow[]
  if (items.length === 0) {
    return speak('There’s nothing left on your list to check off.', {}, false)
  }

  // Match on the parsed name so "check off two loaves of bread" still finds
  // "loaves of bread". Exact first, then substring either way round.
  const target = parseItem(text).name.toLowerCase()
  const exact = items.find((item) => item.name.toLowerCase() === target)
  const partial =
    exact ??
    items.find((item) => item.name.toLowerCase().includes(target)) ??
    items.find((item) => target.includes(item.name.toLowerCase()))

  if (!partial) {
    return speak(`I couldn’t find ${target} on your list.`, {}, false)
  }

  const { error: updateError } = await db
    .from('items')
    .update({ checked: true, checked_by: token.user_id, checked_at: new Date().toISOString() })
    .eq('id', partial.id)
    .eq('list_id', token.list_id)

  if (updateError) {
    console.error('siri/check update failed', updateError)
    return speak('I couldn’t check that off just now. Try again in a moment.', {}, false)
  }

  return speak(`Checked off ${partial.name}.`, { checked: { name: partial.name } })
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return speak('That request wasn’t something Larder understands.', {}, false)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // Injected by the platform at runtime. Never hardcoded, never set as a
  // secret — the SUPABASE_ prefix is reserved and `secrets set` rejects it.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('siri: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from the environment')
    return speak('Larder isn’t set up correctly on the server yet.', {}, false)
  }

  const presented = bearerToken(request)
  if (!presented) {
    return speak('This shortcut isn’t connected to Larder. Add your token in the app’s settings.', {}, false)
  }

  let body: SiriRequest
  try {
    const parsed: unknown = await request.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    const candidate = parsed as Record<string, unknown>
    const action = candidate.action
    if (action !== 'add' && action !== 'read' && action !== 'check') {
      return speak('I can add things, read the list, or check something off.', {}, false)
    }
    body = {
      action,
      text: typeof candidate.text === 'string' ? candidate.text : undefined,
    }
  } catch {
    return speak('I couldn’t understand that request.', {}, false)
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const tokenHash = await sha256Hex(presented)
  const { data: tokenRow, error: tokenError } = await db
    .from('api_tokens')
    .select('id, user_id, list_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (tokenError) {
    console.error('siri: token lookup failed', tokenError)
    return speak('Larder couldn’t check your access just now. Try again in a moment.', {}, false)
  }

  if (!tokenRow) {
    return speak('That token isn’t valid for Larder. Generate a new one in the app.', {}, false)
  }

  const token = tokenRow as TokenRow
  if (token.revoked_at !== null) {
    return speak('That token has been revoked. Generate a new one in the app.', {}, false)
  }

  // The service role bypasses RLS, so the stored list binding is not by itself
  // proof of anything. Confirm the token's owner is *still* in the household
  // that owns this list — otherwise an evicted member keeps voice access.
  //
  // Two plain queries rather than an embedded join: lists and household_members
  // have no direct foreign key between them (both point at households), so
  // PostgREST cannot infer the relationship and `household_members!inner(...)`
  // fails at runtime with "could not find a relationship".
  const { data: list, error: listError } = await db
    .from('lists')
    .select('id, household_id')
    .eq('id', token.list_id)
    .maybeSingle()

  if (listError) {
    console.error('siri: list lookup failed', listError)
    return speak('Larder couldn’t check your access just now. Try again in a moment.', {}, false)
  }

  if (!list) {
    return speak('That list no longer exists.', {}, false)
  }

  const { data: membership, error: membershipError } = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', (list as { household_id: string }).household_id)
    .eq('user_id', token.user_id)
    .maybeSingle()

  if (membershipError) {
    console.error('siri: membership check failed', membershipError)
    return speak('Larder couldn’t check your access just now. Try again in a moment.', {}, false)
  }

  if (!membership) {
    return speak('You no longer have access to that list.', {}, false)
  }

  // Best-effort: a failure here must not cost the user their action.
  const touch = db
    .from('api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', token.id)
    .then(({ error }) => {
      if (error) console.error('siri: could not stamp last_used_at', error)
    })

  let response: Response
  switch (body.action) {
    case 'add':
      response = await handleAdd(db, token, body.text)
      break
    case 'read':
      response = await handleRead(db, token)
      break
    case 'check':
      response = await handleCheck(db, token, body.text)
      break
  }

  await touch
  return response
})
