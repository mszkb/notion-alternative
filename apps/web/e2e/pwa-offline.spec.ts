import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { blockInput, expect, newPage, test, waitForSaved } from './fixtures'

const swPath = fileURLToPath(new URL('../dist/sw.js', import.meta.url))

/** Waits until the service worker is active and controls the page. */
async function controlled(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      )
    }
  })
}

test('the service worker controls the app and makes it installable', async ({ signedIn: page }) => {
  await controlled(page)
  const cdp = await page.context().newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  // Playwright contexts are incognito, which alone prevents installing; nothing else may.
  const errors = installabilityErrors.map((error) => error.errorId)
  expect(errors.filter((id) => id !== 'in-incognito')).toEqual([])
})

test('T-OFF-01/02/03 with the network really offline: reload works, edits survive and sync', async ({
  signedIn: page,
  context,
}) => {
  await newPage(page, 'Echt offline')
  await page.keyboard.type('Inhalt')
  await waitForSaved(page)
  await controlled(page)

  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByLabel('Titel')).toHaveValue('Echt offline')
    await expect(blockInput(page, 0)).toHaveText('Inhalt')
    await expect(page.getByTestId('connection')).toHaveText(/Offline/)

    await blockInput(page, 0).click()
    await page.keyboard.press('End')
    await page.keyboard.type(' – offline ergänzt')
    await waitForSaved(page)
    await page.reload()
    await expect(blockInput(page, 0)).toHaveText('Inhalt – offline ergänzt')
  } finally {
    await context.setOffline(false)
  }

  // T-OFF-03: back online, the offline edit reaches the server without any user action.
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByTestId('pending')).toHaveText(/^0 /, { timeout: 15_000 })
  const workspaceId = new URL(page.url()).pathname.split('/')[2]!
  const snapshot = await (
    await page.request.get(`/api/sync/snapshot?workspaceId=${workspaceId}`)
  ).json()
  expect(snapshot.blocks.map((b: { content: string }) => b.content)).toContain(
    'Inhalt – offline ergänzt',
  )
})

test('a new version offers a reload that keeps unsaved edits', async ({ signedIn: page }) => {
  await newPage(page, 'Vor dem Update')
  await waitForSaved(page)
  await controlled(page)

  // Deploy a "new release": the preview server serves the changed service worker.
  const original = await readFile(swPath, 'utf8')
  await writeFile(swPath, `${original}\n// next release\n`)
  try {
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())!.update()
    })
    const banner = page.getByTestId('update-banner')
    await expect(banner).toBeVisible({ timeout: 10_000 })

    // Typed right before reloading: still inside the save debounce.
    await blockInput(page, 0).click()
    await page.keyboard.type('kurz vor dem Neuladen')
    await banner.getByRole('button', { name: 'Neu laden' }).click()
    await page.waitForLoadState('load')
    await expect(blockInput(page, 0)).toHaveText('kurz vor dem Neuladen', { timeout: 10_000 })
    await expect(banner).toHaveCount(0)
  } finally {
    await writeFile(swPath, original)
  }
})
