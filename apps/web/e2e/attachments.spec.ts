import type { Browser, Page } from '@playwright/test'
import { expect, newPage, PASSWORD, signIn, takeServerDown, test, waitForSaved } from './fixtures'

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

async function secondDevice(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  return page
}

async function synced(page: Page) {
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })
}

async function imageLoaded(page: Page) {
  const image = page.locator('.attachment img')
  await expect(image).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1)
}

test('images and files: added, shown, available on a second device, deleted', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Mit Anhängen')
  await waitForSaved(page)
  await page.getByTestId('attachment-input').setInputFiles([
    { name: 'punkt.png', mimeType: 'image/png', buffer: PNG },
    { name: 'bericht.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
  ])
  await imageLoaded(page)
  const file = page.locator('a.attachment-file')
  await expect(file).toContainText('bericht.pdf')
  await expect(file).toHaveAttribute('download', 'bericht.pdf')
  await synced(page)

  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Mit Anhängen').click()
  await imageLoaded(other)
  await expect(other.locator('a.attachment-file')).toContainText('bericht.pdf')

  // Delete the PDF on the first device; the second follows.
  const pdfBlock = page.locator('.block.block-file')
  await pdfBlock.hover()
  await pdfBlock.getByRole('button', { name: 'Blockmenü' }).click()
  await page.getByRole('menuitem', { name: 'Anhang löschen' }).click()
  await expect(page.locator('a.attachment-file')).toHaveCount(0)
  await synced(page)
  // "0 pending" can be read before the live query counted the deletion, so the first focus
  // sync may run before the push (#100); a later trigger picks it up, as in normal use.
  await expect(async () => {
    await other.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(other.locator('a.attachment-file')).toHaveCount(0, { timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await other.context().close()
})

test('all attachments can be made available offline at once, with progress', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await newPage(page, 'Für unterwegs')
  await waitForSaved(page)
  await page.getByTestId('attachment-input').setInputFiles([
    { name: 'punkt.png', mimeType: 'image/png', buffer: PNG },
    { name: 'bericht.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') },
  ])
  await imageLoaded(page)
  await synced(page)

  // The second device has the metadata, but loads contents only on demand (ADR 0012).
  const other = await secondDevice(browser, email)
  await expect(other.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
    timeout: 15_000,
  })
  await other.goto('/account')
  const totals = other.getByTestId('offline-attachments')
  await expect(totals).toContainText('0 von 2 Anhängen')
  // Retried until the first device has uploaded both contents.
  await expect(async () => {
    await other.getByRole('button', { name: 'Alle Anhänge offline verfügbar machen' }).click()
    await expect(totals).toContainText('2 von 2 Anhängen', { timeout: 3_000 })
  }).toPass({ timeout: 15_000 })
  await expect(other.getByTestId('offline-attachments-result')).toContainText('geladen')
  await expect(
    other.getByRole('button', { name: 'Alle Anhänge offline verfügbar machen' }),
  ).toBeDisabled()

  // Pages load on demand too (ADR 0017): make everything available before going offline.
  await other.getByTestId('make-offline').click()
  await expect(other.getByTestId('make-offline-result')).toContainText('Alle Seiten')

  // Without the server, the page shows its image from this device.
  await takeServerDown(other)
  await other.goto('/')
  await other.getByRole('tree').getByText('Für unterwegs').click()
  await imageLoaded(other)
  await expect(other.locator('a.attachment-file')).toContainText('bericht.pdf')
  await other.context().close()
})

test('an image added offline is shown at once and synced later', async ({ page, browser }) => {
  const email = await signIn(page)
  await newPage(page, 'Offline-Bild')
  await waitForSaved(page)
  await synced(page)

  await takeServerDown(page)
  await page.getByTestId('attachment-input').setInputFiles({
    name: 'offline.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await imageLoaded(page)
  await page.waitForTimeout(2000)
  await expect(page.getByTestId('pending')).not.toHaveText(/^0 /)

  await page.unroute('**/api/**')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await synced(page)

  const other = await secondDevice(browser, email)
  await other.getByRole('tree').getByText('Offline-Bild').click()
  await imageLoaded(other)
  await other.context().close()
})

test('a file beyond the storage limit stays on the device and is marked', async ({
  signedIn: page,
}) => {
  await newPage(page, 'Zu viel')
  await waitForSaved(page)
  await page.getByTestId('attachment-input').setInputFiles({
    name: 'gross.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(60 * 1024, 1),
  })
  // Kept locally and downloadable here …
  await expect(page.locator('a.attachment-file')).toContainText('gross.bin')
  // … but refused by the server with a clear reason.
  await expect(page.getByTestId('attachment-refused')).toContainText('Workspace-Speicher voll', {
    timeout: 10_000,
  })
  await expect(page.getByTestId('sync-rejected')).toBeVisible()

  await page.getByRole('link', { name: 'Konto' }).click()
  await expect(page.getByTestId('server-usage')).toContainText(/0 B\s+von 50,0 KB belegt/)
})
