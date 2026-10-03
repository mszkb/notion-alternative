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
