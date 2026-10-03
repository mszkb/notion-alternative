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
  await other.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(other.locator('a.attachment-file')).toHaveCount(0, { timeout: 10_000 })
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
