import type { Page } from '@playwright/test'
import { blockInput, blocks, expect, newPage, test, waitForSaved } from './fixtures'

// #194: inline Markdown turns into formatting while typing; content stays Markdown-inline.

/** Stored content of all blocks (IndexedDB), in document order. */
async function storedContents(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const name = (await indexedDB.databases()).find((d) => d.name?.startsWith('notion-alt-'))!.name!
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const all = await new Promise<{ content: string; sortKey: string; deletedAt?: string }[]>(
      (resolve, reject) => {
        const request = db.transaction('blocks').objectStore('blocks').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      },
    )
    db.close()
    return all
      .filter((b) => !b.deletedAt)
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
      .map((b) => b.content)
  })
}

test('bold, italic, code and links convert while typing and are saved as Markdown', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Markdown')
  await page.keyboard.type(
    'Ein **fetter** Satz, _schräg_ und *auch*, `npm test` und [Doku](https://example.com) Ende',
  )
  await waitForSaved(page)

  const block = blockInput(page, 0)
  await expect(block.locator('strong')).toHaveText('fetter')
  await expect(block.locator('em')).toHaveText(['schräg', 'auch'])
  await expect(block.locator('code')).toHaveText('npm test')
  await expect(block.locator('a')).toHaveText('Doku')
  await expect(block.locator('a')).toHaveAttribute('href', 'https://example.com')
  // Text after the converted part is plain again.
  await expect(block).toHaveText('Ein fetter Satz, schräg und auch, npm test und Doku Ende')
  await expect(block.locator('strong')).not.toContainText('Satz')
  await expect
    .poll(() => storedContents(page))
    .toEqual([
      'Ein **fetter** Satz, _schräg_ und _auch_, `npm test` und [Doku](https://example.com) Ende',
    ])
})

test('one undo right after the conversion brings the characters back', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Rückgängig')
  await page.keyboard.type('Das ist **fett**')
  await expect(blockInput(page, 0).locator('strong')).toHaveText('fett')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blockInput(page, 0).locator('strong')).toHaveCount(0)
  await expect(blockInput(page, 0)).toHaveText('Das ist **fett**')
  await waitForSaved(page)
  await expect.poll(() => storedContents(page)).toEqual(['Das ist \\*\\*fett\\*\\*'])
})

test('no conversion in code blocks, inline code or for escaped characters', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Ohne')
  await page.keyboard.type('Preis 2*3* und snake_case_name und \\*nicht*')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  await page.keyboard.type('a = **b**')
  await waitForSaved(page)
  await expect(blocks(page).locator('strong, em')).toHaveCount(0)
  await expect(blockInput(page, 0)).toHaveText('Preis 2*3* und snake_case_name und \\*nicht*')
  await expect(blocks(page).nth(1).locator('textarea')).toHaveValue('a = **b**')
})
