// Renders the PNG app icons from the SVG sources in public/icons with Chromium (Playwright).
// Run after changing an SVG: `node scripts/generate-icons.mjs` (PW_CHROMIUM_PATH optional).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/icons')
const targets = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  // iOS ignores transparency and the manifest: full-bleed square, it rounds the corners itself.
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
]

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
)
const page = await browser.newPage()
for (const [source, target, size] of targets) {
  const svg = await readFile(path.join(dir, source), 'utf8')
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  )
  await page.locator('svg').screenshot({ path: path.join(dir, target), omitBackground: true })
  console.log(`${target} (${size}×${size})`)
}
await browser.close()
