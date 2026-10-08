import { randomUUID } from 'node:crypto'
import { test as base, expect, type Locator, type Page } from '@playwright/test'

export const PASSWORD = 'correct horse battery'

/**
 * Registers a fresh account (the session cookie is shared with the page) and opens its
 * workspace. A new account per test and retry keeps server-side data isolated.
 */
export async function signIn(page: Page): Promise<string> {
  const email = `e2e-${randomUUID()}@example.com`
  const response = await page.request.post('/api/auth/register', {
    data: { email, password: PASSWORD },
  })
  expect(response.ok()).toBe(true)
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  return email
}

/** Simulates a server outage: every API request fails, the SPA's files are still served. */
export async function takeServerDown(page: Page): Promise<void> {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
}

/** Clicks a button that creates a page and waits until the new, empty page is shown. */
export async function createVia(page: Page, button: string, title: string): Promise<void> {
  await createWith(page, page.getByRole('button', { name: button, exact: true }).first(), title)
}

/** Creates a sub-page of the open page through its ⋯ menu. */
export async function newSubpage(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'Seitenmenü' }).click()
  // The tree's per-page buttons share the label; take the one in the open menu.
  await createWith(
    page,
    page.locator('.page-menu-list').getByRole('button', { name: 'Unterseite anlegen' }),
    title,
  )
}

async function createWith(page: Page, button: Locator, title: string): Promise<void> {
  const before = page.url()
  await button.click()
  await page.waitForURL((url) => url.href !== before && url.pathname.includes('/p/'))
  await expect(page.getByLabel('Titel')).toHaveValue('')
  await page.getByLabel('Titel').fill(title)
  await page.getByLabel('Titel').press('Enter')
}

export async function newPage(page: Page, title: string): Promise<void> {
  await createVia(page, 'Neue Seite', title)
}

/** Waits until all pending block saves are written to IndexedDB. */
export async function waitForSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('saved')).toBeVisible()
  // Debounced saves start after 400 ms; wait past that and for the indicator again.
  await page.waitForTimeout(600)
  await expect(page.getByTestId('saved')).toBeVisible()
}

export function blocks(page: Page) {
  return page.locator('.editor .block')
}

/** Editable part of the n-th block (without handle and list marker). */
export function blockInput(page: Page, index: number) {
  return blocks(page).nth(index).locator('.block-input')
}

export const test = base.extend<{ signedIn: Page }>({
  signedIn: async ({ page }, use) => {
    await signIn(page)
    await use(page)
  },
})

export { expect }
