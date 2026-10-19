import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { blockInput, expect, newPage, PASSWORD, signIn, test, waitForSaved } from './fixtures'

/** Taking over the pages made without an account when signing in (ADR 0023, #182, #183). */

async function openLoginForm(page: Page, mode: 'login' | 'register') {
  await page.getByTestId('sign-in').click()
  await expect(page).toHaveURL(/\/login$/)
  if (mode === 'register') await page.getByRole('button', { name: 'Neues Konto erstellen' }).click()
}

async function submitForm(page: Page, email: string, mode: 'login' | 'register') {
  await page.getByLabel('E-Mail').fill(email)
  await page.getByLabel('Passwort').fill(PASSWORD)
  await page.getByRole('button', { name: mode === 'login' ? 'Anmelden' : 'Registrieren' }).click()
}

async function signOut(page: Page) {
  await page.goto('/?choose=1')
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await page
    .getByRole('region', { name: 'Abmelden' })
    .getByRole('button', { name: 'Abmelden', exact: true })
    .click()
  await expect(page).toHaveURL(/\/login$/)
}

test('registering takes the local pages along without asking; a second device sees them', async ({
  page,
  browser,
}) => {
  await page.goto('/')
  await newPage(page, 'Lokale Notiz')
  await blockInput(page, 0).click()
  await page.keyboard.type('Geschrieben ohne Konto')
  await waitForSaved(page)

  const email = `e2e-${randomUUID()}@example.com`
  await openLoginForm(page, 'register')
  await submitForm(page, email, 'register')

  await expect(page.getByRole('heading', { name: '1 Seite übernommen' })).toBeVisible()
  await page.getByTestId('takeover-open').click()
  await expect(page.getByTestId('connection')).toContainText('Server verbunden')
  await expect(page.getByRole('tree')).toContainText('Lokale Notiz')
  await expect(page.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
    timeout: 15_000,
  })

  const other = await (await browser.newContext()).newPage()
  const login = await other.request.post('/api/auth/login', {
    data: { email, password: PASSWORD },
  })
  expect(login.ok()).toBe(true)
  await other.goto('/')
  await other.getByRole('tree').getByText('Lokale Notiz').click()
  await expect(blockInput(other, 0)).toHaveText('Geschrieben ohne Konto')
  await other.context().close()
})

test('an account with pages asks where to; existing pages stay as they are', async ({ page }) => {
  const email = await signIn(page)
  await newPage(page, 'Schon im Konto')
  await waitForSaved(page)
  await expect(page.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
    timeout: 15_000,
  })
  await signOut(page)
  await page.getByTestId('without-account').click()
  await newPage(page, 'Vom Gerät')
  await waitForSaved(page)

  await openLoginForm(page, 'login')
  await submitForm(page, email, 'login')

  await expect(page.getByRole('heading', { name: 'Wohin mit deinen Seiten?' })).toBeVisible()
  await page.getByRole('radio', { name: 'Personal' }).check()
  await expect(page.getByTestId('takeover-preview')).toContainText(
    '1 Seite kommt in „Personal“ unter die neue Seite „Von diesem Gerät (',
  )
  await page.getByRole('button', { name: 'Seiten übernehmen' }).click()
  await expect(page.getByRole('heading', { name: '1 Seite übernommen' })).toBeVisible()
  await page.getByTestId('takeover-open').click()

  await expect(page.getByLabel('Titel')).toHaveValue(/^Von diesem Gerät \(\d\d\.\d\d\.\d{4}\)$/)
  const tree = page.getByRole('tree')
  await expect(tree).toContainText('Schon im Konto')
  const holder = tree.getByRole('treeitem').filter({ hasText: 'Von diesem Gerät' })
  await holder.getByRole('button', { name: 'Aufklappen' }).first().click()
  await expect(holder).toContainText('Vom Gerät')
  await expect(page.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
    timeout: 15_000,
  })

  // Reload: no second question, nothing twice.
  await page.reload()
  await expect(page).not.toHaveURL(/takeover/)
  await expect(tree.getByText('Vom Gerät', { exact: true })).toHaveCount(1)

  // The pages are in the account now: without an account the local area starts empty.
  await signOut(page)
  await page.getByTestId('without-account').click()
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')
  await expect(page.getByRole('tree')).not.toContainText('Vom Gerät')
})

test('can move the local pages into a new workspace instead', async ({ page }) => {
  const email = await signIn(page)
  await newPage(page, 'Schon im Konto')
  await waitForSaved(page)
  await signOut(page)
  await page.getByTestId('without-account').click()
  await newPage(page, 'Eigener Bereich')
  await waitForSaved(page)

  await openLoginForm(page, 'login')
  await submitForm(page, email, 'login')
  await page.getByRole('radio', { name: 'Neuer Workspace' }).check()
  await page.getByLabel('Name des neuen Workspace').fill('Vom Laptop')
  await page.getByRole('button', { name: 'Seiten übernehmen' }).click()
  await page.getByTestId('takeover-open').click()

  await expect(page.getByRole('tree')).toContainText('Eigener Bereich')
  await expect(page.getByRole('tree')).not.toContainText('Schon im Konto')
  await page.goto('/?choose=1')
  await expect(page.getByRole('link', { name: 'Vom Laptop' })).toBeVisible()
})

test('without local pages signing in shows no takeover', async ({ page }) => {
  const email = await signIn(page)
  await signOut(page)
  await page.getByTestId('without-account').click()
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')

  await openLoginForm(page, 'login')
  await submitForm(page, email, 'login')

  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(page.getByTestId('connection')).toContainText('Server verbunden')
})
