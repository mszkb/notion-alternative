import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { Client, PASSWORD, docPayload, login, op, push, signUp } from '../src/client'

const registerDevice = (client: Client, id: string, name = 'Firefox auf Linux') =>
  client.post('/api/devices', { id, name })

const list = async (client: Client) => (await client.get('/api/devices')).json().devices

describe('devices', () => {
  it('registers idempotently and keeps the stored name', async () => {
    const { client } = await signUp({ device: false })
    const id = randomUUID()

    const first = await registerDevice(client, id)
    expect(first.status).toBe(201)
    expect(first.json().device).toMatchObject({ id, name: 'Firefox auf Linux', current: true })
    expect(first.json().device.createdAt).toBeTypeOf('string')
    expect(first.json().device.lastSeenAt).toBeTypeOf('string')

    const renamed = await client.patch(`/api/devices/${id}`, { name: '  Laptop ' })
    expect(renamed.status).toBe(200)
    expect(renamed.json().device).toMatchObject({ id, name: 'Laptop', current: true })

    const again = await registerDevice(client, id, 'Anderer Name')
    expect(again.status).toBe(200)
    expect(again.json().device.name).toBe('Laptop')

    const devices = await list(client)
    expect(devices).toHaveLength(1)
    expect(devices[0]).toMatchObject({ id, name: 'Laptop', current: true })
  })

  it('marks only the device of the requesting session as current', async () => {
    const account = await signUp({ device: false })
    const phone = await login(account)
    const laptopId = randomUUID()
    const phoneId = randomUUID()
    await registerDevice(account.client, laptopId)
    await registerDevice(phone, phoneId)
    const current = (devices: { id: string; current: boolean }[]) =>
      devices.filter((d) => d.current).map((d) => d.id)
    expect(current(await list(account.client))).toEqual([laptopId])
    expect(current(await list(phone))).toEqual([phoneId])
  })

  it('requires authentication and valid input', async () => {
    expect((await new Client().get('/api/devices')).status).toBe(401)
    expect((await registerDevice(new Client(), randomUUID())).status).toBe(401)
    const { client } = await signUp({ device: false })
    expect((await registerDevice(client, 'not-a-uuid')).status).toBe(400)
    expect((await registerDevice(client, randomUUID(), '  ')).status).toBe(400)
    const id = randomUUID()
    await registerDevice(client, id)
    expect((await client.patch(`/api/devices/${id}`, { name: '' })).status).toBe(400)
    expect((await client.patch('/api/devices/nope', { name: 'x' })).status).toBe(400)
    expect((await client.patch(`/api/devices/${randomUUID()}`, { name: 'x' })).status).toBe(404)
    expect((await client.delete('/api/devices/nope')).status).toBe(400)
    expect((await client.delete(`/api/devices/${randomUUID()}`)).status).toBe(404)
  })

  it('keeps devices of different users apart', async () => {
    const alice = await signUp({ name: 'alice', device: false })
    const bob = await signUp({ name: 'bob', device: false })
    const id = randomUUID()
    await registerDevice(alice.client, id)

    const clash = await registerDevice(bob.client, id)
    expect(clash.status).toBe(409)
    expect(clash.json().error.code).toBe('device_conflict')
    expect(await list(bob.client)).toEqual([])
    expect((await bob.client.patch(`/api/devices/${id}`, { name: 'Gekapert' })).status).toBe(404)
    expect((await bob.client.delete(`/api/devices/${id}`)).status).toBe(404)
  })

  it('removing a device ends its sessions and rejects it for good', async () => {
    const account = await signUp({ device: false })
    const laptop = account.client
    const phone = await login(account)
    const laptopId = randomUUID()
    const phoneId = randomUUID()
    await registerDevice(laptop, laptopId)
    await registerDevice(phone, phoneId)

    // The device in use cannot remove itself.
    const self = await laptop.delete(`/api/devices/${laptopId}`)
    expect(self.status).toBe(409)
    expect(self.json().error.code).toBe('current_device')

    expect((await laptop.delete(`/api/devices/${phoneId}`)).status).toBe(204)
    expect((await phone.get('/api/auth/me')).status).toBe(401)
    expect((await list(laptop)).map((d: { id: string }) => d.id)).toEqual([laptopId])

    // The removed device can no longer sync; the remaining one can.
    const target = { workspaceId: account.workspaceId }
    const [revoked] = await push(
      account,
      op({ ...target, deviceId: phoneId }, 'document', 'create', randomUUID(), docPayload()),
    )
    expect(revoked).toMatchObject({ status: 'rejected', code: 'device_not_active' })
    const [active] = await push(
      account,
      op({ ...target, deviceId: laptopId }, 'document', 'create', randomUUID(), docPayload()),
    )
    expect(active!.status).toBe('applied')

    // Signing in again does not bring the old id back; the client continues under a new id
    // (#46), and the removed entry stays hidden.
    const relogin = await login(account)
    const retry = await registerDevice(relogin, phoneId)
    expect(retry.status).toBe(403)
    expect(retry.json().error.code).toBe('device_revoked')
    const newPhoneId = randomUUID()
    expect((await registerDevice(relogin, newPhoneId)).status).toBe(201)
    expect((await list(laptop)).map((d: { id: string }) => d.id).sort()).toEqual(
      [laptopId, newPhoneId].sort(),
    )
  })

  it('ends a session from before the removal that the device never registered with (#46)', async () => {
    const account = await signUp({ device: false })
    const laptopId = randomUUID()
    await registerDevice(account.client, laptopId)
    // Signed in on the phone, registered with one session; a second one stays unlinked
    // (e.g. signed in again, then offline before registering).
    const phone = await login(account)
    const unlinked = await login(account)
    const phoneId = randomUUID()
    await registerDevice(phone, phoneId)
    expect((await account.client.delete(`/api/devices/${phoneId}`)).status).toBe(204)

    const retry = await registerDevice(unlinked, phoneId)
    expect(retry.status).toBe(401)
    expect((await unlinked.get('/api/auth/me')).status).toBe(401)
    // Nothing can be registered with that session any more, not even a new id.
    expect((await registerDevice(unlinked, randomUUID())).status).toBe(401)
  })
})

describe('logout', () => {
  it('can remove the current device on the way out', async () => {
    const account = await signUp({ device: false })
    await registerDevice(account.client, randomUUID(), 'Gemeinsamer PC')
    const response = await account.client.post('/api/auth/logout', { removeDevice: true })
    expect(response.status).toBe(204)

    const fresh = await login(account)
    expect(await list(fresh)).toEqual([])
  })

  it('keeps the device by default and works without a body', async () => {
    const account = await signUp({ device: false })
    const id = randomUUID()
    await registerDevice(account.client, id, 'Laptop')
    expect((await account.client.post('/api/auth/logout')).status).toBe(204)
    const again = account.client.fork()
    await again.post('/api/auth/login', { email: account.email, password: PASSWORD })
    expect((await list(again)).map((d: { id: string }) => d.id)).toEqual([id])
  })
})
