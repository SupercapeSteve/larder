/**
 * Aisle categorisation from a keyword map.
 *
 * No cleverness on purpose: a lookup table is predictable, instant, works
 * offline, and is trivially correctable by the user when it guesses wrong.
 * Anything it doesn't recognise falls to Other, which is a fine answer.
 */

export const CATEGORIES = [
  'Produce',
  'Dairy',
  'Meat',
  'Bakery',
  'Frozen',
  'Pantry',
  'Household',
  'Other',
] as const

export type Category = (typeof CATEGORIES)[number]

export const DEFAULT_CATEGORY: Category = 'Other'

/** Display order down the screen — roughly the order you walk a shop. */
export const CATEGORY_ORDER: Record<Category, number> = {
  Produce: 0,
  Bakery: 1,
  Dairy: 2,
  Meat: 3,
  Frozen: 4,
  Pantry: 5,
  Household: 6,
  Other: 7,
}

export const CATEGORY_EMOJI: Record<Category, string> = {
  Produce: '🥬',
  Bakery: '🥖',
  Dairy: '🧀',
  Meat: '🥩',
  Frozen: '🧊',
  Pantry: '🥫',
  Household: '🧼',
  Other: '🛒',
}

const KEYWORDS: Record<Exclude<Category, 'Other'>, readonly string[]> = {
  Produce: [
    'apple', 'apricot', 'artichoke', 'asparagus', 'aubergine', 'avocado', 'banana', 'basil',
    'beetroot', 'berries', 'blackberr', 'blueberr', 'broccoli', 'cabbage', 'carrot', 'cauliflower',
    'celery', 'cherr', 'chilli', 'chili', 'coriander', 'corn', 'courgette', 'cucumber', 'date',
    'eggplant', 'fennel', 'fruit', 'garlic', 'ginger', 'grape', 'greens', 'herb', 'kale', 'kiwi',
    'leek', 'lemon', 'lettuce', 'lime', 'mango', 'melon', 'mint', 'mushroom', 'nectarine', 'olive',
    'onion', 'orange', 'parsley', 'parsnip', 'peach', 'pear', 'pepper', 'pineapple', 'plum',
    'potato', 'pumpkin', 'radish', 'raspberr', 'rhubarb', 'rocket', 'rosemary', 'salad', 'shallot',
    'spinach', 'spring onion', 'sprout', 'squash', 'strawberr', 'sweetcorn', 'sweet potato',
    'thyme', 'tomato', 'turnip', 'veg', 'watermelon', 'zucchini',
  ],
  Dairy: [
    'butter', 'buttermilk', 'brie', 'cheddar', 'cheese', 'cream', 'creme fraiche', 'crème fraîche',
    'custard', 'dairy', 'egg', 'feta', 'ghee', 'goat cheese', 'halloumi', 'kefir', 'margarine',
    'mascarpone', 'milk', 'mozzarella', 'oat milk', 'parmesan', 'ricotta', 'skyr', 'sour cream',
    'soy milk', 'yoghurt', 'yogurt',
  ],
  Meat: [
    'anchov', 'bacon', 'beef', 'brisket', 'burger', 'chicken', 'chorizo', 'cod', 'duck', 'fish',
    'gammon', 'ham', 'haddock', 'lamb', 'liver', 'mackerel', 'meat', 'mince', 'mussels', 'pancetta',
    'pork', 'prawn', 'prosciutto', 'salami', 'salmon', 'sardine', 'sausage', 'scallop', 'seafood',
    'shrimp', 'steak', 'tuna', 'turkey', 'veal', 'venison',
  ],
  Bakery: [
    'bagel', 'baguette', 'bap', 'biscuit', 'bread', 'brioche', 'bun', 'cake', 'ciabatta',
    'croissant', 'crumpet', 'danish', 'doughnut', 'donut', 'flatbread', 'focaccia', 'loaf',
    'loaves', 'muffin', 'naan', 'pastr', 'pain au chocolat', 'pitta', 'pita', 'roll', 'scone',
    'sourdough', 'tortilla', 'wrap',
  ],
  Frozen: [
    'frozen', 'gelato', 'ice cream', 'ice lolly', 'ice pop', 'icecream', 'oven chips', 'peas',
    'popsicle', 'sorbet', 'waffle',
  ],
  Pantry: [
    'baking powder', 'bean', 'biscuits', 'cereal', 'chickpea', 'chocolate', 'cocoa', 'coffee',
    'cordial', 'couscous', 'crackers', 'crisps', 'curry paste', 'flour', 'granola', 'honey', 'jam',
    'juice', 'ketchup', 'lentil', 'mayo', 'mayonnaise', 'muesli', 'mustard', 'noodle', 'nut',
    'oat', 'oil', 'pasta', 'peanut butter', 'pesto', 'porridge', 'rice', 'salt', 'sauce', 'soup',
    'spice', 'stock', 'sugar', 'sweetcorn tin', 'syrup', 'tea', 'tinned', 'tomato puree', 'tuna tin',
    'vinegar', 'water', 'wine', 'beer', 'crisp', 'snack', 'stock cube', 'soy sauce',
  ],
  Household: [
    'batter', 'bin bag', 'bleach', 'body wash', 'cleaner', 'clingfilm', 'conditioner', 'cotton',
    'deodorant', 'detergent', 'dishwasher', 'floss', 'foil', 'kitchen roll', 'laundry', 'lightbulb',
    'match', 'nappies', 'nappy', 'paper towel', 'razor', 'shampoo', 'shower gel', 'soap', 'sponge',
    'tissue', 'toilet', 'toothbrush', 'toothpaste', 'washing up', 'washing-up', 'wipes',
  ],
}

/**
 * Longest keyword first, so "sweet potato" wins over "potato" and
 * "peanut butter" is Pantry rather than Dairy.
 */
const INDEX: ReadonlyArray<readonly [string, Category]> = Object.entries(KEYWORDS)
  .flatMap(([category, words]) => words.map((word) => [word, category as Category] as const))
  .sort((a, b) => b[0].length - a[0].length)

export function categorise(name: string): Category {
  const haystack = name.toLowerCase().trim()
  if (haystack.length === 0) return DEFAULT_CATEGORY

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
