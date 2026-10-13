import { randomUUID } from 'node:crypto'
import type { Browser, Page } from '@playwright/test'
import { blockInput, expect, newPage, PASSWORD, signIn, test, waitForSaved } from './fixtures'

/** Sharing a workspace with another account (ADR 0014, T-SHARE-*). */

async function otherAccount(browser: Browser): Promise<{ page: Page; email: string }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = `e2e-${randomUUID()}@example.com`
  const response = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  })
  expect(response.ok()).toBe(true)
  return { page, email }
}

async function synced(page: Page) {
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
}

/** Focus refreshes the workspace list (roles) and syncs, like switching back to the tab. */
async function refocus(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

test('a reader sees the workspace read-only, an editor changes it, a removed member keeps it readable', async ({
  page,
  browser,
}) => {
  await signIn(page)
  const workspaceId = new URL(page.url()).pathname.split('/')[2]!
  await newPage(page, 'Geteilte Planung')
  await page.keyboard.type('Von der Besitzerin')
  await waitForSaved(page)
  await synced(page)

  // The owner invites another account of this server as reader.
  const bob = await otherAccount(browser)
  await page.getByRole('link', { name: 'Mitglieder' }).click()
  await page.getByLabel('E-Mail-Adresse des Kontos').fill(bob.email)
  await page.getByLabel('Rolle', { exact: true }).selectOption('reader')
  await page.getByRole('button', { name: 'Hinzufügen' }).click()
  await expect(page.getByTestId('member').filter({ hasText: bob.email })).toContainText('Lesen')

  // The reader sees everything, but cannot change anything.
  await bob.page.goto('/?choose=1')
  await expect(bob.page.getByTestId('workspace-shared')).toHaveText(/geteilt · Lesen/)
  await bob.page.goto(`/w/${workspaceId}`)
  await expect(bob.page.getByTestId('read-only')).toContainText('Lesen')
  await expect(bob.page.getByRole('tree')).toContainText('Geteilte Planung', { timeout: 10_000 })
  await bob.page.getByRole('tree').getByText('Geteilte Planung').click()
  await expect(blockInput(bob.page, 0)).toHaveText('Von der Besitzerin')
  await expect(blockInput(bob.page, 0)).toHaveAttribute('contenteditable', 'false')
  await expect(bob.page.getByLabel('Titel')).toHaveAttribute('readonly', '')
  await expect(bob.page.getByRole('button', { name: 'Neue Seite' })).toHaveCount(0)
  await expect(bob.page.getByRole('button', { name: '+ Block hinzufügen' })).toHaveCount(0)

  // Made editor, the same account edits; the owner receives the change.
  await page.getByLabel(`Rolle von ${bob.email}`).selectOption('editor')
  await expect(page.getByLabel(`Rolle von ${bob.email}`)).toHaveValue('editor')
  await refocus(bob.page)
  await expect(bob.page.getByTestId('read-only')).toHaveCount(0, { timeout: 10_000 })
  await blockInput(bob.page, 0).click()
  await bob.page.keyboard.press('End')
  await bob.page.keyboard.type(' und von Bob')
  await waitForSaved(bob.page)
  await synced(bob.page)

  await page.getByRole('tree').getByText('Geteilte Planung').click()
  await refocus(page)
  await expect(blockInput(page, 0)).toHaveText('Von der Besitzerin und von Bob', {
    timeout: 10_000,
  })

  // Removed, the member keeps what is on the device, read-only.
  await page.getByRole('link', { name: 'Mitglieder' }).click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page
    .getByTestId('member')
    .filter({ hasText: bob.email })
    .getByRole('button', { name: 'Entfernen' })
    .click()
  await expect(page.getByTestId('member')).toHaveCount(1)

  await refocus(bob.page)
  await expect(bob.page.getByTestId('access-revoked')).toBeVisible({ timeout: 10_000 })
  await expect(blockInput(bob.page, 0)).toHaveText('Von der Besitzerin und von Bob')
  await expect(blockInput(bob.page, 0)).toHaveAttribute('contenteditable', 'false')
  await bob.page.context().close()
})
