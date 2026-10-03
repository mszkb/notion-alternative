import type { Page } from '@playwright/test'
import { blockInput, expect, newPage, test, waitForSaved } from './fixtures'

const localDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases()).map((db) => db.name).filter((n) => n?.startsWith('notion-alt-')),
  )

async function openSignOut(page: Page) {
  await page.goto('/?choose=1')
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Abmelden' })).toBeVisible()
}

test('signing out keeps local data by default', async ({ signedIn: page }) => {
  await newPage(page, 'Bleibt lokal')
  await waitForSaved(page)
  await openSignOut(page)
  await page
    .getByRole('region', { name: 'Abmelden' })
    .getByRole('button', { name: 'Abmelden', exact: true })
    .click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await localDatabases(page)).toHaveLength(1)
})

test('deleting local data with unsynced changes needs explicit confirmation', async ({
  signedIn: page,
}) => {
  // Sync is blocked, so the changes stay in the queue.
  await page.route('**/api/sync/**', (route) => route.abort('connectionrefused'))
  await newPage(page, 'Nicht synchronisiert')
  await blockInput(page, 0).click()
  await page.keyboard.type('geheim')
  await waitForSaved(page)

  await openSignOut(page)
  const dialog = page.getByRole('region', { name: 'Abmelden' })
  await dialog.getByLabel('Lokale Daten auf diesem Gerät löschen').check()
  await expect(dialog.getByTestId('unsynced-warning')).toContainText('noch nicht synchronisiert')

  const confirm = dialog.getByRole('button', { name: 'Abmelden und lokale Daten löschen' })
  await confirm.click()
  await expect(page.getByRole('alert')).toContainText('bestätigen')
  expect(await localDatabases(page)).toHaveLength(1)

  await dialog.getByLabel('Nicht synchronisierte Änderungen verwerfen').check()
  await confirm.click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await localDatabases(page)).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem('notion-alt.lastUser'))).toBeNull()
})
