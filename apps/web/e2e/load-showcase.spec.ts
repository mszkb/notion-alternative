import { writeFileSync } from 'node:fs'
import { expect, test } from './fixtures'

// Measurements on the showcase workspace (#218): seed it first with scripts/loadtest/showcase.mjs,
// then run against that installation as a new device:
//   LOAD_SHOWCASE=1 BASE_URL=http://localhost:5182 pnpm --filter @notion-alt/web exec \
//     playwright test e2e/load-showcase.spec.ts --project chromium
// Same EMAIL, PASSWORD and WORKSPACE as the script; OUT writes the JSON result to a file.
const EMAIL = process.env.EMAIL ?? 'showcase@example.com'
const PASSWORD = process.env.PASSWORD ?? 'showcase password 123'
const WORKSPACE = process.env.WORKSPACE ?? 'Showcase'
const NEEDLE = process.env.NEEDLE ?? 'Quokka'

test.skip(!process.env.LOAD_SHOWCASE, 'set LOAD_SHOWCASE and BASE_URL to measure the showcase')
test.setTimeout(30 * 60_000)
test.use({ trace: 'off' })

test('#218: showcase workspace on a new device', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  })
  expect(login.ok()).toBe(true)
  const { workspaces } = await (await page.request.get('/api/workspaces')).json()
  const workspace = workspaces.find((w: { name: string }) => w.name === WORKSPACE)
  expect(workspace, `workspace ${WORKSPACE}`).toBeTruthy()

  const timed = async (fn: () => Promise<unknown>) => {
    const started = Date.now()
    await fn()
    return Date.now() - started
  }
  // CSS selectors, not roles: computing roles over tens of thousands of tree nodes costs
  // Playwright itself seconds (see load-app.spec.ts).
  const topLevel = page.locator('ul.tree > .tree-node')

  // New device: page tree and metadata, contents on demand (ADR 0017).
  const firstSyncMs = await timed(async () => {
    await page.goto(`/w/${workspace.id}`)
    await expect(page.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
      timeout: 25 * 60_000,
    })
  })
  await expect(topLevel.first()).toBeVisible()

  // Down one branch to the deepest level.
  const expandMs = await timed(async () => {
    let row = page.locator('.tree-node').first()
    for (let level = 0; level < 3; level++) {
      const arrow = row.locator(':scope > .tree-row button[aria-label="Aufklappen"]')
      if ((await arrow.count()) === 0) break
      await arrow.click()
      row = row.locator(':scope > ul > .tree-node').first()
      await expect(row).toBeVisible()
    }
  })

  // Sidebar search for a word on exactly one page: local hits first, then the server's for pages
  // whose content is not on the device yet (ADR 0017).
  const searchMs = await timed(async () => {
    await page.getByLabel('Seiten durchsuchen').fill(NEEDLE)
    await expect(page.locator('[aria-label="Suchergebnisse"] li').first()).toBeVisible({
      timeout: 60_000,
    })
  })
  await page.getByLabel('Seiten durchsuchen').fill('')

  // Quick search by title, on the device.
  const paletteMs = await timed(async () => {
    await page.keyboard.press('ControlOrMeta+p')
    await page.getByPlaceholder('Seiten suchen oder Befehl eingeben…').fill('Gitarre')
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 60_000 })
  })
  await page.keyboard.press('Escape')

  // Quick search for the word on one page: from the server, as its content is not here (#219).
  const paletteServerMs = await timed(async () => {
    await page.keyboard.press('ControlOrMeta+p')
    await page.getByPlaceholder('Seiten suchen oder Befehl eingeben…').fill(NEEDLE)
    await expect(page.locator('[role="option"]', { hasText: 'Vom Server' }).first()).toBeVisible({
      timeout: 60_000,
    })
  })
  await page.keyboard.press('Escape')

  // Cold start from IndexedDB until the tree shows.
  const coldStartMs = await timed(async () => {
    await page.reload()
    await expect(topLevel.first()).toBeVisible({ timeout: 60_000 })
  })

  const heapMb = await page.evaluate(() => {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return memory ? Math.round(memory.usedJSHeapSize / 1e6) : null
  })
  const result = {
    firstSyncMs,
    expandMs,
    searchMs,
    paletteMs,
    paletteServerMs,
    coldStartMs,
    heapMb,
  }
  console.log(JSON.stringify(result, null, 2))
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(result, null, 2) + '\n')
})
