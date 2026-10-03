import { expect, test } from '@playwright/test'

test.describe('installable PWA', () => {
  test('links a valid manifest with icons and iOS meta tags', async ({ page }) => {
    await page.goto('/login')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBe('/manifest.webmanifest')

    const manifest = await (await page.request.get(href!)).json()
    expect(manifest).toMatchObject({
      start_url: '/',
      scope: '/',
      display: 'standalone',
      short_name: expect.any(String),
    })
    const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
    for (const icon of manifest.icons) {
      const response = await page.request.get(icon.src)
      expect(response.ok(), icon.src).toBe(true)
    }

    const appleIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href')
    expect((await page.request.get(appleIcon!)).ok()).toBe(true)
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
      'content',
      'yes',
    )
  })
})
