import { readFileSync } from 'node:fs'
import path from 'node:path'
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
    .getByRole('dialog', { name: 'Abmelden' })
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
  // No server history and no offline hint without an account (#200).
  await expect(page.getByLabel('Mit Verlauf')).toHaveCount(0)
  await expect(page.getByTestId('export-history-hint')).toHaveText(
    'Ohne Konto gibt es keinen Verlauf auf einem Server; exportiert wird der aktuelle Stand.',
  )
  await expect(page.getByTestId('import-account-hint')).toContainText('in diesen Bereich')
  await expect(page.getByRole('button', { name: 'Alles exportieren' })).toBeVisible()
  await page.getByText('Weitere Formate').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON herunterladen' }).click()
  const download = await downloadPromise
  const data = JSON.parse(readFileSync((await download.path())!, 'utf8'))
  expect(data.documents.map((d: { title: string }) => d.title)).toContain('Exportiert ohne Konto')
})

test('imports a backup without an account into the local area (ADR 0023)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')
  await page.getByRole('link', { name: 'Export & Import' }).click()
  await page
    .getByTestId('import-file')
    .setInputFiles(
      path.join(import.meta.dirname, '../../../packages/contract-tests/fixtures/exports/v3.zip'),
    )
  await expect(page.getByTestId('import-summary')).toBeVisible()
  await page.getByLabel('Name der neuen Seite').fill('Aus der Sicherung')
  await page.getByRole('button', { name: 'In diesen Bereich importieren' }).click()

  await expect(page.getByLabel('Titel')).toHaveValue('Aus der Sicherung')
  const tree = page.getByRole('tree')
  const holder = tree.getByRole('treeitem').filter({ hasText: 'Aus der Sicherung' })
  await holder.getByRole('button', { name: 'Aufklappen' }).first().click()
  await expect(holder).toContainText('Projekte 2026')
  await expect(holder).toContainText('Projekte')
  // Still only on this device: nothing was sent.
  await expect(page.getByTestId('connection')).toContainText('Nur auf diesem Gerät')
})
