import type { Page } from '@playwright/test'
import { expect, newPage, PASSWORD, signIn, test, waitForSaved } from './fixtures'

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

test('T-PWA-03: a push hint makes the app sync, nothing else needed', async ({ page, browser }) => {
  const email = await signIn(page)
  await controlled(page)
  const cdp = await page.context().newCDPSession(page)
  const registrations: { registrationId: string; scopeURL: string }[] = []
  cdp.on('ServiceWorker.workerRegistrationUpdated', (event) =>
    registrations.push(...event.registrations),
  )
  await cdp.send('ServiceWorker.enable')
  await expect.poll(() => registrations.length).toBeGreaterThan(0)

  // Another device changes something.
  const context = await browser.newContext()
  const other = await context.newPage()
  await other.request.post('/api/auth/login', { data: { email, password: PASSWORD } })
  await other.goto('/')
  await newPage(other, 'Per Push angekündigt')
  await waitForSaved(other)
  await expect(other.getByTestId('pending')).toHaveText(/^0 /, { timeout: 10_000 })

  // Without a trigger this device does not know yet.
  await page.waitForTimeout(1500)
  await expect(page.getByRole('tree')).not.toContainText('Per Push angekündigt')

  // The push service delivers the content-free hint to the service worker.
  const workspace = /\/w\/([0-9a-f-]+)/.exec(page.url())![1]
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin,
    registrationId: registrations[0]!.registrationId,
    data: JSON.stringify({ type: 'sync_available', installation: 'x', workspace }),
  })
  await expect(page.getByRole('tree')).toContainText('Per Push angekündigt', { timeout: 10_000 })
  await context.close()
})

test('T-PWA-02: notifications are switched on only by the user', async ({ page, context }) => {
  await context.grantPermissions(['notifications'])
  // Headless Chromium reaches no real push service: stand in for the browser's subscription.
  await page.addInitScript(() => {
    let active: PushSubscription | null = null
    const fake = {
      endpoint: 'https://push.test/e2e-device',
      toJSON: () => ({
        endpoint: 'https://push.test/e2e-device',
        keys: {
          p256dh:
            'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
          auth: 'BTBZMqHH6r4Tts7J_aSIgg',
        },
      }),
      unsubscribe: async () => {
        active = null
        return true
      },
    } as unknown as PushSubscription
    PushManager.prototype.subscribe = async () => (active = fake)
    PushManager.prototype.getSubscription = async () => active
  })
  await signIn(page)
  await controlled(page)
  await page.goto('/account')
  const state = page.getByTestId('notification-state')
  await expect(state).toHaveText('Aus.')

  const subscribed = page.waitForResponse(
    (r) => r.url().endsWith('/api/push/subscriptions') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Benachrichtigungen aktivieren' }).click()
  expect((await subscribed).status()).toBe(204)
  await expect(state).toHaveText('An für dieses Gerät.')

  await page.getByRole('button', { name: 'Benachrichtigungen deaktivieren' }).click()
  await expect(state).toHaveText('Aus.')
})
