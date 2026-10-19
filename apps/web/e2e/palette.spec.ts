import { blockInput, expect, newPage, test, waitForSaved } from './fixtures'

// #134: quick search and shortcuts, offline too.

test('Ctrl/⌘ + K opens the quick search, which finds pages offline', async ({
  signedIn: page,
  context,
}) => {
  await newPage(page, 'Reiseplanung')
  await page.keyboard.type('Zugtickets nach Wien')
  await newPage(page, 'Einkauf')
  await waitForSaved(page)

  await context.setOffline(true)
  // The caret is still in the page: without selected text the shortcut searches (#197).
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Schnellsuche' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /Reiseplanung/ })).toBeVisible()
  await page.keyboard.type('wien')
  await expect(palette.getByRole('option').first()).toContainText('Reiseplanung')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(page.getByLabel('Titel')).toHaveValue('Reiseplanung')
  await expect(blockInput(page, 0)).toHaveText('Zugtickets nach Wien')
})

test('Ctrl/⌘ + K links selected text, otherwise it searches; Ctrl/⌘ + P always searches', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Text')
  await page.keyboard.type('Verweis')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Schnellsuche' })
  await expect(palette).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Link einfügen' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  await blockInput(page, 0).selectText()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Link einfügen' })).toBeVisible()
  await expect(palette).toBeHidden()
  await page.keyboard.press('Escape')

  await blockInput(page, 0).click()
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByRole('dialog', { name: 'Schnellsuche' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Schnellsuche' })).toBeHidden()
})

test('Ctrl/⌘ + Shift + L switches the theme and Ctrl/⌘ + / lists the shortcuts', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Thema')
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? null)
  const before = await theme()
  await page.keyboard.press('ControlOrMeta+Shift+L')
  expect(await theme()).not.toBe(before)
  await page.keyboard.press('ControlOrMeta+/')
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel' })).toBeVisible()
})
