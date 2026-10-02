import { blockInput, blocks, expect, newPage, takeServerDown, test, waitForSaved } from './fixtures'

test.describe('offline (docs/testing/test-matrix.md)', () => {
  test('T-OFF-01: local pages stay readable when the server is down', async ({
    signedIn: page,
  }) => {
    await newPage(page, 'Offline lesbar')
    await page.keyboard.type('Inhalt ohne Server')
    await waitForSaved(page)
    const url = page.url()

    await takeServerDown(page)
    await page.goto(url)

    await expect(page.getByTestId('connection')).toHaveText(/Offline – lokale Daten/)
    await expect(page.getByLabel('Titel')).toHaveValue('Offline lesbar')
    await expect(blockInput(page, 0)).toHaveText('Inhalt ohne Server')
    await expect(page.getByRole('tree')).toContainText('Offline lesbar')
  })

  test('T-OFF-02: offline edits survive a reload', async ({ signedIn: page }) => {
    await newPage(page, 'Offline bearbeiten')
    await waitForSaved(page)
    const pendingBefore = await page.getByTestId('pending').textContent()

    await takeServerDown(page)
    await page.reload()
    await expect(page.getByTestId('connection')).toHaveText(/Offline/)

    await blockInput(page, 0).click()
    await page.keyboard.type('Offline geschrieben')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- zweiter Block')
    await page.getByLabel('Titel').fill('Offline bearbeitet')
    await page.getByLabel('Titel').blur()
    await waitForSaved(page)

    await page.reload()
    await expect(page.getByLabel('Titel')).toHaveValue('Offline bearbeitet')
    await expect(blockInput(page, 0)).toHaveText('Offline geschrieben')
    await expect(blocks(page).nth(1)).toHaveClass(/block-list-item/)
    await expect(blockInput(page, 1)).toHaveText('zweiter Block')
    // Every change was queued as an operation for the later sync.
    await expect(page.getByTestId('pending')).not.toHaveText(pendingBefore ?? '')
  })

  test('network loss in a loaded app does not block editing or navigation', async ({
    signedIn: page,
    context,
  }) => {
    await newPage(page, 'Erste Seite')
    await waitForSaved(page)

    await context.setOffline(true)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(page.getByTestId('connection')).toHaveText(/Offline/)

    await newPage(page, 'Zweite Seite')
    await page.keyboard.type('ohne Netz angelegt')
    await waitForSaved(page)
    await page.getByRole('tree').getByRole('link', { name: 'Erste Seite' }).click()
    await expect(page.getByLabel('Titel')).toHaveValue('Erste Seite')
    await page.getByRole('tree').getByRole('link', { name: 'Zweite Seite' }).click()
    await expect(blockInput(page, 0)).toHaveText('ohne Netz angelegt')
    await context.setOffline(false)
  })
})
