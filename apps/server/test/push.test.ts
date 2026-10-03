import { createECDH, randomUUID } from 'node:crypto'
import type { Operation } from '@notion-alt/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config'
import { isAllowedEndpoint } from '../src/push/service'
import { createTestApp, PASSWORD, register, sessionCookie, type TestApp } from './helpers'
import { decryptPushMessage } from './push-helpers'

interface Delivery {
  url: string
  headers: Record<string, string>
  body: Buffer
}

let app: TestApp
let deliveries: Delivery[]
let answer = 201
let workspaceId: string

/** A device of Alice with its own session and (optionally) a push subscription. */
async function device(cookie: string, subscribe = true) {
  const id = randomUUID()
  await app.inject({
    method: 'POST',
    url: '/api/devices',
    headers: { cookie },
    payload: { id, name: id.slice(0, 8) },
  })
  const keys = createECDH('prime256v1')
  keys.generateKeys()
  const auth = Buffer.alloc(16, id.charCodeAt(0)).toString('base64url')
  const endpoint = `https://push.test/send/${id}`
  if (subscribe) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { cookie },
      payload: { endpoint, keys: { p256dh: keys.getPublicKey().toString('base64url'), auth } },
    })
    expect(response.statusCode).toBe(204)
  }
  return { id, cookie, endpoint, privateKey: keys.getPrivateKey().toString('base64url'), auth }
}

async function login() {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'alice@example.com', password: PASSWORD },
  })
  return sessionCookie(response)
}

function createDoc(deviceId: string, title: string): Operation {
  return {
    opId: randomUUID(),
    deviceId,
    workspaceId,
    entity: 'document',
    entityId: randomUUID(),
    kind: 'create',
    baseRevision: null,
    payload: { parentId: null, title, sortKey: 'a0', favorite: false, createdAt: 'x' },
    createdAt: new Date().toISOString(),
  }
}

async function push(cookie: string, operations: Operation[]) {
  await app.inject({
    method: 'POST',
    url: '/api/sync/push',
    headers: { cookie },
    payload: { operations },
  })
}

beforeEach(async () => {
  deliveries = []
  answer = 201
  ;({ app } = await createTestApp(
    { push: { subject: 'mailto:test@example.com', allowedHosts: ['push.test'] } },
    {
      push: {
        delayMs: 60_000, // flushed explicitly with settle()
        fetchImpl: async (url, init) => {
          deliveries.push({
            url: String(url),
            headers: init!.headers as Record<string, string>,
            body: Buffer.from(init!.body as Uint8Array),
          })
          return new Response(null, { status: answer })
        },
      },
    },
  ))
})
afterEach(() => app.close())

describe('Web Push', () => {
  it('serves a stable VAPID public key to signed-in users', async () => {
    expect((await app.inject('/api/push/public-key')).statusCode).toBe(401)
    const { cookie } = await register(app, 'alice@example.com')
    const first = (await app.inject({ url: '/api/push/public-key', headers: { cookie } })).json()
    const second = (await app.inject({ url: '/api/push/public-key', headers: { cookie } })).json()
    expect(first.publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/)
    expect(second).toEqual(first)
  })

  it('T-PWA-03: hints the other devices, without any content, once per burst', async () => {
    const { cookie } = await register(app, 'alice@example.com')
    workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
      .workspaces[0].id
    const laptop = await device(cookie)
    const phone = await device(await login())

    await push(laptop.cookie, [createDoc(laptop.id, 'Geheimer Titel')])
    await push(laptop.cookie, [createDoc(laptop.id, 'Noch ein Titel')])
    await app.pushNotifier.settle()

    // Only the phone, once for both pushes; the laptop made the change itself.
    expect(deliveries.map((d) => d.url)).toEqual([phone.endpoint])
    const [delivery] = deliveries
    expect(delivery!.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: expect.stringMatching(/^vapid t=.+, k=B/),
    })
    const hint = JSON.parse(decryptPushMessage(delivery!.body, phone.privateKey, phone.auth))
    expect(Object.keys(hint).sort()).toEqual(['installation', 'type', 'workspace'])
    expect(hint).toMatchObject({ type: 'sync_available', workspace: workspaceId })
    expect(JSON.stringify(hint)).not.toContain('Titel')
  })

  it('drops subscriptions the push service reports as gone', async () => {
    const { cookie } = await register(app, 'alice@example.com')
    workspaceId = (await app.inject({ url: '/api/workspaces', headers: { cookie } })).json()
      .workspaces[0].id
    const laptop = await device(cookie, false)
    await device(await login())
    answer = 410
    await push(laptop.cookie, [createDoc(laptop.id, 'x')])
    await app.pushNotifier.settle()
    expect(deliveries).toHaveLength(1)

    await push(laptop.cookie, [createDoc(laptop.id, 'y')])
    await app.pushNotifier.settle()
    expect(deliveries).toHaveLength(1)
  })

  it('accepts only registered devices and allowed push services; unsubscribe removes', async () => {
    const { cookie } = await register(app, 'alice@example.com')
    const payload = (endpoint: string) => ({
      endpoint,
      keys: { p256dh: 'BAAA', auth: 'AAAA' },
    })
    const subscribe = (endpoint: string) =>
      app.inject({
        method: 'POST',
        url: '/api/push/subscriptions',
        headers: { cookie },
        payload: payload(endpoint),
      })
    expect((await subscribe('https://push.test/x')).json().error.code).toBe('device_not_registered')

    await device(cookie, false)
    expect((await subscribe('https://evil.example/x')).json().error.code).toBe(
      'endpoint_not_allowed',
    )
    expect((await subscribe('http://push.test/x')).statusCode).toBe(400)
    expect((await subscribe('https://push.test/x')).statusCode).toBe(204)
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/push/subscriptions',
      headers: { cookie },
      payload: { endpoint: 'https://push.test/x' },
    })
    expect(removed.statusCode).toBe(204)
  })
})

describe('isAllowedEndpoint', () => {
  it('matches known push services only, over https', () => {
    const hosts = loadConfig({}).push.allowedHosts
    expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc', hosts)).toBe(true)
    expect(isAllowedEndpoint('https://web.push.apple.com/abc', hosts)).toBe(true)
    expect(isAllowedEndpoint('https://push.apple.com.evil.net/abc', hosts)).toBe(false)
    expect(isAllowedEndpoint('https://user:pw@fcm.googleapis.com/x', hosts)).toBe(false)
    expect(isAllowedEndpoint('http://fcm.googleapis.com/x', hosts)).toBe(false)
    expect(isAllowedEndpoint('https://127.0.0.1/x', hosts)).toBe(false)
  })
})
