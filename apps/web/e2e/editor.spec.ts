import { blockInput, blocks, createVia, expect, newPage, test, waitForSaved } from './fixtures'

test('block editor: headings, text, lists, quote, code and inline formatting', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Editor')
  await page.keyboard.type('# Überschrift')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Text mit ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('fett')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type(' und ')
  await page.keyboard.press('ControlOrMeta+i')
  await page.keyboard.type('kursiv')
  await page.keyboard.press('ControlOrMeta+i')
  await page.keyboard.press('Enter')
  await page.keyboard.type('1. erster')
  await page.keyboard.press('Enter')
  await page.keyboard.type('zweiter')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.type('eingerückt')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('> Zitat')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('```')
  await page.keyboard.type('let a = 1')
  await waitForSaved(page)

  const expectBlocks = async () => {
    await expect(blocks(page).nth(0)).toHaveClass(/block-heading level-1/)
    await expect(blockInput(page, 0)).toHaveText(/Überschrift/)
    await expect(blocks(page).nth(1).locator('strong, b')).toHaveText('fett')
    await expect(blocks(page).nth(1).locator('em, i')).toHaveText('kursiv')
    await expect(blocks(page).nth(2)).toHaveClass(/list-ordered/)
    await expect(blocks(page).nth(3).locator('.list-marker')).toHaveText('2.')
    await expect(blocks(page).nth(4)).toHaveAttribute('style', /--indent: 1/)
    // Enter on the empty list item left the list; "> " turned that paragraph into a quote.
    await expect(blocks(page).nth(5)).toHaveClass(/block-quote/)
    await expect(blockInput(page, 5)).toHaveText('Zitat')
    await expect(blocks(page).nth(6)).toHaveClass(/block-paragraph/)
    await expect(blocks(page).nth(7).locator('textarea')).toHaveValue('let a = 1')
  }
  await expectBlocks()
  await page.reload()
  await expectBlocks()

  // Backspace at the start of a block merges it into the previous one.
  await expect(blocks(page)).toHaveCount(8)
  await blockInput(page, 6).click()
  await page.keyboard.press('Backspace')
  await expect(blocks(page)).toHaveCount(7)
})

test('page tree, breadcrumbs, links, backlinks, tags, favorites and search', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Ziel')
  await page.keyboard.type('Dies ist die Zielseite mit Stichwort Quokka.')
  await waitForSaved(page)

  // Nested page with breadcrumbs.
  await createVia(page, '+ Unterseite', 'Kind')
  await expect(page.getByRole('navigation', { name: 'Pfad' })).toContainText('Ziel')
  const tree = page.getByRole('tree')
  await expect(tree.getByRole('group').getByRole('link', { name: 'Kind' })).toBeVisible()

  // Page link via [[ and the backlink on the target.
  await newPage(page, 'Quelle')
  await page.keyboard.type('Siehe [[')
  await page.getByRole('dialog', { name: 'Seite verlinken' }).getByLabel('Linkziel').fill('Zie')
  await page.keyboard.press('Enter')
  await page.keyboard.type('für Details.')
  await waitForSaved(page)
  const link = blocks(page).first().locator('a.page-link')
  await expect(link).toHaveText('Ziel')

  // Tags and favorites.
  await page.getByLabel('Tag hinzufügen').fill('Projekt')
  await page.getByLabel('Tag hinzufügen').press('Enter')
  await page.getByRole('button', { name: 'Zu Favoriten hinzufügen' }).click()
  const favorites = page.getByRole('region', { name: 'Favoriten' })
  await expect(favorites).toContainText('Quelle')
  await page
    .getByRole('complementary', { name: 'Navigation' })
    .getByRole('link', { name: '#Projekt' })
    .click()
  await expect(page.getByRole('heading', { name: '#Projekt' })).toBeVisible()
  await expect(page.locator('.link-list')).toContainText('Quelle')
  await page.getByRole('link', { name: 'Quelle' }).first().click()

  await link.click()
  await expect(page.getByLabel('Titel')).toHaveValue('Ziel')
  await expect(page.getByRole('region', { name: 'Verlinkt von' })).toContainText('Quelle')

  // Renaming the target updates the link text, the link keeps working (id-based).
  await page.getByLabel('Titel').fill('Ziel umbenannt')
  await page.getByLabel('Titel').blur()
  await page
    .getByRole('region', { name: 'Verlinkt von' })
    .getByRole('link', { name: 'Quelle' })
    .click()
  await expect(blocks(page).first().locator('a.page-link')).toHaveText('Ziel umbenannt')

  // Recently edited and local full-text search.
  await expect(page.getByRole('region', { name: 'Zuletzt bearbeitet' })).toContainText('Quelle')
  await page.getByLabel('Seiten durchsuchen').fill('quokka')
  const results = page.getByRole('region', { name: 'Suchergebnisse' })
  await expect(results).toContainText('Ziel umbenannt')
  await expect(results).toContainText('Stichwort Quokka')
  await results.getByRole('button').first().click()
  await expect(page.getByLabel('Titel')).toHaveValue('Ziel umbenannt')
})

test('deleting a page removes its subtree', async ({ signedIn: page }) => {
  await newPage(page, 'Eltern')
  await createVia(page, '+ Unterseite', 'Kind')
  await page.getByRole('navigation', { name: 'Pfad' }).getByRole('link', { name: 'Eltern' }).click()

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: 'Löschen' }).click()
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(page.getByRole('tree')).not.toContainText('Eltern')
  await expect(page.getByRole('tree')).not.toContainText('Kind')
})
