import type { BrowserContext, Page } from '@playwright/test'
import { blockInput, expect, newPage, PASSWORD, signIn, test, waitForSaved } from './fixtures'

// Further offline scenarios from #73 (docs/testing/test-matrix.md, "Offline / Online").

async function serverDown(context: BrowserContext) {
  await context.route('**/api/**', (route) => route.abort('connectionrefused'))
}

async function serverUp(context: BrowserContext, ...pages: Page[]) {
  await context.unroute('**/api/**')
  for (const page of pages) await page.evaluate(() => window.dispatchEvent(new Event('online')))
}

async function synced(page: Page) {
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 15_000 })
}

/** Titles of the active pages on the server. */
async function serverTitles(page: Page): Promise<string[]> {
  const workspaceId = new URL(page.url()).pathname.split('/')[2]!
  const response = await page.request.get(`/api/sync/snapshot?workspaceId=${workspaceId}`)
  const snapshot = (await response.json()) as {
    documents: { title: string; deletedAt: string | null }[]
  }
  return snapshot.documents
    .filter((d) => !d.deletedAt)
    .map((d) => d.title)
    .sort()
}

test('the session expires while offline: local work stays and is sent after signing in', async ({
  page,
  context,
}) => {
  const email = await signIn(page)
  await serverDown(context)
  await newPage(page, 'Unterwegs')
  await page.keyboard.type('Im Zug geschrieben')
  await waitForSaved(page)

  // Meanwhile the session ends on the server (expired, revoked elsewhere).
  await context.clearCookies()
  await serverUp(context, page)
  await expect(page.getByTestId('connection')).toContainText(/abgelaufen|Anmeld/i)
  await expect(blockInput(page, 0)).toHaveText('Im Zug geschrieben')
  // Still editable.
  await blockInput(page, 0).click()
  await page.keyboard.press('End')
  await page.keyboard.type(', weiter bearbeitet')
  await waitForSaved(page)

  await page.getByRole('link', { name: 'Anmelden' }).first().click()
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(/\/w\//)
  await synced(page)
  expect(await serverTitles(page)).toContain('Unterwegs')
  const workspaceId = new URL(page.url()).pathname.split('/')[2]!
  const snapshot = await (
    await page.request.get(`/api/sync/snapshot?workspaceId=${workspaceId}`)
  ).json()
  expect(snapshot.blocks.map((b: { content: string }) => b.content)).toContain(
    'Im Zug geschrieben, weiter bearbeitet',
  )
})

test('two tabs offline: edits from both are kept and sent exactly once', async ({
  signedIn: page,
  context,
}) => {
  const second = await context.newPage()
  await second.goto(page.url())
  await expect(second.getByLabel('Seiten durchsuchen')).toBeVisible()

  await serverDown(context)
  await newPage(page, 'Aus Tab eins')
  await page.keyboard.type('Erster Tab')
  await waitForSaved(page)
  await newPage(second, 'Aus Tab zwei')
  await second.keyboard.type('Zweiter Tab')
  await waitForSaved(second)
  // Each tab sees the other's pages from the shared local database.
  await expect(page.getByRole('tree').getByRole('link', { name: 'Aus Tab zwei' })).toBeVisible()

  await serverUp(context, page, second)
  await synced(page)
  await synced(second)
  expect(await serverTitles(page)).toEqual(['Aus Tab eins', 'Aus Tab zwei'])
})

test('storage full: typed text stays on screen, is retried and saved later', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Volle Platte')
  await page.keyboard.type('Erster Satz.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Anderer Block')
  await waitForSaved(page)

  // Every IndexedDB write fails like a full disk.
  const setFull = (full: boolean) =>
    page.evaluate((full) => {
      const w = window as unknown as { __originals?: unknown[] }
      w.__originals ??= [
        IDBObjectStore.prototype.put,
        IDBObjectStore.prototype.add,
        IDBCursor.prototype.update,
      ]
      const fail = () => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      }
      const [put, add, update] = w.__originals as [never, never, never]
      IDBObjectStore.prototype.put = full ? fail : put
      IDBObjectStore.prototype.add = full ? fail : add
      IDBCursor.prototype.update = full ? fail : update
    }, full)

  await setFull(true)
  await blockInput(page, 0).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Zweiter Satz.')
  await expect(page.getByRole('alert')).toContainText('Speicher voll')

  // Some space again; another block is saved first and the page re-renders from the database.
  // The failed text must not be replaced by the older stored content.
  await setFull(false)
  await blockInput(page, 1).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' geändert')
  await expect(blockInput(page, 1)).toHaveText('Anderer Block geändert')
  await expect(blockInput(page, 0)).toHaveText('Erster Satz. Zweiter Satz.')

  // The retry stores it.
  await expect(page.getByTestId('saved')).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(600)
  await page.reload()
  await expect(blockInput(page, 0)).toHaveText('Erster Satz. Zweiter Satz.')
  await expect(blockInput(page, 1)).toHaveText('Anderer Block geändert')
})
