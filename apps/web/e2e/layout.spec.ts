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
  const parentUrl = page.url()
  await row.getByRole('button', { name: 'Unterseite anlegen' }).click()
  // Typing before the new page is open would rename the parent.
  await page.waitForURL((url) => url.href !== parentUrl)
  await expect(page.getByLabel('Titel')).toHaveValue('')
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

test('top-level pages line up with the other entries; the arrow shows on hover (#203)', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Oben')
  const sidebar = page.getByRole('complementary', { name: 'Navigation' })
  const recent = sidebar.getByRole('region', { name: 'Zuletzt bearbeitet' }).getByRole('link')
  const node = page.getByRole('treeitem', { name: /Oben/ })
  const icon = node.locator('.tree-icon').first()
  await expect(icon).toBeVisible()
  // The tree icon starts where the text of "Zuletzt bearbeitet" starts (8 px padding).
  const iconBox = (await icon.boundingBox())!
  const recentBox = (await recent.first().boundingBox())!
  expect(Math.abs(iconBox.x - (recentBox.x + 8))).toBeLessThan(6)

  const before = page.url()
  await node.locator('.tree-row').hover()
  await node.getByRole('button', { name: 'Unterseite anlegen' }).click()
  await page.waitForURL((url) => url.href !== before)
  await page.getByLabel('Titel').fill('Darunter')
  const parentRow = node.locator('.tree-row').first()
  await page.getByLabel('Titel').click()
  await expect(parentRow.locator('.tree-arrow')).toBeHidden()
  await parentRow.hover()
  await expect(parentRow.locator('.tree-arrow')).toBeVisible()
  await expect(parentRow.locator('.tree-icon')).toBeHidden()
})
