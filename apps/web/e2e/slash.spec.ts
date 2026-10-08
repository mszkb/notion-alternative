import { blockInput, blocks, expect, newPage, test, waitForSaved } from './fixtures'

// #133: "/" menu, block handle with menu and dragging; undo restores each step.

test('"/" turns an empty block into the chosen type and inserts after a filled one', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Slash')
  await page.keyboard.type('/')
  const menu = page.getByRole('dialog', { name: 'Block einfügen' })
  await expect(menu).toBeVisible()
  await page.keyboard.type('h2')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Kapitel')
  await expect(blocks(page).nth(0)).toHaveClass(/block-heading level-2/)
  await expect(blockInput(page, 0)).toHaveText('Kapitel')

  await page.keyboard.press('Enter')
  await page.keyboard.type('Ein Satz /')
  await page.keyboard.type('zitat')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Zitiert')
  await waitForSaved(page)
  await expect(blockInput(page, 1)).toHaveText('Ein Satz')
  await expect(blocks(page).nth(2)).toHaveClass(/block-quote/)

  // Undo removes the typed text, then the inserted quote.
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blocks(page)).toHaveCount(2)
})

test('Esc closes the "/" menu and keeps the typed slash', async ({ signedIn: page }) => {
  await newPage(page, 'Esc')
  await page.keyboard.type('a /')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Block einfügen' })).toBeHidden()
  await page.keyboard.type('b')
  await expect(blockInput(page, 0)).toHaveText('a /b')
})

test('the block menu duplicates by keyboard; the handle drags a block', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Griff')
  await page.keyboard.type('eins')
  await page.keyboard.press('Enter')
  await page.keyboard.type('zwei')
  await waitForSaved(page)

  await blocks(page).nth(0).hover()
  await blocks(page).nth(0).getByRole('button', { name: 'Blockmenü' }).click()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await blocks(page).nth(0).getByRole('button', { name: 'Blockmenü' }).click()
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click()
  await expect(blocks(page)).toHaveCount(3)
  await expect(blockInput(page, 1)).toHaveText('eins')

  await blocks(page).nth(2).hover()
  await blocks(page)
    .nth(2)
    .getByRole('button', { name: 'Blockmenü' })
    .dragTo(blocks(page).nth(0), { targetPosition: { x: 40, y: 2 } })
  await expect(blockInput(page, 0)).toHaveText('zwei')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blockInput(page, 2)).toHaveText('zwei')
})
