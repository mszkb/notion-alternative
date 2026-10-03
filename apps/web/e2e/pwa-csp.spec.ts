import { expect, newPage, signIn, test, waitForSaved } from './fixtures'

// #74: the production build runs under the Content-Security-Policy of nginx (vite preview serves
// the same headers, see vite.config.ts) without a single violation.

// 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
)

test('the app works under the CSP without violations', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { cspViolations: string[] }
    w.cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) =>
      w.cspViolations.push(
        `${event.violatedDirective}: ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}`,
      ),
    )
  })
  const response = await page.request.get('/login')
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'")
  expect(response.headers()['cross-origin-opener-policy']).toBe('same-origin')
  await signIn(page)

  await newPage(page, 'Unter CSP')
  await page.keyboard.type('**fett** und [Link](https://example.com)')
  await waitForSaved(page)
  await page
    .getByTestId('attachment-input')
    .setInputFiles([{ name: 'punkt.png', mimeType: 'image/png', buffer: PNG }])
  await expect
    .poll(() =>
      page.locator('.attachment img').evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(1)
  await page.getByRole('link', { name: 'Export & Import' }).click()
  await page.getByRole('link', { name: 'Konto' }).click()

  expect(
    await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
  ).toEqual([])
})
