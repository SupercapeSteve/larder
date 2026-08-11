/**
 * Generates every PWA icon Larder needs, once per accent colour.
 *
 *   npm run icons
 *
 * Output:
 *   public/pwa-*.png                  default (larder green) — referenced by
 *                                     the build-time manifest
 *   public/icons/<accent>/*.png       one set per accent
 *   public/icons/<accent>/manifest.webmanifest
 *
 * The 180×180 apple-touch-icon is not optional: without it iOS uses a
 * screenshot of the page as the home-screen icon. The maskable variant keeps
 * the glyph inside the 80% safe zone so Android's adaptive-icon crop does not
 * clip it.
 *
 * Accent ramps are duplicated from src/lib/themes.ts rather than imported —
 * this is a plain Node script with no TypeScript pipeline. Keep them in step.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

/** [background, foreground, accent] per accent key. Mirrors ACCENT_RAMPS. */
const ACCENTS = {
  larder: ['#27583c', '#f2f8f4', '#96c7a7'],
  teal: ['#0f766e', '#f0fdfa', '#5eead4'],
  sky: ['#0369a1', '#f0f9ff', '#7dd3fc'],
  indigo: ['#4338ca', '#eef2ff', '#a5b4fc'],
  violet: ['#6d28d9', '#f5f3ff', '#c4b5fd'],
  pink: ['#be185d', '#fdf2f8', '#f9a8d4'],
  rose: ['#be123c', '#fff1f2', '#fda4af'],
  orange: ['#c2410c', '#fff7ed', '#fdba74'],
  amber: ['#b45309', '#fffbeb', '#fcd34d'],
  slate: ['#334155', '#f8fafc', '#cbd5e1'],
}

/** Background colour used by the manifest, matching --c-50 of each ramp. */
const BACKGROUND = {
  larder: '#f2f8f4',
  teal: '#f0fdfa',
  sky: '#f0f9ff',
  indigo: '#eef2ff',
  violet: '#f5f3ff',
  pink: '#fdf2f8',
  rose: '#fff1f2',
  orange: '#fff7ed',
  amber: '#fffbeb',
  slate: '#f8fafc',
}

/**
 * A basket, drawn to fill `scale` of the canvas. At scale 0.56 the glyph sits
 * comfortably inside the maskable safe zone.
 */
function icon({ size, scale, rounded, bg, fg, accent }) {
  const g = size * scale
  const offset = (size - g) / 2
  const radius = rounded ? size * 0.22 : 0

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}"/>
  <g transform="translate(${offset} ${offset}) scale(${g / 100})">
    <!-- handles -->
    <path d="M32 34 L42 12" stroke="${accent}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M68 34 L58 12" stroke="${accent}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <!-- basket body -->
    <path d="M8 34 H92 L83 86 A6 6 0 0 1 77 91 H23 A6 6 0 0 1 17 86 Z" fill="${fg}"/>
    <!-- slats -->
    <path d="M34 46 L37 79" stroke="${bg}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
    <path d="M50 46 L50 79" stroke="${bg}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
    <path d="M66 46 L63 79" stroke="${bg}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
  </g>
</svg>`
}

const TARGETS = [
  { file: 'pwa-192x192.png', size: 192, scale: 0.68, rounded: true },
  { file: 'pwa-512x512.png', size: 512, scale: 0.68, rounded: true },
  // Maskable: full-bleed background, glyph inside the 80% safe zone.
  { file: 'pwa-maskable-512x512.png', size: 512, scale: 0.56, rounded: false },
  // iOS composites its own rounded corners, so this one must be square.
  { file: 'apple-touch-icon.png', size: 180, scale: 0.68, rounded: false },
  { file: 'favicon-32x32.png', size: 32, scale: 0.78, rounded: true },
]

function manifestFor(accent) {
  return {
    name: 'Larder',
    short_name: 'Groceries',
    description: 'A realtime household grocery list.',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: ACCENTS[accent][0],
    background_color: BACKGROUND[accent],
    start_url: '/',
    scope: '/',
    lang: 'en',
    categories: ['shopping', 'productivity', 'lifestyle'],
    icons: [
      { src: `/icons/${accent}/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icons/${accent}/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: `/icons/${accent}/pwa-maskable-512x512.png`,
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

async function writeSet(accent, outDir) {
  const [bg, fg, accentColor] = ACCENTS[accent]
  await mkdir(outDir, { recursive: true })

  for (const target of TARGETS) {
    const svg = icon({ ...target, bg, fg, accent: accentColor })
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(resolve(outDir, target.file))
  }
}

await mkdir(publicDir, { recursive: true })

// Default set at the root, so the build-time manifest and index.html resolve
// without any JavaScript having run.
await writeSet('larder', publicDir)
await writeFile(
  resolve(publicDir, 'favicon.svg'),
  icon({ size: 64, scale: 0.78, rounded: true, bg: ACCENTS.larder[0], fg: ACCENTS.larder[1], accent: ACCENTS.larder[2] }),
  'utf8',
)
console.log('wrote default icon set in public/')

for (const accent of Object.keys(ACCENTS)) {
  const outDir = resolve(publicDir, 'icons', accent)
  await writeSet(accent, outDir)
  await writeFile(
    resolve(outDir, 'manifest.webmanifest'),
    `${JSON.stringify(manifestFor(accent), null, 2)}\n`,
    'utf8',
  )
  console.log(`wrote public/icons/${accent}/ (5 icons + manifest)`)
}

console.log(`\n${Object.keys(ACCENTS).length} accent sets generated.`)
