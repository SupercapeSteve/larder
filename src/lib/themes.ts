/**
 * App accent colours.
 *
 * Every component in Larder styles itself with `larder-50` … `larder-950`.
 * Rather than rewrite all of them, the Tailwind palette is defined in terms of
 * CSS custom properties and this file swaps the whole ramp at runtime. One
 * assignment re-themes the entire app, including anything written later.
 *
 * Values are "R G B" triplets, not hex, because Tailwind composes them as
 * `rgb(var(--c-500) / <alpha-value>)` so opacity modifiers keep working.
 */

export const ACCENTS = [
  'larder',
  'teal',
  'sky',
  'indigo',
  'violet',
  'pink',
  'rose',
  'orange',
  'amber',
  'slate',
] as const

export type Accent = (typeof ACCENTS)[number]

export const DEFAULT_ACCENT: Accent = 'larder'

export type Ramp = {
  50: string
  100: string
  200: string
  300: string
  400: string
  500: string
  600: string
  700: string
  800: string
  900: string
  950: string
}

/** Shown in the picker, and used for the generated app icons. */
export const ACCENT_LABEL: Record<Accent, string> = {
  larder: 'Larder green',
  teal: 'Teal',
  sky: 'Sky',
  indigo: 'Indigo',
  violet: 'Violet',
  pink: 'Pink',
  rose: 'Rose',
  orange: 'Orange',
  amber: 'Amber',
  slate: 'Slate',
}

export const ACCENT_RAMPS: Record<Accent, Ramp> = {
  // The original hand-picked Larder green.
  larder: {
    50: '242 248 244',
    100: '224 239 228',
    200: '194 223 203',
    300: '150 199 167',
    400: '99 168 125',
    500: '65 138 94',
    600: '47 110 73',
    700: '39 88 60',
    800: '34 71 50',
    900: '29 59 43',
    950: '14 33 23',
  },
  teal: {
    50: '240 253 250',
    100: '204 251 241',
    200: '153 246 228',
    300: '94 234 212',
    400: '45 212 191',
    500: '20 184 166',
    600: '13 148 136',
    700: '15 118 110',
    800: '17 94 89',
    900: '19 78 74',
    950: '4 47 46',
  },
  sky: {
    50: '240 249 255',
    100: '224 242 254',
    200: '186 230 253',
    300: '125 211 252',
    400: '56 189 248',
    500: '14 165 233',
    600: '2 132 199',
    700: '3 105 161',
    800: '7 89 133',
    900: '12 74 110',
    950: '8 47 73',
  },
  indigo: {
    50: '238 242 255',
    100: '224 231 255',
    200: '199 210 254',
    300: '165 180 252',
    400: '129 140 248',
    500: '99 102 241',
    600: '79 70 229',
    700: '67 56 202',
    800: '55 48 163',
    900: '49 46 129',
    950: '30 27 75',
  },
  violet: {
    50: '245 243 255',
    100: '237 233 254',
    200: '221 214 254',
    300: '196 181 253',
    400: '167 139 250',
    500: '139 92 246',
    600: '124 58 237',
    700: '109 40 217',
    800: '91 33 182',
    900: '76 29 149',
    950: '46 16 101',
  },
  pink: {
    50: '253 242 248',
    100: '252 231 243',
    200: '251 207 232',
    300: '249 168 212',
    400: '244 114 182',
    500: '236 72 153',
    600: '219 39 119',
    700: '190 24 93',
    800: '157 23 77',
    900: '131 24 67',
    950: '80 7 36',
  },
  rose: {
    50: '255 241 242',
    100: '255 228 230',
    200: '254 205 211',
    300: '253 164 175',
    400: '251 113 133',
    500: '244 63 94',
    600: '225 29 72',
    700: '190 18 60',
    800: '159 18 57',
    900: '136 19 55',
    950: '76 5 25',
  },
  orange: {
    50: '255 247 237',
    100: '255 237 213',
    200: '254 215 170',
    300: '253 186 116',
    400: '251 146 60',
    500: '249 115 22',
    600: '234 88 12',
    700: '194 65 12',
    800: '154 52 18',
    900: '124 45 18',
    950: '67 20 7',
  },
  amber: {
    50: '255 251 235',
    100: '254 243 199',
    200: '253 230 138',
    300: '252 211 77',
    400: '251 191 36',
    500: '245 158 11',
    600: '217 119 6',
    700: '180 83 9',
    800: '146 64 14',
    900: '120 53 15',
    950: '69 26 3',
  },
  slate: {
    50: '248 250 252',
    100: '241 245 249',
    200: '226 232 240',
    300: '203 213 225',
    400: '148 163 184',
    500: '100 116 139',
    600: '71 85 105',
    700: '51 65 85',
    800: '30 41 59',
    900: '15 23 42',
    950: '2 6 23',
  },
}

export const RAMP_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

export function toAccent(value: unknown): Accent {
  return typeof value === 'string' && (ACCENTS as readonly string[]).includes(value)
    ? (value as Accent)
    : DEFAULT_ACCENT
}

function triplet(accent: Accent, step: (typeof RAMP_STEPS)[number]): string {
  return ACCENT_RAMPS[accent][step]
}

/** `rgb(r g b)` for a step — used for meta tags, which cannot take variables. */
export function accentCss(accent: Accent, step: (typeof RAMP_STEPS)[number]): string {
  return `rgb(${triplet(accent, step)})`
}

/** `#rrggbb` — the manifest and theme-color meta want hex. */
export function accentHex(accent: Accent, step: (typeof RAMP_STEPS)[number]): string {
  const [r, g, b] = triplet(accent, step).split(' ').map(Number)
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/** Writes the ramp onto an element as CSS variables. */
export function applyAccent(accent: Accent, root: HTMLElement): void {
  for (const step of RAMP_STEPS) {
    root.style.setProperty(`--c-${step}`, triplet(accent, step))
  }
}
