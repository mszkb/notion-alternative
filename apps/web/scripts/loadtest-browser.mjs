// Client load test in real Chromium (#77): serves loadtest.html with Vite and runs the scenario
// from src/local/load-scenario.ts against the browser's IndexedDB.
//   pnpm --filter @notion-alt/web loadtest:browser
// Environment: PAGES (default 1000), BLOCKS_PER_PAGE (50), OUT, PW_CHROMIUM_PATH.
/* global window -- used inside page.evaluate(), which runs in the browser */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'

const pages = Number(process.env.PAGES ?? 1000)
const blocksPerPage = Number(process.env.BLOCKS_PER_PAGE ?? 50)

const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  logLevel: 'warn',
  server: { port: 0, host: '127.0.0.1' },
})
await server.listen()
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM_PATH
    ? { executablePath: process.env.PW_CHROMIUM_PATH }
    : { channel: 'chromium' }),
  args: ['--enable-precise-memory-info'],
})
try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error(error))
  page.on('console', (message) => message.type() === 'error' && console.error(message.text()))
  await page.goto(`${server.resolvedUrls.local[0]}loadtest.html`)
  await page.waitForFunction(() => window.loadtestReady === true, null, { timeout: 60_000 })
  const result = await page.evaluate(
    ({ pages, blocksPerPage }) =>
      window.runClientLoad({
        pages,
        blocksPerPage,
        heapMb: () =>
          performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
      }),
    { pages, blocksPerPage },
  )
  const output = JSON.stringify({ runtime: `chromium ${browser.version()}`, ...result }, null, 2)
  if (process.env.OUT) writeFileSync(process.env.OUT, output + '\n')
  console.log(output)
} finally {
  await browser.close()
  await server.close()
}
