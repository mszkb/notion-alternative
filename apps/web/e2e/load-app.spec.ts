import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import type { Operation } from '@notion-alt/shared'
import { blocks, expect, PASSWORD, test } from './fixtures'

// App-level load test (#96): first sync of a large workspace on a new device, cold start from
// IndexedDB, opening a page with many blocks and typing in it. Skipped in normal runs; start
// with LOAD_PAGES=1000 (see docs/testing/load-tests.md). Optional: LOAD_BIG_BLOCKS (2000), OUT.
const PAGES = Number(process.env.LOAD_PAGES ?? 0)
const BIG_BLOCKS = Number(process.env.LOAD_BIG_BLOCKS ?? 2000)
const BLOCKS_PER_PAGE = 50
const BIG_TITLE = 'Große Seite'

test.skip(!PAGES, 'set LOAD_PAGES to run the app load test')
test.setTimeout(30 * 60_000)

test('#96: large workspace in the app', async ({ page }) => {
  const request = page.request
  expect(
    (
      await request.post('/api/auth/register', {
        data: { email: `load-${randomUUID()}@example.com`, password: PASSWORD },
      })
    ).ok(),
  ).toBe(true)
  const workspaceId = (await (await request.get('/api/workspaces')).json()).workspaces[0].id
  // Content comes from another device, so the browser starts as a new device.
  const deviceId = randomUUID()
  await request.post('/api/devices', { data: { id: deviceId, name: 'Seed' } })

  let pending: Operation[] = []
  const flush = async () => {
    if (!pending.length) return
    const response = await request.post('/api/sync/push', { data: { operations: pending } })
    expect(response.ok()).toBe(true)
    pending = []
  }
  const op = async (entity: 'document' | 'block', entityId: string, payload: object) => {
    pending.push({
      opId: randomUUID(),
      deviceId,
      workspaceId,
      entity,
      entityId,
      kind: 'create',
      baseRevision: null,
      payload: payload as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    })
    if (pending.length === 500) await flush()
  }
  const createPage = async (title: string, count: number, sortKey: string) => {
    const id = randomUUID()
    await op('document', id, { parentId: null, title, sortKey, favorite: false, createdAt: 'x' })
    for (let i = 0; i < count; i++) {
      await op('block', randomUUID(), {
        documentId: id,
        type: 'paragraph',
        content: `Absatz ${i} auf ${title} mit etwas Text, damit der Block nicht leer ist.`,
        attrs: {},
        sortKey: `a${String(i).padStart(6, '0')}`,
      })
    }
  }
  const seedStart = Date.now()
  await createPage(BIG_TITLE, BIG_BLOCKS, 'a0')
  for (let p = 0; p < PAGES; p++) {
    await createPage(`Seite ${p}`, BLOCKS_PER_PAGE, `b${String(p).padStart(6, '0')}`)
  }
  await flush()
  const seedMs = Date.now() - seedStart

  const timed = async (fn: () => Promise<unknown>) => {
    const started = Date.now()
    await fn()
    return Date.now() - started
  }
  const bigLink = page.getByRole('link', { name: BIG_TITLE, exact: true }).first()

  // New device: login is shared, the app registers the device and re-syncs page by page.
  const firstSyncMs = await timed(async () => {
    await page.goto('/')
    await expect(page.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
      timeout: 25 * 60_000,
    })
  })
  await expect(bigLink).toBeVisible()

  // Cold start from IndexedDB until the page tree shows the pages.
  const coldStartMs = await timed(async () => {
    await page.reload()
    await expect(bigLink).toBeVisible({ timeout: 60_000 })
  })

  // Opening the large page until its last block is rendered.
  const openBigPageMs = await timed(async () => {
    await bigLink.click()
    await expect(blocks(page)).toHaveCount(BIG_BLOCKS, { timeout: 60_000 })
  })

  // Typing at the end of the large page: time per key until the text is in the DOM.
  const last = blocks(page)
    .nth(BIG_BLOCKS - 1)
    .locator('.block-input')
  await last.click()
  await page.keyboard.press('End')
  const text = ' tippen'.repeat(10)
  const typeMs = await timed(async () => {
    await page.keyboard.type(text)
    await expect(last).toContainText(text.trim())
  })

  const result = {
    config: { pages: PAGES, blocksPerPage: BLOCKS_PER_PAGE, bigPageBlocks: BIG_BLOCKS },
    seedMs,
    firstSyncMs,
    coldStartMs,
    openBigPageMs,
    typing: { keys: text.length, totalMs: typeMs, perKeyMs: Math.round(typeMs / text.length) },
  }
  console.log(JSON.stringify(result, null, 2))
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(result, null, 2) + '\n')
})
