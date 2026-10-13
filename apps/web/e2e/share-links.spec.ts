import { blockInput, expect, newPage, signIn, test, waitForSaved } from './fixtures'

/** Read links for guests without an account (ADR 0022, T-SHARE-06/07). */

test('a guest reads a page by link without signing in; revoking ends it', async ({
  page,
  browser,
}) => {
  await signIn(page)
  await newPage(page, 'Reiseplan')
  await page.keyboard.type('Erster Tag: ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('Ankunft')
  await page.keyboard.press('ControlOrMeta+b')
  await waitForSaved(page)
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
  await expect(blockInput(page, 0)).toContainText('Ankunft')

  await page.getByTestId('page-menu').click()
  await page.getByTestId('share-open').click()
  const dialog = page.getByTestId('share-dialog')
  await dialog.getByTestId('share-validity').selectOption({ label: '7 Tage' })
  await dialog.getByTestId('share-create').click()
  const url = await dialog.getByTestId('share-url').inputValue()
  expect(url).toMatch(/\/share\/[A-Za-z0-9_-]{43}$/)
  await expect(dialog.getByTestId('share-link')).toHaveCount(1)
  await expect(dialog.getByTestId('share-link')).toContainText('gültig bis')

  // A fresh browser without a session or local data.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await guest.goto(url)
  const shared = guest.getByTestId('shared-page')
  await expect(shared.getByRole('heading', { level: 1 })).toHaveText('Reiseplan')
  await expect(shared.locator('strong')).toHaveText('Ankunft')
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/)
  await expect(shared.locator('[contenteditable="true"]')).toHaveCount(0)
  expect(guest.url()).toBe(url)

  await dialog.getByRole('button', { name: 'Widerrufen' }).click()
  await expect(dialog.getByTestId('share-link')).toHaveCount(0)
  await guest.reload()
  await expect(guest.getByTestId('share-missing')).toBeVisible()
  await guestContext.close()
})
