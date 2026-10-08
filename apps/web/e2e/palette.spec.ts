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
  await page.getByRole('heading', { name: 'Verlinkt von' }).click()
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

test('in text, Ctrl/⌘ + K inserts a link instead; Ctrl/⌘ + P always searches', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Text')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Schnellsuche' })).toBeHidden()
  await page.keyboard.press('Escape')
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
