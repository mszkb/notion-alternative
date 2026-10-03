import { PASSWORD, expect, signIn, test } from './fixtures'

test('lists, renames and removes devices; a removed device is signed out and flagged', async ({
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

  // The removed device keeps its local data but loses its session; signing in again is refused.
  expect((await phone.request.get('/api/auth/me')).status()).toBe(401)
  await phone.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await phone.reload()
  await expect(phone.getByTestId('device-revoked')).toBeVisible()
  await other.close()
})
