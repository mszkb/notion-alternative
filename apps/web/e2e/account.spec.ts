import { expect, takeServerDown, test } from './fixtures'

test.describe('account', () => {
  test('changes the password from the account page', async ({ signedIn: page }) => {
    await page.getByRole('link', { name: 'Konto' }).click()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByTestId('storage-usage')).toContainText(/belegt/)

    await page.getByLabel('Aktuelles Passwort').fill('wrong password')
    await page.getByLabel('Neues Passwort', { exact: true }).fill('a brand new passphrase')
    await page.getByLabel('Neues Passwort wiederholen').fill('a brand new passphrase')
    await page.getByRole('button', { name: 'Passwort ändern' }).click()
    await expect(page.getByRole('alert')).toHaveText('Das aktuelle Passwort ist falsch.')

    await page.getByLabel('Aktuelles Passwort').fill('correct horse battery')
    await page.getByRole('button', { name: 'Passwort ändern' }).click()
    await expect(page.getByRole('status')).toContainText('Passwort geändert')

    // The current session stays valid.
    const me = await page.request.get('/api/auth/me')
    expect(me.ok()).toBe(true)
  })

  test('is disabled without a server connection', async ({ signedIn: page }) => {
    await takeServerDown(page)
    await page.goto('/account')
    await expect(page.getByTestId('password-offline')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Passwort ändern' })).toBeDisabled()
  })
})
