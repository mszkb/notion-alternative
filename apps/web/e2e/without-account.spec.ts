import { readFileSync } from 'node:fs'
import { blockInput, expect, newPage, test, waitForSaved } from './fixtures'

/** Starting without an account (ADR 0023, #181): no login, no form, no server needed. */

test('a fresh browser writes a page without any form and keeps it after reload', async ({
  page,
}) => {
  const requests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) requests.push(url.pathname)
  })

  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')
  await newPage(page, 'Ohne Konto')
  await blockInput(page, 0).click()
  await page.keyboard.type('Lokal geschrieben')
  await waitForSaved(page)

  await page.reload()
  await expect(page.getByRole('tree')).toContainText('Ohne Konto')
  await page.getByRole('tree').getByText('Ohne Konto').click()
  await expect(blockInput(page, 0)).toHaveText('Lokal geschrieben')

  // Only the startup check whether a session exists; nothing else goes to the server.
  expect(new Set(requests)).toEqual(new Set(['/api/auth/me']))
})

test('works without any server and offers to sign in later', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await page.goto('/')
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await newPage(page, 'Server weg')
  await waitForSaved(page)
  await page.getByTestId('sign-in').click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByTestId('without-account').click()
  await expect(page.getByRole('tree')).toContainText('Server weg')
})

test('after signing out the login offers to continue without an account', async ({
  signedIn: page,
}) => {
  await page.goto('/?choose=1')
  await page.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await page
    .getByRole('region', { name: 'Abmelden' })
    .getByRole('button', { name: 'Abmelden', exact: true })
    .click()
  await expect(page).toHaveURL(/\/login$/)
  await page.reload()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByTestId('without-account').click()
  await expect(page).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')
})

test('exports the local pages without an account (Export first)', async ({ page }) => {
  await page.goto('/')
  await newPage(page, 'Exportiert ohne Konto')
  await waitForSaved(page)
  await page.getByRole('link', { name: 'Export & Import' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON herunterladen' }).click()
  const download = await downloadPromise
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(data.documents.map((d: { title: string }) => d.title)).toContain('Exportiert ohne Konto')
})
