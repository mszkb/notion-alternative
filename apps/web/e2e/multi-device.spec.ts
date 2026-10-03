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

test('T-DEL-02: editing a page another device deleted shows a conflict and keeps the edit', async ({
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
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByRole('tree')).not.toContainText('Strittig')
  await synced(page)

  await other.unroute('**/api/**')
  await refocus(other)
  await expect(other.getByTestId('sync-conflicts')).toBeVisible({ timeout: 10_000 })
  await expect(other.getByRole('tree')).toContainText('Strittig')
  await expect(blockInput(other, 0)).toHaveText('Ursprung – offline ergänzt')
  await other.context().close()
})
