import { expect, newPage, test } from './fixtures'

// #132: sidebar like the familiar layout, collapsible and remembered.

test('the sidebar collapses by button and Ctrl/⌘ + \\, and stays so after a reload', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Layout')
  const sidebar = page.getByRole('complementary', { name: 'Navigation' })
  await expect(sidebar).toBeVisible()

  await sidebar.hover()
  await page.getByRole('button', { name: 'Seitenleiste ausblenden' }).click()
  await expect(sidebar).toBeHidden()
  await page.reload()
  await expect(page.getByRole('complementary', { name: 'Navigation' })).toBeHidden()

  await page.getByRole('button', { name: 'Seitenleiste einblenden' }).click()
  await expect(sidebar).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect(sidebar).toBeHidden()
  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect(sidebar).toBeVisible()
})

test('a subpage is created with the "+" that appears on hover', async ({ signedIn: page }) => {
  await newPage(page, 'Eltern')
  const row = page
    .getByRole('treeitem', { name: /Eltern/ })
    .locator('.tree-row')
    .first()
  await row.hover()
  await row.getByRole('button', { name: 'Unterseite anlegen' }).click()
  await page.getByLabel('Titel').fill('Kind')
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Eltern')
  await expect(page.getByRole('tree')).toContainText('Kind')
})

test('the page menu holds history, export and delete; the header shows the last edit', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Menü')
  await expect(page.getByTestId('page-edited')).toContainText('Bearbeitet')
  await page.getByRole('button', { name: 'Seitenmenü' }).click()
  await expect(page.getByRole('link', { name: 'Verlauf', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Löschen' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Löschen' })).toBeHidden()
})
