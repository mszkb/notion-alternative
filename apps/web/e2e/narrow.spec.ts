import { expect, newPage, signIn, test } from './fixtures'

// #201: on a phone the sidebar is an overlay with a scrim that closes it.

test('the overlay dims the page and closes by tap, Esc, swipe and opening a page', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  await signIn(page)
  const sidebar = page.getByRole('complementary', { name: 'Navigation' })
  const toggle = page.getByRole('button', { name: 'Navigation' })
  const scrim = page.getByTestId('sidebar-scrim')
  // No keyboard on a phone: no shortcut hints.
  await expect(page.getByLabel('Seiten durchsuchen')).toHaveAttribute('placeholder', 'Suchen…')

  await toggle.click()
  await expect(scrim).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Tastenkürzel' })).toHaveCount(0)
  // Workspace menu and close button stay clear of each other.
  const menuBox = (await page.getByTestId('workspace-menu').boundingBox())!
  const closeBox = (await page
    .getByRole('button', { name: 'Seitenleiste ausblenden' })
    .boundingBox())!
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(closeBox.x)
  await scrim.click({ position: { x: 370, y: 400 } })
  await expect(scrim).toBeHidden()
  await expect(toggle).toBeFocused()

  await toggle.click()
  await expect(page.getByTestId('workspace-menu')).toBeFocused()
  // Focus stays in the sidebar: Shift+Tab from the first entry goes to the last one.
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('sync-summary')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(scrim).toBeHidden()

  await toggle.click()
  await sidebar.evaluate((el) => {
    const touch = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(250)], bubbles: true }))
    el.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch(120)], bubbles: true }))
  })
  await expect(scrim).toBeHidden()

  await toggle.click()
  await newPage(page, 'Vom Handy')
  await expect(scrim).toBeHidden()
  await expect(page.getByLabel('Titel')).toHaveValue('Vom Handy')
  await context.close()
})
