/**
 * Generates every PWA icon Larder needs from one inline SVG.
 *
 *   npm run icons
 *
 * The 180×180 apple-touch-icon is not optional: without it iOS uses a
 * screenshot of the page as the home-screen icon, which looks broken.
 * The maskable variant keeps the glyph inside the 80% safe zone so Android's
 * adaptive-icon crop does not clip it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')

const BG = '#27583c'
const FG = '#f2f8f4'
const ACCENT = '#96c7a7'

/**
 * A basket, drawn to fill `scale` of the canvas. At scale 0.62 the glyph sits
 * comfortably inside the maskable safe zone.
 */
function icon({ size, scale, rounded }) {
  const g = size * scale
  const offset = (size - g) / 2
  const radius = rounded ? size * 0.22 : 0

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${g / 100})">
    <!-- handles -->
    <path d="M32 34 L42 12" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M68 34 L58 12" stroke="${ACCENT}" stroke-width="7" stroke-linecap="round" fill="none"/>
    <!-- basket body -->
    <path d="M8 34 H92 L83 86 A6 6 0 0 1 77 91 H23 A6 6 0 0 1 17 86 Z"
          fill="${FG}"/>
    <!-- slats -->
    <path d="M34 46 L37 79" stroke="${BG}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
    <path d="M50 46 L50 79" stroke="${BG}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
    <path d="M66 46 L63 79" stroke="${BG}" stroke-width="5" stroke-linecap="round" opacity="0.55"/>
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

await mkdir(publicDir, { recursive: true })

for (const target of TARGETS) {
  const svg = icon(target)
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(resolve(publicDir, target.file))
  console.log(`wrote public/${target.file}  ${target.size}x${target.size}`)
}

// A scalable favicon for desktop browsers that prefer one.
await writeFile(resolve(publicDir, 'favicon.svg'), icon({ size: 64, scale: 0.78, rounded: true }), 'utf8')
console.log('wrote public/favicon.svg')
