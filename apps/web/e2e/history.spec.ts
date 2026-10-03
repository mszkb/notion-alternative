import type { Browser, Page } from '@playwright/test'
import { blockInput, expect, newPage, PASSWORD, signIn, test, waitForSaved } from './fixtures'

async function secondDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  return page
}

const synced = (page: Page) =>
  expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
const refocus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')))

test('the history lists versions and shows what changed since', async ({ page, browser }) => {
  const email = await signIn(page)
  await newPage(page, 'Mit Verlauf')
  await page.keyboard.type('Original')
  await waitForSaved(page)
  await synced(page)

  // Another device edits: a second version.
  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Mit Verlauf').click()
  await blockInput(other, 0).click()
  await other.keyboard.press('End')
  await other.keyboard.type(' von B')
  await waitForSaved(other)
  await synced(other)
  await other.context().close()

  await refocus(page)
  await expect(blockInput(page, 0)).toHaveText('Original von B', { timeout: 10_000 })
  await page.getByRole('link', { name: 'Verlauf', exact: true }).click()

  const versions = page.getByRole('list', { name: 'Versionen' }).getByRole('listitem')
  await expect(versions).toHaveCount(2)
  await expect(versions.nth(1)).toContainText('dieses Gerät')
  await expect(page.getByTestId('version-summary')).toHaveText('Entspricht dem aktuellen Stand.')

  await versions.nth(1).getByRole('button').click()
  await expect(page.getByTestId('version-summary')).toContainText('1 Block')
  const changed = page.locator('[data-status="changed"]')
  await expect(changed.locator('del')).toHaveText('Original')
  await expect(changed.locator('ins')).toHaveText('Original von B')
})
