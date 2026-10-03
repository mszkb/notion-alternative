import type { Page } from '@playwright/test'
import { blockInput, blocks, expect, newPage, test, waitForSaved } from './fixtures'

async function threeBlocks(page: Page) {
  await newPage(page, 'Mehrere Blöcke')
  await page.keyboard.type('eins')
  await page.keyboard.press('Enter')
  await page.keyboard.type('zwei')
  await page.keyboard.press('Enter')
  await page.keyboard.type('drei')
  await waitForSaved(page)
}

async function texts(page: Page) {
  return blocks(page).locator('.block-input').allTextContents()
}

test('undo and redo work across block boundaries and persist', async ({ signedIn: page }) => {
  await threeBlocks(page)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', ''])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei'])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => texts(page)).toEqual(['eins', ''])

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', ''])
  await page.keyboard.press('ControlOrMeta+y')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', 'drei'])

  // Undoing a merge (Backspace at block start) restores both blocks.
  await blockInput(page, 2).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Backspace')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zweidrei'])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', 'drei'])

  await waitForSaved(page)
  await page.reload()
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', 'drei'])
})

test('select blocks with Escape and Shift+arrow, copy as Markdown, delete and undo', async ({
  signedIn: page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await threeBlocks(page)

  await blockInput(page, 0).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.block.selected')).toHaveCount(1)
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('.block.selected')).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+c')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('eins\n\nzwei')

  await page.keyboard.press('Backspace')
  await expect.poll(() => texts(page)).toEqual(['drei'])
  await expect(page.locator('.block.selected')).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', 'drei'])
  await waitForSaved(page)
  await page.reload()
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei', 'drei'])
})

test('dragging across blocks selects them; Shift+arrow at a block edge too', async ({
  signedIn: page,
}) => {
  await threeBlocks(page)

  const first = await blockInput(page, 0).boundingBox()
  const last = await blockInput(page, 2).boundingBox()
  await page.mouse.move(first!.x + 5, first!.y + first!.height / 2)
  await page.mouse.down()
  await page.mouse.move(last!.x + 5, last!.y + last!.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.block.selected')).toHaveCount(3)

  await page.keyboard.press('Escape')
  await expect(page.locator('.block.selected')).toHaveCount(0)

  // From the end of the middle block, Shift+ArrowDown first selects nothing more inside it.
  await blockInput(page, 1).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('.block.selected')).toHaveCount(2)
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.block.selected')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await page.keyboard.type('!')
  await expect.poll(() => texts(page)).toEqual(['eins', 'zwei!', 'drei'])
})
