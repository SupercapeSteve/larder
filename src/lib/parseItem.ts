/**
 * Pull a quantity off the front of natural typed input.
 *
 *   "2 loaves of bread"  → { quantity: "2",    name: "loaves of bread" }
 *   "500g flour"         → { quantity: "500g", name: "flour" }
 *   "a dozen eggs"       → { quantity: "12",   name: "eggs" }
 *   "milk"               → { quantity: null,   name: "milk" }
 *
 * The rule is deliberately conservative: if the leading token is not clearly a
 * quantity, it stays part of the name. Mangling "7 Up" into a quantity of 7 is
 * worse than leaving a quantity unparsed, because the user can see and fix the
 * latter.
 */

export type ParsedItem = {
  quantity: string | null
  name: string
}

const SPELLED_NUMBERS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  a: '1',
  an: '1',
  couple: '2',
  dozen: '12',
}

/** Units that are unambiguously part of a quantity, never part of a name. */
const UNITS = [
  'kg',
  'kgs',
  'g',
  'gram',
  'grams',
  'lb',
  'lbs',
  'oz',
  'l',
  'litre',
  'litres',
  'liter',
  'liters',
  'ml',
  'cl',
  'pack',
  'packs',
  'pk',
  'pkt',
  'punnet',
  'punnets',
  'bunch',
  'bunches',
  'tin',
  'tins',
  'can',
  'cans',
  'jar',
  'jars',
  'box',
  'boxes',
  'bottle',
  'bottles',
  'bag',
  'bags',
  'dozen',
  'doz',
] as const

const UNIT_PATTERN = UNITS.join('|')

/** "500g flour", "2 kg potatoes", "3 bottles of wine" */
const NUMBER_WITH_UNIT = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})\\b\\s*(?:of\\s+)?`, 'i')

/** "2 loaves of bread", "3x apples", "2 × milk" */
const BARE_NUMBER = /^(\d+(?:[.,]\d+)?)\s*(?:x|×)?\s+/i

/**
 * "a dozen eggs", "two loaves", "a couple of onions", "half a dozen rolls",
 * and a bare article — "a loaf of bread" is what dictation produces, and the
 * article is noise once it is on the list.
 *
 * Alternation order matters: `a dozen` must be tried before bare `a`, or
 * "a dozen eggs" parses as one "dozen eggs".
 */
const SPELLED = new RegExp(
  `^(?:half\\s+a\\s+dozen|(?:a|an)\\s+(?:couple|dozen)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|an|a)\\b\\s*(?:of\\s+)?`,
  'i',
)

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parseItemInput(raw: string): ParsedItem {
  const input = tidy(raw)
  if (input.length === 0) return { quantity: null, name: '' }

  const withUnit = NUMBER_WITH_UNIT.exec(input)
  if (withUnit) {
    const rest = tidy(input.slice(withUnit[0].length))
    // "500g" on its own is not an item — keep the whole thing as the name.
    if (rest.length > 0) {
      const amount = withUnit[1].replace(',', '.')
      const unit = withUnit[2].toLowerCase()
      return { quantity: `${amount}${unit.length <= 2 ? '' : ' '}${unit}`, name: rest }
    }
  }

  const spelled = SPELLED.exec(input)
  if (spelled) {
    const rest = tidy(input.slice(spelled[0].length))
    if (rest.length > 0) {
      const phrase = spelled[0].trim().toLowerCase()
      let quantity: string
      if (phrase.startsWith('half')) {
        quantity = '6'
      } else {
        const words = phrase.replace(/\s+of$/, '').split(/\s+/)
        const last = words[words.length - 1]
        quantity = SPELLED_NUMBERS[last] ?? '1'
      }
      // A lone "a"/"an" is an article, not a count — "a milk" means one milk,
      // but writing "1" there is noise. Only keep explicit counts.
      if (phrase === 'a' || phrase === 'an') return { quantity: null, name: rest }
      return { quantity, name: rest }
    }
  }

  const bare = BARE_NUMBER.exec(input)
  if (bare) {
    const rest = tidy(input.slice(bare[0].length))
    if (rest.length > 0) {
      return { quantity: bare[1].replace(',', '.'), name: rest }
    }
  }

  return { quantity: null, name: input }
}

/**
 * Split one typed or spoken phrase into several items.
 * "milk, eggs, and two loaves of bread" → three items.
 */
export function splitIntoItems(raw: string): string[] {
  return raw
    .split(/\r?\n|,|;|\band\b|&|\+/i)
    .map((part) => tidy(part))
    .filter((part) => part.length > 0)
}
