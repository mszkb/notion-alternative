import { devices } from '@playwright/test'
import { expect, PASSWORD, signIn, test } from './fixtures'

test('offers its own install button when the browser allows installing', async ({
  signedIn: page,
}) => {
  const button = page.getByRole('button', { name: 'App installieren' })
  await expect(button).toHaveCount(0)
  // What Chromium does when the app is installable (manifest + service worker).
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string }>
    }
    event.prompt = async () => {
      ;(window as unknown as { prompted: boolean }).prompted = true
    }
    event.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(event)
  })
  await button.click()
  expect(await page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)).toBe(
    true,
  )
  await expect(button).toHaveCount(0)
})

test('shows the iOS home screen hint until dismissed', async ({ page, browser }) => {
  const email = await signIn(page)
  // iPhone viewport, touch and user agent, rendered by Chromium.
  const { defaultBrowserType, ...iphone } = devices['iPhone 13']
  void defaultBrowserType
  const context = await browser.newContext(iphone)
  const phone = await context.newPage()
  await phone.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await phone.goto('/')
  await expect(phone).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await phone.getByRole('button', { name: 'Navigation' }).click()

  const hint = phone.getByTestId('ios-install-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText('Zum Home-Bildschirm')
  await hint.getByRole('button', { name: 'Ausblenden' }).click()
  await expect(hint).toHaveCount(0)
  await phone.reload()
  await expect(phone).toHaveURL(/\/w\/[0-9a-f-]+$/)
  await expect(phone.getByTestId('ios-install-hint')).toHaveCount(0)
  await context.close()
})
