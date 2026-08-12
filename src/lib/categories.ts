/**
 * Aisle categorisation from a keyword map.
 *
 * No cleverness on purpose: a lookup table is predictable, instant, works
 * offline, and is trivially correctable by the user when it guesses wrong.
 * Anything it doesn't recognise falls to Other, which is a fine answer.
 *
 * The original eight names are kept verbatim. `items.category` is free text, so
 * renaming one would strand every item already filed under it — they would all
 * silently reappear in Other. New aisles are only ever added, never renamed.
 */

export const CATEGORIES = [
  'Produce',
  'Bakery',
  'Deli',
  'Dairy',
  'Meat',
  'Seafood',
  'Frozen',
  'Pantry',
  'Snacks',
  'Drinks',
  'Alcohol',
  'Health',
  'Baby',
  'Pets',
  'Household',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

export const DEFAULT_CATEGORY: Category = 'Other'

/** Display order down the screen — roughly the order you walk a shop. */
export const CATEGORY_ORDER: Record<Category, number> = {
  Produce: 0,
  Bakery: 1,
  Deli: 2,
  Dairy: 3,
  Meat: 4,
  Seafood: 5,
  Frozen: 6,
  Pantry: 7,
  Snacks: 8,
  Drinks: 9,
  Alcohol: 10,
  Health: 11,
  Baby: 12,
  Pets: 13,
  Household: 14,
  Other: 15,
}

export const CATEGORY_EMOJI: Record<Category, string> = {
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

/** Spoken/written descriptions, used for screen-reader labels. */
export const CATEGORY_DESCRIPTION: Record<Category, string> = {
  Produce: 'Fruit and vegetables',
  Bakery: 'Bread and baked goods',
  Deli: 'Deli counter',
  Dairy: 'Dairy and eggs',
  Meat: 'Meat and poultry',
  Seafood: 'Fish and seafood',
  Frozen: 'Frozen food',
  Pantry: 'Cupboard and dry goods',
  Snacks: 'Snacks and confectionery',
  Drinks: 'Soft drinks, tea and coffee',
  Alcohol: 'Beer, wine and spirits',
  Health: 'Health and pharmacy',
  Baby: 'Baby and infant',
  Pets: 'Pet supplies',
  Household: 'Household and cleaning',
  Other: 'Everything else',
}

const KEYWORDS: Record<Exclude<Category, 'Other'>, readonly string[]> = {
  Produce: [
    'apple', 'apricot', 'artichoke', 'asparagus', 'aubergine', 'avocado', 'banana', 'basil',
    'beetroot', 'berries', 'blackberr', 'blueberr', 'broccoli', 'brussels', 'cabbage', 'carrot',
    'cauliflower', 'celery', 'cherr', 'chilli', 'chili', 'coriander', 'courgette', 'cranberr',
    'cucumber', 'date', 'eggplant', 'fennel', 'fig', 'fruit', 'garlic', 'ginger', 'grape',
    'greens', 'herb', 'kale', 'kiwi', 'leek', 'lemon', 'lettuce', 'lime', 'mango', 'melon',
    'mint', 'mushroom', 'nectarine', 'onion', 'orange', 'parsley', 'parsnip', 'peach', 'pear',
    'pepper', 'pineapple', 'plum', 'pomegranate', 'potato', 'pumpkin', 'radish', 'raspberr',
    'rhubarb', 'rocket', 'rosemary', 'salad', 'shallot', 'spinach', 'spring onion', 'sprout',
    'squash', 'strawberr', 'sweetcorn', 'sweet potato', 'thyme', 'tomato', 'turnip', 'veg',
    'watermelon', 'zucchini',
  ],
  Bakery: [
    'bagel', 'baguette', 'bap', 'bread', 'brioche', 'bun', 'cake', 'ciabatta', 'croissant',
    'crumpet', 'danish', 'doughnut', 'donut', 'flatbread', 'focaccia', 'loaf', 'loaves',
    'muffin', 'naan', 'pain au chocolat', 'pastr', 'pitta', 'pita', 'roll', 'scone',
    'sourdough', 'tortilla', 'wrap',
  ],
  Deli: [
    'antipasti', 'charcuterie', 'chorizo', 'coleslaw', 'deli', 'hummus', 'houmous', 'olive',
    'pancetta', 'pastrami', 'pate', 'pâté', 'pepperoni', 'prosciutto', 'salami', 'sushi',
    'tzatziki',
  ],
  Dairy: [
    'brie', 'butter', 'buttermilk', 'cheddar', 'cheese', 'cream', 'creme fraiche',
    'crème fraîche', 'custard', 'dairy', 'egg', 'feta', 'ghee', 'goat cheese', 'halloumi',
    'kefir', 'margarine', 'mascarpone', 'milk', 'mozzarella', 'oat milk', 'parmesan',
    'ricotta', 'skyr', 'sour cream', 'soy milk', 'yoghurt', 'yogurt',
  ],
  Meat: [
    'bacon', 'beef', 'brisket', 'burger', 'chicken', 'duck', 'gammon', 'ham', 'lamb', 'liver',
    'meat', 'mince', 'pork', 'sausage', 'steak', 'turkey', 'veal', 'venison',
  ],
  Seafood: [
    'anchov', 'calamari', 'clam', 'cod', 'crab', 'fish', 'haddock', 'halibut', 'kipper',
    'lobster', 'mackerel', 'mussel', 'oyster', 'prawn', 'salmon', 'sardine', 'scallop',
    'seafood', 'shrimp', 'squid', 'trout', 'tuna',
  ],
  Frozen: [
    'frozen', 'gelato', 'ice cream', 'ice lolly', 'ice pop', 'icecream', 'oven chips',
    'popsicle', 'sorbet', 'waffle',
  ],
  Pantry: [
    'baking powder', 'bean', 'bicarb', 'breadcrumb', 'cereal', 'chickpea', 'cocoa', 'couscous',
    'curry paste', 'flour', 'granola', 'gravy', 'honey', 'jam', 'ketchup', 'lentil',
    'marmalade', 'mayo', 'mayonnaise', 'muesli', 'mustard', 'noodle', 'oat', 'oil', 'pasta',
    'peanut butter', 'pesto', 'porridge', 'quinoa', 'rice', 'salt', 'sauce', 'soup',
    'soy sauce', 'spice', 'stock cube', 'stock', 'sugar', 'syrup', 'tinned', 'tomato puree',
    'vinegar', 'yeast',
  ],
  Snacks: [
    // "tortilla chips" must outrank Bakery's "tortilla" — INDEX sorts longest
    // first, so the more specific phrase wins. Same trick for "corn chips".
    'tortilla chips', 'corn chips', 'potato chips', 'pita chips', 'trail mix',
    'chocolate', 'crackers', 'popcorn', 'pretzel', 'flapjack', 'biscuit', 'granola bar',
    'peanuts', 'almonds', 'cashews', 'pistachio', 'raisin', 'nachos', 'doritos',
    'sweets', 'candy', 'crisps', 'crisp', 'chips', 'snack', 'nuts', 'jerky',
  ],
  Drinks: [
    'coffee', 'cordial', 'juice', 'kombucha', 'lemonade', 'squash drink', 'tea', 'water',
    'soda', 'cola', 'smoothie', 'energy drink', 'sparkling water',
  ],
  Alcohol: [
    // No bare "ale": it matches inside kale, tamale and pale. "pale ale" and
    // "ginger ale" are spelled out instead.
    'pale ale', 'ginger ale', 'beer', 'brandy', 'cider', 'gin', 'lager', 'prosecco', 'rum',
    'spirits', 'tequila', 'vodka', 'whisky', 'whiskey', 'wine',
  ],
  Health: [
    'aspirin', 'bandage', 'condom', 'ibuprofen', 'multivitamin', 'painkiller', 'paracetamol',
    'plaster', 'sunscreen', 'supplement', 'tampon', 'throat lozenge', 'vitamin',
  ],
  Baby: [
    'baby food', 'baby wipe', 'bib', 'dummy', 'formula', 'nappies', 'nappy', 'pacifier',
    'teething',
  ],
  Pets: [
    'cat food', 'cat litter', 'dog food', 'dog treat', 'kibble', 'litter', 'pet food',
    'pet treat',
  ],
  Household: [
    'air freshener', 'bin bag', 'bin liner', 'bleach', 'body wash', 'cleaner', 'clingfilm',
    'conditioner', 'cotton', 'deodorant', 'detergent', 'dishwasher', 'floss', 'foil',
    'kitchen roll', 'laundry', 'lightbulb', 'match', 'paper towel', 'razor', 'shampoo',
    'shower gel', 'soap', 'sponge', 'tissue', 'toilet', 'toothbrush', 'toothpaste',
    'washing up', 'washing-up', 'wipes',
  ],
}

/**
 * Longest keyword first, so "sweet potato" wins over "potato", "peanut butter"
 * lands in Pantry rather than Dairy, and "cat food" beats "food".
 */
const INDEX: ReadonlyArray<readonly [string, Category]> = Object.entries(KEYWORDS)
  .flatMap(([category, words]) => words.map((word) => [word, category as Category] as const))
  .sort((a, b) => b[0].length - a[0].length)

/** A household's learned correction: this keyword means this aisle. */
export type CategoryRule = {
  keyword: string
  category: string
}

/**
 * Where does this item belong?
 *
 * The household's own rules win over the built-in map, always — they exist
 * precisely because the built-in map got something wrong. Within each set the
 * longest match wins, so a specific phrase beats a generic word: "tortilla
 * chips" is a snack even though "tortilla" is a bakery keyword.
 */
export function categorise(name: string, rules: readonly CategoryRule[] = []): Category {
  const haystack = name.toLowerCase().trim()
  if (haystack.length === 0) return DEFAULT_CATEGORY

  if (rules.length > 0) {
    let best: { length: number; category: Category } | null = null
    for (const rule of rules) {
      const keyword = rule.keyword.toLowerCase().trim()
      if (keyword.length === 0 || !haystack.includes(keyword)) continue
      if (!best || keyword.length > best.length) {
        best = { length: keyword.length, category: toCategory(rule.category) }
      }
    }
    if (best) return best.category
  }

  for (const [keyword, category] of INDEX) {
    if (haystack.includes(keyword)) return category
  }
  return DEFAULT_CATEGORY
}

/** Narrow a free-text column value from the database back to a Category. */
export function toCategory(value: string | null): Category {
  if (value === null) return DEFAULT_CATEGORY
  return (CATEGORIES as readonly string[]).includes(value) ? (value as Category) : DEFAULT_CATEGORY
}
