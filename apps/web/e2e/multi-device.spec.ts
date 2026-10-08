import type { Browser, Page } from '@playwright/test'
import {
  blockInput,
  expect,
  newPage,
  PASSWORD,
  signIn,
  takeServerDown,
  test,
  waitForSaved,
} from './fixtures'

async function secondDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const login = await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  expect(login.ok()).toBe(true)
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  return page
}

async function synced(page: Page) {
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
}

/** Focus triggers a sync run (like switching back to the tab). */
async function refocus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test('T-MD-01 / T-OFF-03: changes from one device appear on the other', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  const other = await secondDevice(browser, email)

  await newPage(page, 'Von Gerät A')
  await page.keyboard.type('Inhalt von A')
  await waitForSaved(page)
  await synced(page)

  await refocus(other)
  await expect(other.getByRole('tree')).toContainText('Von Gerät A', { timeout: 10_000 })
  await other.getByRole('tree').getByText('Von Gerät A').click()
  await expect(blockInput(other, 0)).toHaveText('Inhalt von A')

  // T-OFF-03: B edits while the server is down; once back, A receives it.
  await takeServerDown(other)
  await blockInput(other, 0).click()
  await other.keyboard.press('End')
  await other.keyboard.type(' und offline von B')
  await waitForSaved(other)
  await other.unroute('**/api/**')
  await refocus(other)
  await synced(other)

  await refocus(page)
  await expect(blockInput(page, 0)).toHaveText('Inhalt von A und offline von B', {
    timeout: 10_000,
  })
  await other.context().close()
})

test('T-DEL-02: an edit on a page another device deleted is kept and can be restored', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Strittig')
  await page.keyboard.type('Ursprung')
  await waitForSaved(page)
  await synced(page)

  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Strittig').click()
  await expect(blockInput(other, 0)).toHaveText('Ursprung')
  await takeServerDown(other)
  await blockInput(other, 0).click()
  await other.keyboard.press('End')
  await other.keyboard.type(' – offline ergänzt')
  await waitForSaved(other)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Seitenmenü' }).click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByRole('tree')).not.toContainText('Strittig')
  await synced(page)

  await other.unroute('**/api/**')
  await refocus(other)
  const notice = other.getByTestId('sync-conflicts')
  await expect(notice).toBeVisible({ timeout: 10_000 })
  await notice.getByRole('link').click()
  const conflict = other.getByRole('region', { name: /Konflikt/ })
  await expect(conflict.getByTestId('local-version')).toHaveText('Ursprung – offline ergänzt')
  await conflict.getByRole('button', { name: 'Als neue Seite wiederherstellen' }).click()

  await expect(other.getByLabel('Titel')).toHaveValue('Strittig (wiederhergestellt)')
  await expect(blockInput(other, 0)).toHaveText('Ursprung – offline ergänzt')
  await synced(other)
  await refocus(page)
  await expect(page.getByRole('tree')).toContainText('Strittig (wiederhergestellt)', {
    timeout: 10_000,
  })
  await other.context().close()
})

test('T-MD-03: the same block edited offline on two devices becomes a visible conflict', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Gemeinsam')
  await page.keyboard.type('Ursprung')
  await waitForSaved(page)
  await synced(page)
  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Gemeinsam').click()
  await expect(blockInput(other, 0)).toHaveText('Ursprung')

  // Both devices edit the same block while offline.
  for (const [device, text] of [
    [page, ' von A'],
    [other, ' von B'],
  ] as const) {
    await takeServerDown(device)
    await blockInput(device, 0).click()
    await device.keyboard.press('End')
    await device.keyboard.type(text)
    await waitForSaved(device)
  }

  // A syncs first and wins the block on the server.
  await page.unroute('**/api/**')
  await refocus(page)
  await synced(page)
  await other.unroute('**/api/**')
  await refocus(other)

  // B: the conflict is visible, nothing is lost, the block shows the server state meanwhile.
  await expect(other.getByTestId('page-conflicts')).toBeVisible({ timeout: 10_000 })
  await expect(other.locator('.block.has-conflict')).toHaveCount(1)
  await expect(blockInput(other, 0)).toHaveText('Ursprung von A')
  await other.getByTestId('page-conflicts').getByRole('link').click()
  const conflict = other.getByRole('region', { name: /Konflikt/ })
  await expect(conflict.getByTestId('local-version')).toHaveText('Ursprung von B')
  await expect(conflict.getByTestId('remote-version')).toHaveText('Ursprung von A')

  await conflict.getByRole('button', { name: 'Manuell zusammenführen' }).click()
  await conflict.getByLabel('Zusammengeführte Fassung').fill('Ursprung von A und B')
  await conflict.getByRole('button', { name: 'Zusammengeführt speichern' }).click()
  await expect(other.getByTestId('no-conflicts')).toBeVisible()
  await synced(other)

  await refocus(page)
  await expect(blockInput(page, 0)).toHaveText('Ursprung von A und B', { timeout: 10_000 })
  await expect(page.getByTestId('sync-conflicts')).toHaveCount(0)
  await other.context().close()
})

test('T-OFF-06: without push, the timer and "Jetzt synchronisieren" bring changes in', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  const context = await browser.newContext()
  const other = await context.newPage()
  // Fake clock on device B only, so its 5-minute timer can be fast-forwarded.
  await other.clock.install()
  await other.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await other.goto('/')
  await expect(other).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(other.getByTestId('sync-status')).toContainText('Synchronisiert um', {
    timeout: 10_000,
  })

  await newPage(page, 'Per Timer')
  await waitForSaved(page)
  await synced(page)

  await other.clock.fastForward('05:01')
  await expect(other.getByRole('tree')).toContainText('Per Timer', { timeout: 10_000 })

  await newPage(page, 'Per Knopf')
  await waitForSaved(page)
  await synced(page)
  await other.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(other.getByRole('tree')).toContainText('Per Knopf', { timeout: 10_000 })
  await context.close()
})

test('server search complements local search with pages not on this device yet', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  const context = await browser.newContext()
  const other = await context.newPage()
  // Device B cannot sync, but the server can be searched.
  await other.route('**/api/sync/**', (route) => route.abort('connectionrefused'))
  await other.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await other.goto('/')
  await expect(other).toHaveURL(/\/w\/[0-9a-f-]+$/)

  await newPage(page, 'Nur auf dem Server')
  await page.keyboard.type('Gesuchter Begriff Zwiebelkuchen')
  await waitForSaved(page)
  await synced(page)

  await other.getByLabel('Seiten durchsuchen').fill('zwiebel')
  const server = other.getByRole('list', { name: 'Weitere Treffer vom Server' })
  await expect(server).toContainText('Nur auf dem Server', { timeout: 10_000 })
  await expect(server).toContainText('Zwiebelkuchen')

  await other.unroute('**/api/sync/**')
  await server.getByRole('button').first().click()
  await expect(other.getByLabel('Titel')).toHaveValue('Nur auf dem Server', { timeout: 10_000 })
  await expect(blockInput(other, 0)).toHaveText('Gesuchter Begriff Zwiebelkuchen')
  await context.close()
})
