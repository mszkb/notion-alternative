import { blockInput, blocks, expect, newPage, test, waitForSaved } from './fixtures'

// #191: the app's own context menu for text, blocks and the page tree.

test('right click on selected text formats it, with undo; Shift keeps the browser menu', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Kontextmenü')
  await page.keyboard.type('Ein Wort')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')

  const menu = page.getByRole('menu', { name: 'Kontextmenü' })
  await blockInput(page, 0).click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Fett' }).click()
  await expect(menu).toBeHidden()
  await expect(blockInput(page, 0).locator('strong, b')).toHaveText('Ein Wort')

  // One undo step brings the plain text back.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blockInput(page, 0).locator('strong, b')).toHaveCount(0)
  await expect(blockInput(page, 0)).toHaveText('Ein Wort')

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await blockInput(page, 0).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Kursiv' }).click()
  await waitForSaved(page)
  // Saved as Markdown: still formatted after reloading.
  await page.reload()
  await expect(blockInput(page, 0).locator('em, i')).toHaveText('Ein Wort')

  // Shift+right click: no own menu (spelling, paste, translate stay with the browser).
  await blockInput(page, 0).click({ button: 'right', modifiers: ['Shift'] })
  await expect(menu).toHaveCount(0)
})

test('Shift+F10 opens the block menu by keyboard; arrows move, Esc closes', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Tastatur')
  await page.keyboard.type('Einzeiler')
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Kontextmenü' })
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Duplizieren' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await blockInput(page, 0).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Duplizieren' }).click()
  await expect(blocks(page)).toHaveCount(2)
  await expect(blockInput(page, 1)).toHaveText('Einzeiler')
})

test('right click in the page tree: subpage, favorite and delete', async ({ signedIn: page }) => {
  await newPage(page, 'Eltern')
  await waitForSaved(page)
  const tree = page.getByRole('tree')
  const menu = page.getByRole('menu', { name: 'Kontextmenü' })

  await tree.getByRole('link', { name: 'Eltern' }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Zu Favoriten hinzufügen' }).click()
  await expect(page.getByRole('region', { name: 'Favoriten' })).toContainText('Eltern')

  await tree.getByRole('link', { name: 'Eltern' }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Unterseite anlegen' }).click()
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Eltern')
  await expect(tree.getByRole('group').getByRole('treeitem')).toHaveCount(1)

  page.once('dialog', (dialog) => dialog.accept())
  await tree.getByRole('link', { name: 'Eltern' }).click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Löschen' }).click()
  await expect(tree).not.toContainText('Eltern')
})

test('undo of formatting after the block was saved on blur restores the plain text', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Undo nach Speichern')
  await page.keyboard.type('Ein Wort')
  // Leaving the block saves it; the bug left the formatting on screen after undo.
  await page.getByLabel('Titel').click()
  await waitForSaved(page)
  await blockInput(page, 0).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('ControlOrMeta+b')
  await expect(blockInput(page, 0).locator('strong, b')).toHaveText('Ein Wort')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blockInput(page, 0).locator('strong, b')).toHaveCount(0)
  await expect(blockInput(page, 0)).toHaveText('Ein Wort')
})
