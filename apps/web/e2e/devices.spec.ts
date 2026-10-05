import { PASSWORD, expect, newPage, signIn, test, waitForSaved } from './fixtures'

test('lists, renames and removes devices; a removed device is signed out and continues as a new device after signing in again', async ({
  page,
  browser,
}) => {
  const email = await signIn(page)
  await page.goto('/account')
  const devices = page.getByRole('list', { name: 'Geräte' })
  await expect(devices.getByRole('listitem')).toHaveCount(1)
  await expect(devices).toContainText('(dieses Gerät)')
  await expect(devices).toContainText(/Chrome auf \w+/)

  await devices.getByRole('button', { name: 'Umbenennen' }).click()
  await page.getByLabel('Gerätename').fill('Arbeitslaptop')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(devices).toContainText('Arbeitslaptop')

  // A second device of the same account (own browser profile, own local database).
  const other = await browser.newContext()
  const phone = await other.newPage()
  const login = await phone.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  expect(login.ok()).toBe(true)
  await phone.goto('/')
  await expect(phone).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(phone.getByTestId('connection')).toHaveText(/Server verbunden/)

  await page.reload()
  await expect(devices.getByRole('listitem')).toHaveCount(2)
  page.once('dialog', (dialog) => void dialog.accept())
  await devices.getByRole('button', { name: 'Entfernen' }).click()
  await expect(devices.getByRole('listitem')).toHaveCount(1)
  await expect(devices).toContainText('Arbeitslaptop')

  // The removed device keeps its local data but loses its session.
  expect((await phone.request.get('/api/auth/me')).status()).toBe(401)
  // It keeps working locally meanwhile (#46).
  await newPage(phone, 'Während entfernt')
  await waitForSaved(phone)

  // Signing in again: it continues as a new device and sends what it queued.
  await phone.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await phone.reload()
  await expect(phone.getByTestId('sync-status')).toHaveText(/^Synchronisiert um/, {
    timeout: 15_000,
  })
  await expect(phone.getByTestId('device-revoked')).toHaveCount(0)
  await page.reload()
  await expect(devices.getByRole('listitem')).toHaveCount(2)
  await page.goto('/')
  await expect(page.getByRole('tree')).toContainText('Während entfernt', { timeout: 15_000 })
  await other.close()
})
