import type { Browser, Page } from '@playwright/test'
import {
  blockInput,
  expect,
  newPage,
  newSubpage,
  PASSWORD,
  signIn,
  test,
  waitForSaved,
} from './fixtures'

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

test('a deleted page comes back from the trash with its subpage, also elsewhere', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Elternseite')
  await newSubpage(page, 'Unterseite')
  await page.keyboard.type('Inhalt der Unterseite')
  await waitForSaved(page)
  await page
    .getByRole('navigation', { name: 'Pfad' })
    .getByRole('link', { name: 'Elternseite' })
    .click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Seitenmenü' }).click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page.getByRole('tree')).not.toContainText('Elternseite')

  await page.getByRole('link', { name: 'Papierkorb' }).click()
  const trash = page.getByRole('list', { name: 'Gelöschte Seiten' })
  await expect(trash.getByRole('listitem')).toHaveCount(1)
  await trash.getByRole('button', { name: 'Wiederherstellen' }).click()
  await expect(page.getByLabel('Titel')).toHaveValue('Elternseite')
  await expect(page.getByRole('tree')).toContainText('Unterseite')
  await page.getByRole('tree').getByText('Unterseite').click()
  await expect(blockInput(page, 0)).toHaveText('Inhalt der Unterseite')
  await synced(page)

  const other = await secondDevice(browser, email)
  await expect(other.getByRole('tree')).toContainText('Elternseite')
  await other.context().close()
})

test('an older version is restored as new changes and reaches other devices', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Versionen')
  await page.keyboard.type('Original')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zweiter Absatz')
  await waitForSaved(page)
  await synced(page)

  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Versionen').click()
  await blockInput(other, 0).click()
  await other.keyboard.press('End')
  await other.keyboard.type(' geändert')
  await blockInput(other, 1).click()
  await other.keyboard.press('End')
  await other.keyboard.type(' auch')
  await waitForSaved(other)
  await synced(other)

  await refocus(page)
  await expect(blockInput(page, 0)).toHaveText('Original geändert', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Seitenmenü' }).click()
  await page.getByRole('link', { name: 'Verlauf', exact: true }).click()
  const versions = page.getByRole('list', { name: 'Versionen' }).getByRole('listitem')
  await versions.nth(1).getByRole('button').click()

  // Take just the first block back …
  await page
    .locator('[data-status="changed"]')
    .first()
    .getByRole('button', { name: 'Block übernehmen' })
    .click()
  await expect(page.locator('[data-status="changed"]')).toHaveCount(1)
  // … then the whole version.
  await page.getByRole('button', { name: 'Diese Version wiederherstellen' }).click()
  await expect(blockInput(page, 0)).toHaveText('Original')
  await expect(blockInput(page, 1)).toHaveText('Zweiter Absatz')
  await synced(page)

  await refocus(other)
  await expect(blockInput(other, 0)).toHaveText('Original', { timeout: 10_000 })
  await expect(blockInput(other, 1)).toHaveText('Zweiter Absatz')
  await other.context().close()
})
