import { blockInput, expect, newPage, takeServerDown, test, waitForSaved } from './fixtures'

test.describe('sync push', () => {
  test('local changes are pushed and leave the queue', async ({ signedIn: page }) => {
    await newPage(page, 'Synchronisiert')
    await page.keyboard.type('Inhalt')
    await waitForSaved(page)
    await expect(page.getByTestId('pending')).toHaveText(/^0 lokale Änderungen/, {
      timeout: 10_000,
    })
    await expect(page.getByTestId('sync-conflicts')).toHaveCount(0)
    await expect(page.getByTestId('sync-rejected')).toHaveCount(0)
  })

  test('T-OFF-04: with the server down the queue grows; it is sent once it is back', async ({
    signedIn: page,
  }) => {
    await newPage(page, 'Später senden')
    await waitForSaved(page)
    await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })

    await takeServerDown(page)
    await blockInput(page, 0).click()
    await page.keyboard.type('offline geschrieben')
    await page.keyboard.press('Enter')
    await page.keyboard.type('zweiter Block')
    await waitForSaved(page)
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('pending')).not.toHaveText(/^0 /)

    await page.unroute('**/api/**')
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
  })
})

test('manual full re-sync keeps pages and unsynced work', async ({ signedIn: page }) => {
  await newPage(page, 'Bleibt erhalten')
  await page.keyboard.type('Text')
  await waitForSaved(page)
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })

  await page.getByRole('link', { name: 'Konto' }).click()
  await page.getByRole('button', { name: 'Neu synchronisieren' }).click()
  await expect(page.getByTestId('resync-done')).toBeVisible({ timeout: 10_000 })

  await page.goBack()
  await expect(page.getByRole('tree')).toContainText('Bleibt erhalten')
  await expect(blockInput(page, 0)).toHaveText('Text')
})
