import { expect, newPage, test, waitForSaved } from './fixtures'

// #195, #196: workspace menu at the top of the sidebar, one status line at the bottom.

test('the workspace menu creates and switches workspaces and signs out', async ({
  signedIn: page,
}) => {
  const menuButton = page.getByTestId('workspace-menu')
  await expect(menuButton).toHaveText('Personal')
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')

  await menuButton.click()
  const menu = page.getByRole('menu', { name: 'Workspace' })
  await expect(menu).toBeVisible()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(menuButton).toBeFocused()

  // Keyboard: open, move to "Neuer Workspace" and create one.
  await page.keyboard.press('Enter')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await menu.getByRole('menuitem', { name: 'Neuer Workspace' }).click()
  await page.getByLabel('Name des neuen Workspace').fill('Zweiter')
  await page.getByRole('button', { name: 'Anlegen' }).click()
  await expect(menuButton).toHaveText('Zweiter')
  const second = page.url()

  await menuButton.click()
  await menu.getByRole('menuitem', { name: /Personal/ }).click()
  await expect(menuButton).toHaveText('Personal')
  expect(page.url()).not.toBe(second)

  await menuButton.click()
  await menu.getByRole('menuitem', { name: /Zweiter/ }).click()
  await expect(page).toHaveURL(second)

  await menuButton.click()
  await menu.getByRole('menuitem', { name: 'Abmelden' }).click()
  const dialog = page.getByRole('dialog', { name: 'Abmelden' })
  await expect(dialog.getByLabel('Lokale Daten auf diesem Gerät löschen')).toBeVisible()
  await expect(dialog.getByLabel('Dieses Gerät auch aus dem Konto entfernen')).toBeVisible()
  await dialog.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('the sidebar footer is one status line; details open on click', async ({ signedIn: page }) => {
  await newPage(page, 'Status')
  await waitForSaved(page)
  const summary = page.getByTestId('sync-summary')
  await expect(summary).toHaveText('Synchronisiert', { timeout: 10_000 })
  const footer = page.locator('.sidebar-footer')
  await expect(page.getByTestId('pending')).toBeHidden()
  // The headless browser does not keep storage: the hint shows once there is content.
  const hint = page.getByTestId('persistence-hint')
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Ausblenden' }).click()
  await page.reload()
  await expect(summary).toHaveText('Synchronisiert', { timeout: 10_000 })
  await expect(hint).toHaveCount(0)
  // Line height of the status line, i.e. at most two lines in the normal case.
  const height = (await footer.boundingBox())?.height ?? 0
  expect(height).toBeLessThan(80)

  await summary.click()
  await expect(page.getByTestId('connection')).toHaveText(/Server verbunden/)
  await expect(page.getByTestId('pending')).toHaveText(/^0 /)
  await expect(page.getByRole('button', { name: 'Jetzt synchronisieren' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pending')).toBeHidden()

  const sidebar = page.getByRole('complementary', { name: 'Navigation' })
  await expect(sidebar.getByRole('link', { name: 'Papierkorb' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Mitglieder' })).toBeVisible()
  await expect(sidebar.getByRole('link', { name: 'Einstellungen' })).toBeVisible()
})

test('without an account: no sync counter, no members, signing in stays reachable', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await newPage(page, 'Nur lokal')
  await waitForSaved(page)
  await expect(page.getByTestId('sync-summary')).toHaveText('Nur auf diesem Gerät')
  await expect(page.getByTestId('pending')).toHaveCount(0)
  const sidebar = page.getByRole('complementary', { name: 'Navigation' })
  await expect(sidebar.getByRole('link', { name: 'Mitglieder' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Papierkorb' })).toBeVisible()
  await expect(page.getByTestId('sign-in')).toBeVisible()

  await page.getByTestId('workspace-menu').click()
  const menu = page.getByRole('menu', { name: 'Workspace' })
  await expect(menu.getByRole('menuitem', { name: /Auf diesem Gerät/ })).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Anmelden' }).click()
  await expect(page).toHaveURL(/\/login$/)
})
