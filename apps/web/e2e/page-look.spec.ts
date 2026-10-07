import { expect, newPage, test } from './fixtures'

// #136: page icon and cover, shown in the tree and kept on another device.

test('icon and cover gradient appear in the page, the tree and on another device', async ({
  signedIn: page,
  browser,
}) => {
  await newPage(page, 'Reise')
  await page.getByLabel('Titel').hover()
  await page.getByRole('button', { name: 'Icon hinzufügen' }).click()
  await page.getByRole('button', { name: 'Icon ✈️' }).click()
  await page.getByLabel('Titel').hover()
  await page.getByRole('button', { name: 'Titelbild hinzufügen' }).click()
  await page.getByRole('button', { name: 'Farbverlauf ocean' }).click()
  await expect(page.getByTestId('page-cover')).toHaveClass(/cover-ocean/)
  await expect(page.getByRole('tree')).toContainText('✈️ Reise')
  await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click()
  await expect(page.getByTestId('pending')).toContainText('0 lokale Änderungen')

  const other = await browser.newContext({ storageState: await page.context().storageState() })
  const second = await other.newPage()
  await second.goto(page.url())
  await expect(second.getByTestId('page-icon')).toHaveText('✈️')
  await expect(second.getByTestId('page-cover')).toHaveClass(/cover-ocean/)
  await other.close()
})
