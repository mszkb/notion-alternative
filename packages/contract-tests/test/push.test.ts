import { createECDH, randomUUID } from 'node:crypto'
import { describe, expect, inject, it } from 'vitest'
import {
  type Account,
  Client,
  docPayload,
  login,
  op,
  push,
  registerDevice,
  signUp,
} from '../src/client'
import { decryptPushMessage } from '../src/push-crypto'
import type { Delivery } from '../src/push-receiver'

/**
 * Web Push (ADR 0005) against the fake push service of the suite (HTTPS on 127.0.0.1 with
 * `fixtures/push-receiver.crt`). The server must allow the host (PUSH_ALLOWED_HOSTS=127.0.0.1)
 * and trust the certificate. Hints are sent asynchronously (bundled), so the tests poll.
 */

const endpoint = (key: string, mode: 'send' | 'gone' = 'send') =>
  `${inject('pushEndpointBase')}/${mode}/${key}`

async function deliveries(key: string): Promise<Delivery[]> {
  const response = await fetch(`${inject('pushControl')}/deliveries/${key}`)
  return (await response.json()) as Delivery[]
}

async function waitForDeliveries(key: string, timeoutMs = 15_000): Promise<Delivery[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const list = await deliveries(key)
    if (list.length > 0) return list
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`no push delivery for ${key}`)
}

/** Longer than the Node server bundles hints (2 s), so a missing delivery is really missing. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 4000))

function subscriptionKeys(seed = 1) {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: Buffer.alloc(16, seed).toString('base64url'),
    },
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  }
}

const subscribe = (client: Client, url: string, keys = subscriptionKeys().keys) =>
  client.post('/api/push/subscriptions', { endpoint: url, keys })

/** A device of the account with its own session and (optionally) a push subscription. */
async function device(account: Account, options: { subscribe?: boolean; gone?: boolean } = {}) {
  const client = await login(account)
  const id = await registerDevice(client, 'Gerät')
  const { keys, privateKey } = subscriptionKeys(id.charCodeAt(0))
  const url = endpoint(id, options.gone ? 'gone' : 'send')
  if (options.subscribe ?? true) {
    expect((await subscribe(client, url, keys)).status).toBe(204)
  }
  return { id, client, key: id, privateKey, auth: keys.auth }
}

const createDoc = (account: Account, deviceId: string, title: string) =>
  op({ ...account, deviceId }, 'document', 'create', randomUUID(), docPayload(title))

describe('GET /api/push/public-key', () => {
  it('serves a stable VAPID public key to signed-in users', async () => {
    expect((await new Client().get('/api/push/public-key')).status).toBe(401)
    const { client } = await signUp({ device: false })
    const first = await client.get('/api/push/public-key')
    expect(first.status).toBe(200)
    expect(first.json().publicKey).toMatch(/^B[A-Za-z0-9_-]{86}$/)
    const other = await signUp({ device: false })
    expect((await other.client.get('/api/push/public-key')).json()).toEqual(first.json())
  })
})

describe('POST/DELETE /api/push/subscriptions', () => {
  it('accepts only registered devices and allowed push services; unsubscribe removes', async () => {
    const account = await signUp({ device: false })
    const url = endpoint(randomUUID())
    const unregistered = await subscribe(account.client, url)
    expect(unregistered.status).toBe(409)
    expect(unregistered.json().error.code).toBe('device_not_registered')

    await registerDevice(account.client)
    const evil = await subscribe(account.client, 'https://evil.example/x')
    expect(evil.status).toBe(400)
    expect(evil.json().error.code).toBe('endpoint_not_allowed')
    expect((await subscribe(account.client, url.replace('https:', 'http:'))).status).toBe(400)
    expect((await subscribe(account.client, url)).status).toBe(204)
    // Subscribing again (e.g. new keys) is fine.
    expect((await subscribe(account.client, url)).status).toBe(204)

    expect((await account.client.delete('/api/push/subscriptions', { endpoint: url })).status).toBe(
      204,
    )
    const invalid = await account.client.delete('/api/push/subscriptions', { endpoint: 'nope' })
    expect(invalid.status).toBe(400)
    expect(invalid.json().error.code).toBe('invalid_input')
    expect(
      (await account.client.fork().delete('/api/push/subscriptions', { endpoint: url })).status,
    ).toBe(401)
    expect((await subscribe(account.client.fork(), url)).status).toBe(401)
  })

  it('rejects unusable keys and never hands an endpoint to another account', async () => {
    const alice = await signUp({ name: 'alice' })
    const url = endpoint(randomUUID())
    expect((await subscribe(alice.client, url)).status).toBe(204)
    const auth = Buffer.alloc(16, 2).toString('base64url')
    // Wrong lengths, and the right length but not a point on the curve.
    const short = await subscribe(alice.client, endpoint(randomUUID()), {
      p256dh: 'AAAA',
      auth: 'BBBB',
    })
    expect(short.status).toBe(400)
    expect(short.json().error.code).toBe('invalid_input')
    const offCurve = await subscribe(alice.client, endpoint(randomUUID()), {
      p256dh: `B${'A'.repeat(86)}`,
      auth,
    })
    expect(offCurve.status).toBe(400)
    expect(offCurve.json().error.code).toBe('invalid_keys')

    const mallory = await signUp({ name: 'mallory' })
    const takeover = await subscribe(mallory.client, url)
    expect(takeover.status).toBe(409)
    expect(takeover.json().error.code).toBe('endpoint_taken')
    // Removing it as Mallory does nothing to Alice's subscription.
    await mallory.client.delete('/api/push/subscriptions', { endpoint: url })
    expect((await subscribe(mallory.client, url)).status).toBe(409)
  })

  it('limits the subscriptions per account', async () => {
    const account = await signUp()
    for (let i = 0; i < 20; i++) {
      expect((await subscribe(account.client, endpoint(randomUUID()))).status).toBe(204)
    }
    const tooMany = await subscribe(account.client, endpoint(randomUUID()))
    expect(tooMany.status).toBe(409)
    expect(tooMany.json().error.code).toBe('too_many_subscriptions')
  })
})

describe('push hints', () => {
  it('T-PWA-03: hints the other devices, without any content', async () => {
    const account = await signUp({ device: false })
    const laptop = await device(account)
    const phone = await device(account)

    await push(account, createDoc(account, laptop.id, 'Geheimer Titel'))
    await push(account, createDoc(account, laptop.id, 'Noch ein Titel'))

    const [delivery] = await waitForDeliveries(phone.key)
    expect(delivery!.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      ttl: expect.stringMatching(/^\d+$/),
      authorization: expect.stringMatching(/^vapid t=.+, k=B/),
    })
    const body = Buffer.from(delivery!.body, 'base64')
    const hint = JSON.parse(decryptPushMessage(body, phone.privateKey, phone.auth))
    expect(Object.keys(hint).sort()).toEqual(['installation', 'type', 'workspace'])
    expect(hint).toMatchObject({ type: 'sync_available', workspace: account.workspaceId })
    expect(JSON.stringify(hint)).not.toContain('Titel')

    // The device that made the change is not hinted.
    await settle()
    expect(await deliveries(laptop.key)).toEqual([])
  })

  it('drops subscriptions the push service reports as gone', async () => {
    const account = await signUp({ device: false })
    const writer = await device(account, { subscribe: false })
    const gone = await device(account, { gone: true })

    await push(account, createDoc(account, writer.id, 'x'))
    expect(await waitForDeliveries(gone.key)).toHaveLength(1)

    await settle()
    await push(account, createDoc(account, writer.id, 'y'))
    await settle()
    expect(await deliveries(gone.key)).toHaveLength(1)
  })
})
