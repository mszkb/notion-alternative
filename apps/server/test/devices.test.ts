import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { findActiveDevice } from '../src/devices/repository'
import { PASSWORD, createTestApp, register, sessionCookie, type TestApp } from './helpers'

describe('devices', () => {
  let app: TestApp
  let db: Awaited<ReturnType<typeof createTestApp>>['db']
  afterEach(() => app.close())

  function registerDevice(cookie: string, id: string, name = 'Firefox auf Linux') {
    return app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { id, name },
    })
  }

  async function login(email: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    })
    return sessionCookie(response)
  }

  const list = (cookie: string) => app.inject({ url: '/api/devices', headers: { cookie } })

  it('registers idempotently and keeps the stored name', async () => {
    ;({ app, db } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const id = randomUUID()

    const first = await registerDevice(cookie, id)
    expect(first.statusCode).toBe(201)
    expect(first.json().device).toMatchObject({ id, name: 'Firefox auf Linux', current: true })

    await app.inject({
      method: 'PATCH',
      url: `/api/devices/${id}`,
      headers: { cookie },
      payload: { name: 'Laptop' },
    })
    const again = await registerDevice(cookie, id, 'Anderer Name')
    expect(again.statusCode).toBe(200)
    expect(again.json().device.name).toBe('Laptop')

    const devices = (await list(cookie)).json().devices
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id, name: 'Laptop', current: true })
  })

  it('requires authentication and valid input', async () => {
    ;({ app, db } = await createTestApp())
    expect((await app.inject('/api/devices')).statusCode).toBe(401)
    const { cookie } = await register(app, 'alice@example.com')
    expect((await registerDevice(cookie, 'not-a-uuid')).statusCode).toBe(400)
    expect((await registerDevice(cookie, randomUUID(), '  ')).statusCode).toBe(400)
  })

  it('keeps devices of different users apart', async () => {
    ;({ app, db } = await createTestApp({ allowRegistration: true }))
    const alice = (await register(app, 'alice@example.com')).cookie
    const bob = (await register(app, 'bob@example.com')).cookie
    const id = randomUUID()
    await registerDevice(alice, id)

    expect((await registerDevice(bob, id)).statusCode).toBe(409)
    expect((await list(bob)).json().devices).toEqual([])
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/devices/${id}`,
      headers: { cookie: bob },
      payload: { name: 'Gekapert' },
    })
    expect(rename.statusCode).toBe(404)
    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${id}`,
      headers: { cookie: bob },
    })
    expect(remove.statusCode).toBe(404)
  })

  it('removing a device ends its sessions and rejects it for good', async () => {
    ;({ app, db } = await createTestApp())
    const { cookie: laptop } = await register(app, 'alice@example.com')
    const phone = await login('alice@example.com')
    const laptopId = randomUUID()
    const phoneId = randomUUID()
    await registerDevice(laptop, laptopId)
    await registerDevice(phone, phoneId)

    // The device in use cannot remove itself.
    const self = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${laptopId}`,
      headers: { cookie: laptop },
    })
    expect(self.statusCode).toBe(409)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/devices/${phoneId}`,
      headers: { cookie: laptop },
    })
    expect(removed.statusCode).toBe(204)

    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: phone } })).statusCode).toBe(
      401,
    )
    expect((await list(laptop)).json().devices.map((d: { id: string }) => d.id)).toEqual([laptopId])
    const user = (await app.inject({ url: '/api/auth/me', headers: { cookie: laptop } })).json()
      .user
    expect(await findActiveDevice(db, user.id, phoneId)).toBeUndefined()
    expect(await findActiveDevice(db, user.id, laptopId)).toBeDefined()

    // Signing in again does not bring the old id back; the client continues under a new id
    // (#46), and the removed entry stays hidden.
    const relogin = await login('alice@example.com')
    const retry = await registerDevice(relogin, phoneId)
    expect(retry.statusCode).toBe(403)
    expect(retry.json().error.code).toBe('device_revoked')
    const newPhoneId = randomUUID()
    expect((await registerDevice(relogin, newPhoneId)).statusCode).toBe(201)
    expect(
      (await list(laptop))
        .json()
        .devices.map((d: { id: string }) => d.id)
        .sort(),
    ).toEqual([laptopId, newPhoneId].sort())
    expect(await findActiveDevice(db, user.id, phoneId)).toBeUndefined()
  })

  it('ends a session from before the removal that the device never registered with (#46)', async () => {
    ;({ app, db } = await createTestApp())
    const { cookie: laptop } = await register(app, 'alice@example.com')
    const laptopId = randomUUID()
    await registerDevice(laptop, laptopId)
    // Signed in on the phone, registered with one session; a second one stays unlinked
    // (e.g. signed in again, then offline before registering).
    const phone = await login('alice@example.com')
    const unlinked = await login('alice@example.com')
    const phoneId = randomUUID()
    await registerDevice(phone, phoneId)
    await app.inject({
      method: 'DELETE',
      url: `/api/devices/${phoneId}`,
      headers: { cookie: laptop },
    })

    const retry = await registerDevice(unlinked, phoneId)
    expect(retry.statusCode).toBe(401)
    expect(
      (await app.inject({ url: '/api/auth/me', headers: { cookie: unlinked } })).statusCode,
    ).toBe(401)
    // Nothing can be registered with that session any more, not even a new id.
    expect((await registerDevice(unlinked, randomUUID())).statusCode).toBe(401)
  })
})

describe('logout', () => {
  let app: TestApp
  afterEach(() => app.close())

  it('can remove the current device on the way out', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const id = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { id, name: 'Gemeinsamer PC' },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie },
      payload: { removeDevice: true },
    })
    expect(response.statusCode).toBe(204)

    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: PASSWORD },
    })
    const fresh = sessionCookie(again)
    const devices = await app.inject({ url: '/api/devices', headers: { cookie: fresh } })
    expect(devices.json().devices).toEqual([])
  })

  it('keeps the device by default and works without a body', async () => {
    ;({ app } = await createTestApp())
    const { cookie } = await register(app, 'alice@example.com')
    const id = randomUUID()
    await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: { cookie },
      payload: { id, name: 'Laptop' },
    })
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    expect(out.statusCode).toBe(204)
    const again = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com', password: PASSWORD },
    })
    const devices = await app.inject({
      url: '/api/devices',
      headers: { cookie: sessionCookie(again) },
    })
    expect(devices.json().devices.map((d: { id: string }) => d.id)).toEqual([id])
  })
})
